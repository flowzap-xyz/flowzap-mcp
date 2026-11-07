/**
 * Mind Map MCP Tools
 *
 * Four new tools for Mind Map diagram support in FlowZap:
 *   - flowzap_mindmap_validate   : validate code + mind-map readiness
 *   - flowzap_mindmap_approve    : structured mind-map-specific audit
 *   - flowzap_mindmap_template   : generate a mind-map tree skeleton
 *   - flowzap_mindmap_create_playground : create playground with ?view=mindmap
 *
 * Security: all API calls go to flowzap.xyz only; input is capped at 50KB
 * and sanitized (null bytes, control chars stripped).
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { parseToGraph } from "./exportGraph.js";
import type { GraphNode, GraphEdge } from "./exportGraph.js";
import { createPlaygroundUrl } from "./playgroundApi.js";
import { CLIENT_HEADERS } from "../clientMeta.js";

// =============================================================================
// SECURITY CONSTANTS (local)
// =============================================================================

const FLOWZAP_API_BASE = "https://flowzap.xyz";
const MAX_CODE_LENGTH = 50_000;
const REQUEST_TIMEOUT_MS = 30_000;

// =============================================================================
// INPUT SANITIZATION
// =============================================================================

function sanitizeCode(input: unknown): { valid: boolean; code?: string; error?: string } {
  if (typeof input !== "string") {
    return { valid: false, error: "Code must be a string" };
  }
  if (input.length > MAX_CODE_LENGTH) {
    return { valid: false, error: `Code exceeds maximum length of ${MAX_CODE_LENGTH} characters` };
  }
  if (input.trim().length === 0) {
    return { valid: false, error: "Code cannot be empty" };
  }
  const sanitized = input
    .replace(/\0/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return { valid: true, code: sanitized };
}

// =============================================================================
// VALIDATION API CALL
// =============================================================================

async function callValidateApi(code: string): Promise<{ valid: boolean; errors: Array<{ line: number; message: string }>; stats?: { lanes: number; nodes: number; edges: number } }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${FLOWZAP_API_BASE}/api/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...CLIENT_HEADERS,
      },
      body: JSON.stringify({ code }),
      signal: controller.signal,
    });

    const result = await response.json();

    return {
      valid: Boolean(result.valid),
      errors: Array.isArray(result.errors) ? result.errors.slice(0, 50) : [],
      stats: result.stats
        ? {
            lanes: Number(result.stats.lanes) || 0,
            nodes: Number(result.stats.nodes) || 0,
            edges: Number(result.stats.edges) || 0,
          }
        : undefined,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// =============================================================================
// BFS UTILITIES (for approve)
// =============================================================================

interface BfsResult {
  parent: Map<string, string>;
  depth: Map<string, number>;
  branch: Map<string, string>; // nodeId -> branch root (first child of root)
}

function bfsFromRoot(
  rootId: string,
  nodeIds: Set<string>,
  adjacency: Map<string, string[]>,
): BfsResult {
  const parent = new Map<string, string>();
  const depth = new Map<string, number>();
  const branch = new Map<string, string>();

  const visited = new Set<string>();
  const queue: string[] = [rootId];
  visited.add(rootId);
  depth.set(rootId, 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depth.get(current) || 0;
    const neighbors = adjacency.get(current) || [];

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, current);
        depth.set(neighbor, currentDepth + 1);

        // Determine branch: if parent is root, this node starts a new branch
        if (current === rootId) {
          branch.set(neighbor, neighbor);
        } else {
          branch.set(neighbor, branch.get(current) || "unknown");
        }

        queue.push(neighbor);
      }
    }
  }

  return { parent, depth, branch };
}

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const mindmapValidateTool: Tool = {
  name: "flowzap_mindmap_validate",
  description:
    "Validate FlowZap Code syntax specifically for Mind Map diagrams. Checks syntax validity and whether the code is mind-map-ready (no diamonds, no taskboxes, at least one circle for the root, at least one rectangle for branches). Use this before flowzap_mindmap_approve and flowzap_mindmap_create_playground.",
  inputSchema: {
    type: "object" as const,
    properties: {
      code: {
        type: "string",
        description: "FlowZap Code to validate for mind map readiness",
      },
    },
    required: ["code"],
  },
};

export const mindmapApproveTool: Tool = {
  name: "flowzap_mindmap_approve",
  description:
    "Check if valid FlowZap Code is suitable for Mind Map rendering. Returns structured verdict with errors (blocking), warnings (advisory), and info. Rules: diamonds and taskboxes are ERROR (not rendered in mind maps), multiple circles produce WARNING (only the first is the root), edge directions are INFO (ignored by renderer), large/deep diagrams produce advisory warnings. Uses local parsing only - no API call.",
  inputSchema: {
    type: "object" as const,
    properties: {
      code: {
        type: "string",
        description: "FlowZap Code to inspect for mind map readiness",
      },
    },
    required: ["code"],
  },
};

export const mindmapTemplateTool: Tool = {
  name: "flowzap_mindmap_template",
  description:
    "Generate a ready-to-extend FlowZap Code skeleton for a Mind Map. Returns a tree structure with a central circle root, rectangle branches and sub-branches, and optional cross-links between branches. Use this to bootstrap a new mind map.",
  inputSchema: {
    type: "object" as const,
    properties: {
      topic: {
        type: "string",
        description: "Central topic label for the mind map root (default: 'Central Topic')",
      },
      branches: {
        type: "number",
        description: "Number of main branches from the root (default: 3, max: 8)",
      },
      depth: {
        type: "number",
        description: "Depth of sub-branches per main branch (default: 2, max: 4)",
      },
    },
  },
};

export const mindmapCreatePlaygroundTool: Tool = {
  name: "flowzap_mindmap_create_playground",
  description:
    "Create a FlowZap playground session that opens directly in Mind Map view (?view=mindmap). Validates the code first, then creates a shareable URL. Use this after flowzap_mindmap_validate and flowzap_mindmap_approve have passed.",
  inputSchema: {
    type: "object" as const,
    properties: {
      code: {
        type: "string",
        description: "FlowZap Code to load in a mind map playground",
      },
    },
    required: ["code"],
  },
};

// =============================================================================
// TOOL HANDLERS
// =============================================================================

/**
 * flowzap_mindmap_validate handler
 */
