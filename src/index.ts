#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  exportGraphTool,
  handleExportGraph,
  artifactToDiagramTool,
  handleArtifactToDiagram,
  diffTool,
  applyChangeTool,
  handleDiff,
  handleApplyChange,
  complianceCheckTool,
  handleComplianceCheck,
  fixCodeTool,
  handleFixCode,
  mindmapValidateTool,
  mindmapApproveTool,
  mindmapTemplateTool,
  mindmapCreatePlaygroundTool,
  handleMindmapValidate,
  handleMindmapApprove,
  handleMindmapTemplate,
  handleMindmapCreatePlayground,
} from "./tools/index.js";
import { CLIENT_HEADERS, CLIENT_VERSION } from "./clientMeta.js";

// =============================================================================
// SECURITY CONFIGURATION
// =============================================================================

// Only allow connections to official FlowZap API - prevents SSRF attacks
const FLOWZAP_API_BASE = "https://flowzap.xyz";
const ALLOWED_HOSTS = ["flowzap.xyz", "www.flowzap.xyz"];

// Rate limiting: max requests per minute (client-side protection)
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitState = { count: 0, windowStart: Date.now() };

// Input validation limits
const MAX_CODE_LENGTH = 50_000; // 50KB max code size
const MAX_INPUT_LENGTH = 100_000; // 100KB max total input

// Request timeout
const REQUEST_TIMEOUT_MS = 30_000; // 30 seconds

// =============================================================================
// SECURITY UTILITIES
// =============================================================================

/**
 * Validate that a URL is allowed (prevents SSRF)
 */
function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      ALLOWED_HOSTS.includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Client-side rate limiting
 */
function checkRateLimit(): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  
  // Reset window if expired
  if (now - rateLimitState.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitState.count = 0;
    rateLimitState.windowStart = now;
  }
  
  rateLimitState.count++;
  
  if (rateLimitState.count > RATE_LIMIT_MAX) {
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - rateLimitState.windowStart);
    return { allowed: false, retryAfterMs };
  }
  
  return { allowed: true };
}

/**
 * Sanitize and validate FlowZap Code input
 */
function sanitizeCode(input: unknown): { valid: boolean; code?: string; error?: string } {
  // Type check
  if (typeof input !== "string") {
    return { valid: false, error: "Code must be a string" };
  }
  
  // Length check
  if (input.length > MAX_CODE_LENGTH) {
    return { valid: false, error: `Code exceeds maximum length of ${MAX_CODE_LENGTH} characters` };
  }
  
  // Empty check
  if (input.trim().length === 0) {
    return { valid: false, error: "Code cannot be empty" };
  }
  
  // Remove null bytes and other dangerous characters
  const sanitized = input
    .replace(/\0/g, "") // Null bytes
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ""); // Control characters except \t, \n, \r
  
  return { valid: true, code: sanitized };
}

/**
 * Secure fetch with timeout and validation
 */
async function secureFetch(url: string, options: RequestInit): Promise<Response> {
  // Validate URL
  if (!isAllowedUrl(url)) {
    throw new Error(`Security: URL not allowed: ${url}`);
  }
  
  // Check rate limit
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    throw new Error(`Rate limit exceeded. Try again in ${Math.ceil((rateCheck.retryAfterMs || 0) / 1000)} seconds`);
  }
  
  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...options.headers,
        ...CLIENT_HEADERS,
      },
    });
    
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Log security events (to stderr, not exposed to MCP client)
 */
function securityLog(event: string, details?: Record<string, unknown>): void {
  console.error(`[SECURITY] ${event}`, details ? JSON.stringify(details) : "");
}

