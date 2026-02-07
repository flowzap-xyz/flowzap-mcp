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
} from "./tools/index.js";

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
        "User-Agent": "flowzap-mcp/1.3.2",
        "X-MCP-Client": "flowzap-mcp",
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

// Tool definitions
const tools: Tool[] = [
  {
    name: "flowzap_validate",
    description:
      "Validate FlowZap Code syntax. Use this to check if FlowZap Code is valid before creating a playground.",
    inputSchema: {
      type: "object" as const,
      properties: {
        code: {
          type: "string",
          description: "FlowZap Code to validate",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "flowzap_create_playground",
    description:
      "Create a FlowZap playground session with the given code and return a shareable URL. Use this after generating FlowZap Code to give the user a visual diagram. Set view to 'architecture' when user requests an architecture diagram.",
    inputSchema: {
      type: "object" as const,
      properties: {
        code: {
          type: "string",
          description: "FlowZap Code to load in the playground",
        },
        view: {
          type: "string",
          enum: ["workflow", "sequence", "architecture"],
          description: "View mode for the diagram. Use 'architecture' for architecture diagrams, 'sequence' for sequence diagrams, 'workflow' (default) for workflow diagrams.",
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
];

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

## Common Mistakes to Avoid
- Lane comment on separate line (WRONG: \`laneName {\n  # Label\`). Must be on same line: \`laneName { # Label\`
- Using emojis or special characters in labels
- Using non-sequential node IDs (n1, n3, n5 instead of n1, n2, n3)
- Missing handle syntax on edges
- Using \`label="Text"\` on nodes (should be \`label:"Text"\`)
- Using \`[label:"Text"]\` on edges (should be \`[label="Text"]\`)

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
    return { valid: false, errors: [{ line: 0, message: sanitized.error }] };
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
  const validViews = ["workflow", "sequence", "architecture"];
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

async function handleValidate(code: unknown): Promise<string> {
  try {
    const result = await validateCode(code);
    if (result.valid) {
      return `✅ FlowZap Code is valid!\n\nStats:\n- Lanes: ${result.stats?.lanes || 0}\n- Nodes: ${result.stats?.nodes || 0}\n- Edges: ${result.stats?.edges || 0}`;
    } else {
      const errors = result.errors?.map((e: any) => `- Line ${e.line}: ${e.message}`).join("\n") || "Unknown error";
      return `❌ Validation failed:\n${errors}`;
    }
  } catch (error) {
    securityLog("HANDLER_ERROR", { handler: "validate", error: String(error) });
    // Don't expose internal error details to client
    return `❌ Error validating code. Please try again.`;
  }
}

async function handleCreatePlayground(code: unknown, view?: string): Promise<string> {
  try {
    // First validate
    const validation = await validateCode(code);
    if (!validation.valid) {
      const errors = validation.errors?.map((e: any) => `- Line ${e.line}: ${e.message}`).join("\n") || "Unknown error";
      return `❌ Cannot create playground - code has errors:\n${errors}`;
    }

    // Create playground with optional view parameter
    const result = await createPlayground(code, view);
    if (result.url) {
      const viewLabel = view === "architecture" ? "Architecture Diagram" : view === "sequence" ? "Sequence Diagram" : "Diagram";
      return `Your diagram was created successfully.\nView your ${viewLabel}: ${result.url}`;
    } else if (result.error) {
      return `❌ Failed to create playground: ${result.error}`;
    } else {
      return `❌ Unexpected response from FlowZap API`;
    }
  } catch (error) {
    securityLog("HANDLER_ERROR", { handler: "createPlayground", error: String(error) });
    // Don't expose internal error details to client
    return `❌ Error creating playground. Please try again.`;
  }
}

// Main server setup
const server = new Server(
  {
    name: "flowzap-mcp",
    version: "1.3.2",
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
  const allowedTools = ["flowzap_validate", "flowzap_create_playground", "flowzap_get_syntax", "flowzap_export_graph", "flowzap_artifact_to_diagram", "flowzap_diff", "flowzap_apply_change"];
  if (!allowedTools.includes(name)) {
    securityLog("UNKNOWN_TOOL", { tool: name });
    throw new Error(`Unknown tool: ${name}`);
  }

  switch (name) {
    case "flowzap_validate": {
      const code = (args as { code?: unknown })?.code;
      const result = await handleValidate(code);
      return { content: [{ type: "text", text: result }] };
    }

    case "flowzap_create_playground": {
      const { code, view } = args as { code?: unknown; view?: string };
      const result = await handleCreatePlayground(code, view);
      return { content: [{ type: "text", text: result }] };
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