export async function handleMindmapValidate(code: unknown): Promise<string> {
  const sanitized = sanitizeCode(code);
  if (!sanitized.valid) {
    return `Validation failed:\n- Input error: ${sanitized.error}`;
  }

  try {
    const validation = await callValidateApi(sanitized.code!);

    if (!validation.valid) {
      const errorLines = validation.errors
        .map((e) => `- Line ${e.line}: ${e.message}`)
        .join("\n");
      return `Validation failed:\n${errorLines}`;
    }

    // Code is syntactically valid — check mind-map readiness
    const graph = parseToGraph(sanitized.code!);
    const diamondCount = graph.nodes.filter((n) => n.shape === "diamond").length;
    const taskboxCount = graph.nodes.filter((n) => n.shape === "taskbox").length;
    const circleCount = graph.nodes.filter((n) => n.shape === "circle").length;
    const rectangleCount = graph.nodes.filter((n) => n.shape === "rectangle").length;

    const issues: string[] = [];
    if (diamondCount > 0) issues.push(`${diamondCount} diamond(s) found`);
    if (taskboxCount > 0) issues.push(`${taskboxCount} taskbox(es) found`);
    if (circleCount === 0) issues.push("no circle found");
    if (rectangleCount === 0) issues.push("no rectangle found");

    const mindmapReady = diamondCount === 0 && taskboxCount === 0 && circleCount >= 1 && rectangleCount >= 1;

    if (mindmapReady) {
      const rootNode = graph.nodes.find((n) => n.shape === "circle");
      const branches = graph.edges.filter(
        (e) => e.from === rootNode?.id || e.to === rootNode?.id,
      ).length;
      return [
        "Mind Map Code is valid and ready!",
        "",
        "Stats:",
        `- Lanes: ${graph.stats.laneCount}`,
        `- Nodes: ${graph.stats.nodeCount}`,
        `- Edges: ${graph.stats.edgeCount}`,
        `- Root node: ${rootNode?.id || "?"} (${rootNode?.label || "Unknown"})`,
        `- Branches: ${branches}`,
      ].join("\n");
    }

    return [
      "Code is syntactically valid but NOT mind-map-ready:",
      ...issues.map((i) => `- ${i}`),
      "",
      "Fix these issues before creating a mind map playground.",
    ].join("\n");
  } catch {
    return "Error validating code. Please try again.";
  }
}

/**
 * flowzap_mindmap_approve handler (100% client-side)
 */