// ---------------------------------------------------------------------------
// Tool metadata: single source of truth (title, description, annotations).
// Mirrors flowzap-tool-annotations.json. readOnlyHint = NOT sideEffects, as
// published per tool in /.well-known/capabilities.json: 9 read-only, 4 write.
// ---------------------------------------------------------------------------
const TOOL_META: Record<string, { title: string; description: string; annotations: Record<string, unknown> }> = {
  "flowzap_get_syntax": {
    "title": "Get FlowZap Code Syntax",
    "description": "Returns the complete FlowZap Code DSL reference: lane, node, edge and loop grammar, the four allowed shapes, handle syntax and the ordering rules a diagram must satisfy. Call once before writing your first diagram, or when a validation error cites a rule you do not know. Takes no arguments and returns text only; it never validates your code, so pair it with flowzap_validate.",
    "annotations": {
      "title": "Get FlowZap Code Syntax",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    }
  },
  "flowzap_validate": {
    "title": "Validate FlowZap Code",
    "description": "Parses FlowZap Code and returns line-by-line errors and warnings plus structural stats (lanes, nodes, edges). Call it on any code you generated or edited before rendering it, and re-call it after flowzap_fix to confirm the repair. It reads nothing but the code you pass: no diagram is created and nothing is stored. Typo-level defects (edge syntax, undefined node references, non-sequential node IDs) are the class it catches.",
    "annotations": {
      "title": "Validate FlowZap Code",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    }
  },
  "flowzap_fix": {
    "title": "Repair FlowZap Code",
    "description": "Deterministically repairs mechanical FlowZap Code defects: non-sequential node numbering, missing or inferred edge handles, node and edge label syntax, missing lane display labels, and emoji or non-printable characters. Returns the repaired code plus the list of corrections applied. Use it after flowzap_validate reports one of those mechanical codes. It never invents nodes, edges or content, so semantic errors (a missing step, a wrong ordering) are reported unchanged and must be fixed in the code itself.",
    "annotations": {
      "title": "Repair FlowZap Code",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    }
  },
  "flowzap_create_playground": {
    "title": "Create Shareable Diagram",
    "description": "Validates the code and creates a shareable interactive diagram URL that the user can open in the workflow, sequence or architecture view. Use it once your code passes flowzap_validate and the user wants to see, edit or share the diagram. Side effects: it publishes a public read-only page and returns its URL; the session expires 60 minutes after creation, so the URL is not durable. The response also carries an advisory quality block (unreachable step, several start nodes, dead end); the diagram is created regardless, so fix the code and call again if that block is non-empty.",
    "annotations": {
      "title": "Create Shareable Diagram",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": false
    }
  },
  "flowzap_export_graph": {
    "title": "Export Diagram as Graph",
    "description": "Parses FlowZap Code into a structured JSON graph of lanes, nodes and edges for programmatic analysis, transformation or hand-off to another system. Use it instead of parsing the DSL yourself when you need the structure rather than a rendered picture. It reads only the code you pass and returns no URL and no rendering.",
    "annotations": {
      "title": "Export Diagram as Graph",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    }
  },
  "flowzap_artifact_to_diagram": {
    "title": "Convert Logs or Specs to Diagram",
    "description": "Turns an HTTP log, an OpenAPI specification or a code snippet into FlowZap Code and a shareable diagram URL. Use it when the input is a machine artifact rather than a description in prose, and you want the resulting call or dependency flow drawn. Side effects: it publishes a public diagram page with a 60-minute session lifetime. The conversion is structural, so call flowzap_validate on the returned code before relying on it for anything but reading.",
    "annotations": {
      "title": "Convert Logs or Specs to Diagram",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": false
    }
  },
  "flowzap_diff": {
    "title": "Compare Diagram Versions",
    "description": "Compares two versions of FlowZap Code and returns a structured diff of the nodes, edges and lanes added, removed or updated. Use it to review what a change actually did before you create or replace a diagram. It reads both inputs and creates nothing; it does not judge whether either version is valid, so validate separately.",
    "annotations": {
      "title": "Compare Diagram Versions",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    }
  },
  "flowzap_apply_change": {
    "title": "Patch an Existing Diagram",
    "description": "Applies structured patch operations (insert, remove or update nodes and edges) to existing FlowZap Code, then renumbers and repairs the result before rendering it. Use it to edit a diagram incrementally instead of regenerating it, which preserves node IDs and layout the user has already seen. Side effects: it overwrites the diagram content and publishes a public page with a 60-minute session lifetime. The response lists the operations actually applied and the ones skipped with their reason; when no operation applies or the patched code is still invalid, no page is created and no URL is returned: a response without a URL means no page exists.",
    "annotations": {
      "title": "Patch an Existing Diagram",
      "readOnlyHint": false,
      "destructiveHint": true,
      "idempotentHint": false,
      "openWorldHint": false
    }
  },
  "flowzap_compliance_check": {
    "title": "Review Diagram Compliance",
    "description": "Runs an architectural compliance review of a FlowZap data-flow diagram against SOC2, GDPR, PIPL and EU AI Act controls, and returns a Markdown report of findings per framework whose elements are detectable in the diagram, plus the URL of a rendered report when the service issues one. Use it when the user asks whether a data flow is compliant, not as a legal opinion: the output is an advisory architectural review, not legal advice, and it cannot see systems the diagram does not model. Limitations: the analysis is produced by an external LLM processor (DeepSeek, disclosed under GDPR Art. 13); calls are governed by a per-client quota, and a call beyond it returns the error code RATE_LIMITED with retryAfterSeconds instead of a report.",
    "annotations": {
      "title": "Review Diagram Compliance",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    }
  },
  "flowzap_mindmap_validate": {
    "title": "Validate Mind Map Code",
    "description": "Validates FlowZap Code syntax and additionally checks whether the code is renderable as a mind map: no diamonds or taskboxes, at least one circle as root, at least one rectangle as branch. Use it as the gate before flowzap_mindmap_approve or flowzap_mindmap_create_playground. It only reports and creates nothing; for a general syntax check use flowzap_validate instead.",
    "annotations": {
      "title": "Validate Mind Map Code",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    }
  },
  "flowzap_mindmap_approve": {
    "title": "Check Mind Map Readiness",
    "description": "Returns a structured ERROR, WARNING and INFO verdict on whether valid code renders well as a mind map: diamonds and taskboxes are blocking errors, multiple circles and depth beyond five levels are warnings, edge directions are informational. Use it after flowzap_mindmap_validate when you want to know whether the result is worth presenting, not merely whether it compiles. It parses locally and creates nothing.",
    "annotations": {
      "title": "Check Mind Map Readiness",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    }
  },
  "flowzap_mindmap_template": {
    "title": "Generate Mind Map Skeleton",
    "description": "Generates ready-to-extend FlowZap Code for a mind map from a topic, a branch count and a depth: a central circle root, rectangle branches and sub-branches, and cross-links between branches where they fit the tree. Use it to bootstrap a new mind map instead of writing the skeleton by hand. It returns code only and does not validate it or create a page; validate the edited result with flowzap_mindmap_validate.",
    "annotations": {
      "title": "Generate Mind Map Skeleton",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    }
  },
  "flowzap_mindmap_create_playground": {
    "title": "Create Shareable Mind Map",
    "description": "Validates the code and creates a shareable URL that opens directly in mind map view. Use it once flowzap_mindmap_validate and flowzap_mindmap_approve have passed and the user wants to see or share the mind map. Side effects: it publishes a public page and returns its URL; the session expires 60 minutes after creation, so the URL is not durable.",
    "annotations": {
      "title": "Create Shareable Mind Map",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": false
    }
  }
};