export function handleMindmapApprove(code: unknown): string {
  const sanitized = sanitizeCode(code);
  if (!sanitized.valid) {
    return `NOT APPROVED for mind map rendering:\n\nERRORS:\n- Input error: ${sanitized.error}`;
  }

  const graph = parseToGraph(sanitized.code!);

  const errors: string[] = [];
  const warnings: string[] = [];
  const infos: string[] = [];

  // (a) Diamonds
  const diamonds = graph.nodes.filter((n) => n.shape === "diamond");
  for (const d of diamonds) {
    errors.push(
      `Diamonds are decisional nodes and are NOT rendered in mind maps. Remove diamond '${d.id}' or convert it to a rectangle.`,
    );
  }

  // (b) Taskboxes
  const taskboxes = graph.nodes.filter((n) => n.shape === "taskbox");
  for (const tb of taskboxes) {
    errors.push(
      `Taskboxes are NOT supported in mind maps. Remove taskbox '${tb.id}' or convert it to a rectangle.`,
    );
  }

  // (c) Circles — first = root, extras = warning
  const circles = graph.nodes.filter((n) => n.shape === "circle");
  if (circles.length === 0) {
    errors.push(
      "A mind map requires at least one circle node to serve as the central root.",
    );
  } else if (circles.length > 1) {
    const firstCircle = circles[0].id;
    const extraCircles = circles.slice(1).map((c) => c.id).join("', '");
    warnings.push(
      `Only the first circle ('${firstCircle}') is rendered as the mind map root. Additional circles ('${extraCircles}') will be omitted by the renderer.`,
    );
  }

  // (d) No rectangle
  const rectangles = graph.nodes.filter((n) => n.shape === "rectangle");
  if (rectangles.length === 0) {
    errors.push(
      "A mind map requires at least one rectangle node for branches.",
    );
  }

  // Build adjacency for orphan detection and BFS
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const adjacency = new Map<string, string[]>();
  for (const nid of nodeIds) {
    adjacency.set(nid, []);
  }
  for (const edge of graph.edges) {
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) {
      adjacency.get(edge.from)!.push(edge.to);
      adjacency.get(edge.to)!.push(edge.from);
    }
  }

  // (e) Orphan nodes
  const orphans = graph.nodes.filter((n) => {
    const neighbors = adjacency.get(n.id) || [];
    return neighbors.length === 0;
  });
  for (const orphan of orphans) {
    errors.push(
      `Node '${orphan.id}' has no edges. All nodes must be connected in a mind map.`,
    );
  }

  // (f) Edge directions (INFO — once)
  if (graph.edges.length > 0) {
    infos.push(
      "Edge directions (->) are syntactically valid but ignored by the mind map renderer. The tree structure is derived from node connectivity, not arrow direction.",
    );
  }

  // (g) Large diagram (> 50 nodes)
  if (graph.nodes.length > 50) {
    warnings.push(
      `Large mind maps (${graph.nodes.length} nodes) may be hard to read. Consider splitting into sub-maps.`,
    );
  }

  // BFS from root for depth and cross-links
  let rootNode: GraphNode | undefined = circles[0];
  let maxDepth = 0;
  let branchesCount = 0;
  let crossLinksCount = 0;

  if (rootNode && nodeIds.has(rootNode.id)) {
    const bfsResult = bfsFromRoot(rootNode.id, nodeIds, adjacency);

    // Max depth
    for (const d of bfsResult.depth.values()) {
      if (d > maxDepth) maxDepth = d;
    }

    // Branches = direct children of root
    const rootNeighbors = adjacency.get(rootNode.id) || [];
    branchesCount = rootNeighbors.length;

    // Cross-links: edges connecting different branches (neither endpoint is root)
    for (const edge of graph.edges) {
      if (edge.from === rootNode.id || edge.to === rootNode.id) continue;
      const fromBranch = bfsResult.branch.get(edge.from);
      const toBranch = bfsResult.branch.get(edge.to);
      if (fromBranch && toBranch && fromBranch !== toBranch) {
        crossLinksCount++;
      }
    }

    // (h) Depth > 5
    if (maxDepth > 5) {
      warnings.push(
        `Deep hierarchy (${maxDepth} levels) may reduce readability.`,
      );
    }
  }

  // (i) Labels > 40 chars
  for (const node of graph.nodes) {
    if (node.label.length > 40) {
      const truncated = node.label.length > 43
        ? node.label.substring(0, 40) + "..."
        : node.label;
      warnings.push(
        `Label '${truncated}' on node '${node.id}' is long (${node.label.length} chars) and may overflow node boundaries.`,
      );
    }
  }

  // Build stats
  const stats = [
    `- Root: ${rootNode ? `${rootNode.id} (${rootNode.label})` : "NONE"}`,
    `- Branches: ${branchesCount}`,
    `- Max depth: ${maxDepth} levels`,
    `- Cross-links: ${crossLinksCount}`,
  ];

  const approved = errors.length === 0;

  if (!approved) {
    return [
      "NOT APPROVED for mind map rendering:",
      "",
      "ERRORS:",
      ...errors.map((e) => `- ${e}`),
      "",
      "WARNINGS:",
      ...(warnings.length > 0 ? warnings.map((w) => `- ${w}`) : ["None"]),
    ].join("\n");
  }

  return [
    "APPROVED for mind map rendering!",
    "",
    "Stats:",
    ...stats,
    "",
    "WARNINGS:",
    ...(warnings.length > 0 ? warnings.map((w) => `- ${w}`) : ["None"]),
    "",
    "INFO:",
    ...(infos.length > 0 ? infos : ["None"]),
  ].join("\n");
}

/**
 * flowzap_mindmap_template handler (100% client-side, deterministic)
 */
export function handleMindmapTemplate(
  topic: unknown,
  branches: unknown,
  depth: unknown,
): string {
  // Coerce and clamp parameters
  let topicStr = typeof topic === "string" && topic.trim().length > 0 ? topic.trim() : "Central Topic";
  let branchesNum = typeof branches === "number" ? Math.round(branches) : 3;
  let depthNum = typeof depth === "number" ? Math.round(depth) : 2;

  if (branchesNum < 1) branchesNum = 1;
  if (branchesNum > 8) branchesNum = 8;
  if (depthNum < 1) depthNum = 1;
  if (depthNum > 4) depthNum = 4;

  // Sanitize topic (no null bytes, no control chars)
  topicStr = topicStr.replace(/\0/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  const lines: string[] = [];
  let nextId = 1;

  // Helper to get next sequential ID
  const nid = (): string => `n${nextId++}`;

  // Root node
  const rootId = nid();
  const branchLabels = "ABCDEFGH".substring(0, branchesNum);

  // Lane opening
  lines.push(`mindmap { # Mind Map`);
  lines.push(`  ${rootId}: circle label:"${topicStr}"`);

  // Track structure for edges and cross-links
  const mainBranches: { id: string; label: string; subBranches: string[] }[] = [];

  // Generate main branches and their sub-branches
  for (let b = 0; b < branchesNum; b++) {
    const branchId = nid();
    const branchLabel = `Branch ${branchLabels[b]}`;
    const subBranches: string[] = [];

    // Main branch node
    lines.push(`  ${branchId}: rectangle label:"${branchLabel}"`);

    // Edge: root -> main branch (right direction)
    const rootHandle = b < 4 ? "right" : "bottom";
    lines.push(`  ${rootId}.handle(${rootHandle}) -> ${branchId}.handle(left)`);

    // Sub-branches at each depth level (depth >= 2)
    for (let d = 1; d < depthNum; d++) {
      const subId = nid();
      const subLabel = `Sub-branch ${branchLabels[b]}${d}`;
      subBranches.push(subId);

      lines.push(`  ${subId}: rectangle label:"${subLabel}"`);

      // Connect to parent (the previous level node)
      const parentId = d === 1 ? branchId : subBranches[d - 2];
      lines.push(`  ${parentId}.handle(bottom) -> ${subId}.handle(top)`);
    }

    mainBranches.push({ id: branchId, label: branchLabel, subBranches });
  }

  // Cross-link between first sub-branch of branch A and first sub-branch of branch B
  if (branchesNum >= 2 && mainBranches[0].subBranches.length > 0 && mainBranches[1].subBranches.length > 0) {
    const aSub = mainBranches[0].subBranches[0];
    const bSub = mainBranches[1].subBranches[0];
    lines.push(`  ${aSub}.handle(right) -> ${bSub}.handle(left) [label="cross-link"]`);
  }

  // Lane closing
  lines.push(`}`);

  const generatedCode = lines.join("\n");

  return [
    "Mind Map template generated!",
    "",
    "Replace the placeholder labels with your content, add or remove branches as needed.",
    "Next steps:",
    "1. Call flowzap_mindmap_validate to check the code",
    "2. Call flowzap_mindmap_approve for mind-map-specific checks",
    "3. Call flowzap_mindmap_create_playground to get a shareable URL",
    "",
    "Code:",
    generatedCode,
  ].join("\n");
}

/**
 * flowzap_mindmap_create_playground handler
 */
export async function handleMindmapCreatePlayground(code: unknown): Promise<string> {
  const sanitized = sanitizeCode(code);
  if (!sanitized.valid) {
    return `Failed to create mind map playground: ${sanitized.error}`;
  }

  try {
    // Step 1: validate via API
    const validation = await callValidateApi(sanitized.code!);
    if (!validation.valid) {
      const errorLines = validation.errors
        .map((e) => `- Line ${e.line}: ${e.message}`)
        .join("\n");
      return `Failed to create mind map playground - code has errors:\n${errorLines}`;
    }

    // Step 2: create playground URL
    const result = await createPlaygroundUrl(sanitized.code!);
    if (result.url) {
      // Append ?view=mindmap to the URL
      const mindmapUrl = result.url.includes("?")
        ? `${result.url}&view=mindmap`
        : `${result.url}?view=mindmap`;
      return `Your mind map is ready and is available here: ${mindmapUrl}`;
    }

    return `Failed to create mind map playground: ${result.error || "Unknown error"}`;
  } catch {
    return "Failed to create mind map playground. Please try again.";
  }
}