function withMeta(tool: Tool): Tool {
  const meta = TOOL_META[tool.name];
  if (!meta) return tool;
  return {
    ...tool,
    title: meta.title,
    description: meta.description,
    annotations: meta.annotations,
  } as Tool;
}

// Tool definitions
const toolsRaw: Tool[] = [
  {
    name: "flowzap_validate",
    description:
      "Validate FlowZap Code syntax. Use this to check if FlowZap Code is valid before creating a playground.",
    inputSchema: {
      type: "object" as const,
      properties: {
        code: {
          type: "string",
          description:
            "FlowZap Code to validate. Common shortcuts accepted: 'n1 -> n2' (handles auto-inferred) and 'n1 --> n2' (normalized). Full syntax: n1.handle(right) -> n2.handle(left).",
        },
      },
      required: ["code"],
    },
  },
  fixCodeTool,
  {
    name: "flowzap_create_playground",
    description:
      "Create a FlowZap playground session with the given code and return a shareable URL. Use this after generating FlowZap Code to give the user a visual diagram. Set view to 'architecture' when user requests an architecture diagram. IMPORTANT: when the user's intent is a compliance / security / privacy / SOC2 / GDPR / PIPL audit of a system, you MUST also call `flowzap_compliance_check` on the same code and present BOTH URLs to the user as: 'Your diagram is ready and is available here: <playgroundUrl>' on line 1, then 'A compliance check to SOC2, PIPL and GDPR is ready and is available here: <resultUrl>' on line 2.",
    inputSchema: {
      type: "object" as const,
      properties: {
        code: {
          type: "string",
          description:
            "FlowZap Code to load in the playground. Common shortcuts accepted: 'n1 -> n2' (handles auto-inferred) and 'n1 --> n2' (normalized). Full syntax: n1.handle(right) -> n2.handle(left).",
        },
        view: {
          type: "string",
          enum: ["workflow", "sequence", "architecture", "mindmap"],
          description: "View mode for the diagram. Use 'architecture' for architecture diagrams, 'sequence' for sequence diagrams, 'workflow' (default) for workflow diagrams, 'mindmap' for mind map view.",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "flowzap_get_syntax",
    description:
      "Get FlowZap Code syntax documentation and examples. Use this to learn how to write FlowZap Code for workflow diagrams.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  exportGraphTool,
  artifactToDiagramTool,
  diffTool,
  applyChangeTool,
  complianceCheckTool,
  mindmapValidateTool,
  mindmapApproveTool,
  mindmapTemplateTool,
  mindmapCreatePlaygroundTool,
];

const tools: Tool[] = toolsRaw.map(withMeta);

// FlowZap Code syntax documentation
const FLOWZAP_SYNTAX = `
# FlowZap Code Syntax Guide

**Complete MCP Documentation:** https://flowzap.xyz/docs/mcp
**Raw Markdown (for LLMs):** https://flowzap.xyz/docs/mcp.md

FlowZap Code is a domain-specific language for creating workflow diagrams.

## Global Constraints (IMPORTANT)
- Use UTF-8 plain text only - NO emojis or special characters
- Node IDs must be n1, n2, n3... (globally unique, sequential, no gaps)
- Only 4 shapes allowed: circle, rectangle, diamond, taskbox
- Only 4 node attributes allowed: label, owner, description, system
- Comments ONLY allowed as "# Display Label" immediately after lane opening brace
- No Mermaid, PlantUML, or other diagram syntaxes

## Basic Structure

\`\`\`
laneName { # Lane Display Name
  n1: shapeType label:"Node Label"
  n1.handle(right) -> n2.handle(left)
}
\`\`\`

## Shape Types (only these 4 are allowed)
- **circle** - Start/End events
- **rectangle** - Tasks/Activities/Process steps
- **diamond** - Decision gateways
- **taskbox** - Assigned tasks (with owner, description, system attributes)

## Node Syntax
- Node IDs must be n1, n2, n3... (globally unique, sequential, no gaps)
- Format: \`nX: shape label:"Text"\`
- Node attributes use **colon**: \`label:"Text"\`
- Keep labels under 50 characters for readability

Examples:
\`\`\`
n1: circle label:"Start"
n2: rectangle label:"Process Order"
n3: diamond label:"Valid?"
n4: taskbox owner:"Alice" description:"Deploy" system:"CI"
\`\`\`

## Edge Syntax (connections)
- Edges MUST use handle syntax: \`source.handle(direction) -> target.handle(direction)\`
- Directions: left, right, top, bottom
- Edge labels use **equals with brackets**: \`[label="Text"]\`
- Cross-lane edges MUST prefix target with valid lane name: \`laneName.nX.handle(direction)\`

Examples:
\`\`\`
n1.handle(right) -> n2.handle(left)
n2.handle(bottom) -> n3.handle(top) [label="Yes"]
n3.handle(bottom) -> fulfillment.n4.handle(top) [label="Send"]
\`\`\`

## Loops
- Format: \`loop [condition] n1 n2 n3\`
- Must be inside a lane block
- Cannot be nested
- Should reference at least 2 nodes

## Sequence Diagram Best Practices
FlowZap Code renders as both Workflow and Sequence views. The Sequence view draws messages top-to-bottom in **edge definition order**. Follow these rules for multi-lane code:
- **Request-response pairing**: Every cross-lane request must have a corresponding return edge
- **Chronological edge ordering**: Define edges in time order; sequence view uses definition order, not node IDs
- **No orphaned nodes**: Every node must participate in at least one edge
- **Separate async flows**: Define main-flow edges first, then background/async edges; never interleave

## Common Mistakes to Avoid
- Lane comment on separate line (WRONG: \`laneName {\n  # Label\`). Must be on same line: \`laneName { # Label\`
- Using emojis or special characters in labels
- Using non-sequential node IDs (n1, n3, n5 instead of n1, n2, n3)
- Missing handle syntax on edges
- Using \`label="Text"\` on nodes (should be \`label:"Text"\`)
- Using \`[label:"Text"]\` on edges (should be \`[label="Text"]\`)
- Missing response edge for cross-lane requests (creates incomplete sequence diagrams)
- Orphaned nodes with no edges (appear as disconnected steps)

## Example: Order Processing

\`\`\`
sales { # Sales Team
  n1: circle label:"Order Received"
  n2: rectangle label:"Validate Order"
  n3: diamond label:"Valid?"
  n1.handle(right) -> n2.handle(left)
  n2.handle(right) -> n3.handle(left)
  n3.handle(right) -> fulfillment.n4.handle(left) [label="Yes"]
  n3.handle(bottom) -> n6.handle(top) [label="No"]
  n6: rectangle label:"Reject Order"
}

fulfillment { # Fulfillment
  n4: rectangle label:"Process Order"
  n5: circle label:"Complete"
  n4.handle(right) -> n5.handle(left)
}
\`\`\`
`;

// =============================================================================
// SECURE API CALLS
// =============================================================================

/**
 * Validate FlowZap Code via API (with security checks)
 */
async function validateCode(rawCode: unknown): Promise<any> {
  // Input validation
  const sanitized = sanitizeCode(rawCode);
  if (!sanitized.valid) {
    securityLog("INPUT_VALIDATION_FAILED", { error: sanitized.error });
    // `warnings` must be present: the caller reads `result.warnings.length` before
    // formatting the verdict. Leaving it out made every rejected input (empty string,
    // over-long code) throw a TypeError, which the handler reported as
    // "Validator unavailable" with an UPSTREAM_ERROR code instead of the real reason.
    return { valid: false, errors: [{ line: 0, message: sanitized.error, code: "INVALID_PAYLOAD" }], warnings: [] };
  }
  
  const code = sanitized.code!;
  securityLog("API_CALL", { endpoint: "validate", codeLength: code.length });
  
  const response = await secureFetch(`${FLOWZAP_API_BASE}/api/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  
  // Validate response
  if (!response.ok) {
    securityLog("API_ERROR", { status: response.status });
    throw new Error(`API error: ${response.status}`);
  }
  
  const result = await response.json();
  
  // Sanitize response - only return expected fields
  return {
    valid: Boolean(result.valid),
    errors: Array.isArray(result.errors) ? result.errors.slice(0, 50) : [],
    warnings: Array.isArray(result.warnings) ? result.warnings.slice(0, 50) : [],
    stats: result.stats ? {
      lanes: Number(result.stats.lanes) || 0,
      nodes: Number(result.stats.nodes) || 0,
      edges: Number(result.stats.edges) || 0,
      loops: Number(result.stats.loops) || 0,
    } : undefined,
  };
}

/**
 * Create playground session via API (with security checks)
 */
async function createPlayground(rawCode: unknown, view?: string): Promise<any> {
  // Input validation
  const sanitized = sanitizeCode(rawCode);
  if (!sanitized.valid) {
    securityLog("INPUT_VALIDATION_FAILED", { error: sanitized.error });
    return { error: sanitized.error };
  }
  
  const code = sanitized.code!;
  const validViews = ["workflow", "sequence", "architecture", "mindmap"];
  const safeView = view && validViews.includes(view) ? view : undefined;
  securityLog("API_CALL", { endpoint: "playground/create", codeLength: code.length, view: safeView });
  
  const response = await secureFetch(`${FLOWZAP_API_BASE}/api/playground/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, view: safeView }),
  });
  
  // Validate response
  if (!response.ok) {
    securityLog("API_ERROR", { status: response.status });
    throw new Error(`API error: ${response.status}`);
  }
  
  const result = await response.json();
  
  // Sanitize response - only return expected fields, validate URL
  if (result.url) {
    // Validate returned URL is from FlowZap
    if (!isAllowedUrl(result.url) && !result.url.startsWith("https://flowzap.xyz/")) {
      securityLog("SUSPICIOUS_URL", { url: result.url });
      return { error: "Invalid playground URL returned" };
    }
    return { url: result.url };
  }
  
  return { error: result.error || "Unknown error" };
}

// =============================================================================
// TOOL HANDLERS (with error handling)
// =============================================================================

type Issue = { line?: number; code?: string; message?: string; severity?: string };
type ValidationPayload = {
  valid: boolean;
  errors: Issue[];
  warnings: Issue[];
  stats?: { lanes: number; nodes: number; edges: number; loops: number };
};

/**
 * A line number of 0 is the parser's "not attributable" sentinel, not a fact.
 * Rendering it as a line number fabricates precision the agent cannot act on.
 */
function formatIssue(issue: Issue): string {
  const code = issue.code ? `[${issue.code}] ` : "";
  const line = typeof issue.line === "number" && issue.line > 0 ? `Line ${issue.line}: ` : "";
  return `- ${line}${code}${issue.message ?? ""}`;
}

async function handleValidate(
  code: unknown,
): Promise<{ text: string; structured: ValidationPayload }> {
  try {
    const result = (await validateCode(code)) as ValidationPayload;
    const stats = result.stats
      ? `- Lanes: ${result.stats.lanes}\n- Nodes: ${result.stats.nodes}\n- Edges: ${result.stats.edges}\n- Loops: ${result.stats.loops}`
      : "";
    let text: string;
    if (result.valid) {
      text = `FlowZap Code is valid.\n\nStats:\n${stats}`;
    } else {
      const errors = result.errors.map(formatIssue).join("\n");
      text = `Validation failed.\n\n${errors}`;
      if (result.warnings.length > 0) {
        text += `\n\nWarnings:\n${result.warnings.map(formatIssue).join("\n")}`;
      }
    }
    return { text, structured: result };
  } catch (error) {
    securityLog("HANDLER_ERROR", { handler: "validate", error: String(error) });
    return {
      text: "Error validating code. Please try again.",
      structured: {
        valid: false,
        errors: [{ code: "UPSTREAM_ERROR", message: "Validator unavailable." }],
        warnings: [],
      },
    };
  }
}

async function handleCreatePlayground(
  code: unknown,
  view?: string,
): Promise<{ text: string; structured: Record<string, unknown> }> {
  try {
    // Validate first, but hand back the validator's codes so a single call can
    // fail informatively instead of forcing a second round trip.
    const validation = (await validateCode(code)) as ValidationPayload;
    if (!validation.valid) {
      const errors = validation.errors.map(formatIssue).join("\n") || "Unknown error";
      return {
        text: `Cannot create playground - code has errors:\n${errors}`,
        structured: {
          valid: false,
          url: null,
          errors: validation.errors,
          warnings: validation.warnings,
          stats: validation.stats,
        },
      };
    }

    const result = await createPlayground(code, view);
    if (result.url) {
      const viewLabel = view === "architecture" ? "Architecture Diagram" : view === "sequence" ? "Sequence Diagram" : view === "mindmap" ? "Mind Map" : "Diagram";
      return {
        text: `Your diagram was created successfully.\nView your ${viewLabel}: ${result.url}`,
        structured: {
          valid: true,
          url: result.url,
          view: view ?? "workflow",
          expiresAt: result.tokenExpiresAt ?? result.expiresAt ?? null,
        },
      };
    }
    return {
      text: result.error ? `Failed to create playground: ${result.error}` : "Unexpected response from FlowZap API",
      structured: { valid: true, url: null, error: result.error ?? "unexpected_response" },
    };
  } catch (error) {
    securityLog("HANDLER_ERROR", { handler: "createPlayground", error: String(error) });
    return {
      text: "Error creating playground. Please try again.",
      structured: { valid: false, url: null, error: "upstream_error" },
    };
  }
}

// Main server setup
const server = new Server(
  {
    name: "flowzap-mcp",
    version: CLIENT_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  const { name, arguments: args } = request.params;
  
  securityLog("TOOL_CALL", { tool: name });

  // Validate tool name (whitelist approach)
  const allowedTools = ["flowzap_validate", "flowzap_fix", "flowzap_create_playground", "flowzap_get_syntax", "flowzap_export_graph", "flowzap_artifact_to_diagram", "flowzap_diff", "flowzap_apply_change", "flowzap_compliance_check", "flowzap_mindmap_validate", "flowzap_mindmap_approve", "flowzap_mindmap_template", "flowzap_mindmap_create_playground"];
  if (!allowedTools.includes(name)) {
    securityLog("UNKNOWN_TOOL", { tool: name });
    throw new Error(`Unknown tool: ${name}`);
  }

  switch (name) {
    case "flowzap_validate": {
      const code = (args as { code?: unknown })?.code;
      const result = await handleValidate(code);
      const sc = result.structured as { errors?: Array<{ code?: string }> };
      // Same rule as the hosted transport: a rejected diagram is a normal answer, but
      // an input that could not be evaluated at all means the tool produced no verdict.
      return {
        content: [{ type: "text", text: result.text }],
        structuredContent: result.structured,
        ...(sc.errors?.[0]?.code === "INVALID_PAYLOAD" ? { isError: true } : {}),
      };
    }

    case "flowzap_fix": {
      const { code, lng } = args as { code?: unknown; lng?: unknown };
      const result = await handleFixCode(code, lng);
      return { content: [{ type: "text", text: result }] };
    }

    case "flowzap_create_playground": {
      const { code, view } = args as { code?: unknown; view?: string };
      const result = await handleCreatePlayground(code, view);
      const sc = result.structured as { url?: string | null };
      // isError marks "the tool did not produce its primary output (a URL)".
      // A validation verdict from flowzap_validate is NOT an error: it did its job.
      return {
        content: [{ type: "text", text: result.text }],
        structuredContent: result.structured,
        isError: sc.url == null,
      };
    }

    case "flowzap_get_syntax": {
      return { content: [{ type: "text", text: FLOWZAP_SYNTAX }] };
    }

    case "flowzap_export_graph": {
      const code = (args as { code?: unknown })?.code;
      const result = handleExportGraph(code);
      return { content: [{ type: "text", text: result }] };
    }

    case "flowzap_artifact_to_diagram": {
      const { artifactType, content, view } = args as { artifactType?: unknown; content?: unknown; view?: unknown };
      const result = await handleArtifactToDiagram(artifactType, content, view);
      return { content: [{ type: "text", text: result }] };
    }

    case "flowzap_diff": {
      const { oldCode, newCode } = args as { oldCode?: unknown; newCode?: unknown };
      const result = handleDiff(oldCode, newCode);
      return { content: [{ type: "text", text: result }] };
    }

    case "flowzap_apply_change": {
      const { code, operations } = args as { code?: unknown; operations?: unknown };
      const result = await handleApplyChange(code, operations);
      return { content: [{ type: "text", text: result }] };
    }

    case "flowzap_compliance_check": {
      const { code, lng } = args as { code?: unknown; lng?: unknown };
      const result = await handleComplianceCheck(code, lng);
      return {
        content: [{ type: "text", text: result.text }],
        structuredContent: result.structured,
        isError: result.structured.ok === false,
      };
    }

    case "flowzap_mindmap_validate": {
      const code = (args as { code?: unknown })?.code;
      const result = await handleMindmapValidate(code);
      return { content: [{ type: "text", text: result }] };
    }
    case "flowzap_mindmap_approve": {
      const code = (args as { code?: unknown })?.code;
      const result = handleMindmapApprove(code);
      return { content: [{ type: "text", text: result }] };
    }
    case "flowzap_mindmap_template": {
      const { topic, branches, depth } = args as { topic?: unknown; branches?: unknown; depth?: unknown };
      const result = handleMindmapTemplate(topic, branches, depth);
      return { content: [{ type: "text", text: result }] };
    }
    case "flowzap_mindmap_create_playground": {
      const code = (args as { code?: unknown })?.code;
      const result = await handleMindmapCreatePlayground(code);
      return { content: [{ type: "text", text: result }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("FlowZap MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
