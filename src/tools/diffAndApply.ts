/**
 * DiffAndApply Tool
 * 
 * Provides diff and structured patch operations for FlowZap Code.
 * Enables AI agents to show "what changed" and safely update diagrams.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { parseToGraph, GraphNode, GraphEdge } from "./exportGraph.js";
import { createPlaygroundUrl } from "./playgroundApi.js";

export interface DiffResult {
  nodesAdded: GraphNode[];
  nodesRemoved: GraphNode[];
  nodesUpdated: Array<{ id: string; changes: Record<string, { old: string; new: string }> }>;
  edgesAdded: GraphEdge[];
  edgesRemoved: GraphEdge[];
  lanesAdded: string[];
  lanesRemoved: string[];
  summary: string;
}

export interface PatchOperation {
  op: "insertNode" | "removeNode" | "updateNode" | "insertEdge" | "removeEdge" | "updateEdge";
  nodeId?: string;
  edgeId?: string;
  afterNodeId?: string;
  beforeNodeId?: string;
  laneId?: string;
  newNode?: {
    shape: "circle" | "rectangle" | "diamond" | "taskbox";
    label?: string;
    properties?: Record<string, string>;
  };
  newEdge?: {
    from: string;
    to: string;
    label?: string;
    fromHandle?: string;
    toHandle?: string;
  };
  updates?: Record<string, string>;
}

export const diffTool: Tool = {
  name: "flowzap_diff",
  description:
    "Compare two versions of FlowZap Code and get a structured diff showing what changed (nodes/edges added, removed, updated). Use this to explain changes to users.",
  inputSchema: {
    type: "object" as const,
    properties: {
      oldCode: {
        type: "string",
        description: "Original FlowZap Code",
      },
      newCode: {
        type: "string",
        description: "Updated FlowZap Code",
      },
    },
    required: ["oldCode", "newCode"],
  },
};

export const applyChangeTool: Tool = {
  name: "flowzap_apply_change",
  description:
    "Apply a structured change to FlowZap Code (insert/remove/update nodes or edges). Safer than regenerating entire diagrams - preserves existing structure.",
  inputSchema: {
    type: "object" as const,
    properties: {
      code: {
        type: "string",
        description: "Current FlowZap Code to modify",
      },
      operations: {
        type: "array",
        description: "Array of patch operations to apply",
        items: {
          type: "object",
          properties: {
            op: {
              type: "string",
              enum: ["insertNode", "removeNode", "updateNode", "insertEdge", "removeEdge"],
              description: "Operation type",
            },
            nodeId: {
              type: "string",
              description: "Node ID for remove/update operations",
            },
            afterNodeId: {
              type: "string",
              description: "Insert new node after this node ID",
            },
            laneId: {
              type: "string",
              description: "Lane ID for insert operations",
            },
            newNode: {
              type: "object",
              description: "New node definition for insert operations",
              properties: {
                shape: { type: "string", enum: ["circle", "rectangle", "diamond", "taskbox"] },
                label: { type: "string" },
                properties: { type: "object" },
              },
            },
            newEdge: {
              type: "object",
              description: "New edge definition for insertEdge",
              properties: {
                from: { type: "string" },
                to: { type: "string" },
                label: { type: "string" },
                fromHandle: { type: "string" },
                toHandle: { type: "string" },
              },
            },
            updates: {
              type: "object",
              description: "Property updates for updateNode operation",
            },
          },
          required: ["op"],
        },
      },
    },
    required: ["code", "operations"],
  },
};

/**
 * Compare two FlowZap Code versions and return structured diff
 */
export function diffCode(oldCode: string, newCode: string): DiffResult {
  const oldGraph = parseToGraph(oldCode);
  const newGraph = parseToGraph(newCode);

  // Build maps for comparison
  const oldNodes = new Map(oldGraph.nodes.map((n) => [n.id, n]));
  const newNodes = new Map(newGraph.nodes.map((n) => [n.id, n]));
  const oldEdges = new Map(oldGraph.edges.map((e) => [`${e.from}->${e.to}`, e]));
  const newEdges = new Map(newGraph.edges.map((e) => [`${e.from}->${e.to}`, e]));
  const oldLanes = new Set(oldGraph.lanes.map((l) => l.id));
  const newLanes = new Set(newGraph.lanes.map((l) => l.id));

  // Find added/removed nodes
  const nodesAdded: GraphNode[] = [];
  const nodesRemoved: GraphNode[] = [];
  const nodesUpdated: Array<{ id: string; changes: Record<string, { old: string; new: string }> }> = [];

  for (const [id, node] of newNodes) {
    if (!oldNodes.has(id)) {
      nodesAdded.push(node);
    } else {
      // Check for updates
      const oldNode = oldNodes.get(id)!;
      const changes: Record<string, { old: string; new: string }> = {};
      
      if (oldNode.label !== node.label) {
        changes.label = { old: oldNode.label, new: node.label };
      }
      if (oldNode.shape !== node.shape) {
        changes.shape = { old: oldNode.shape, new: node.shape };
      }
      if (oldNode.laneId !== node.laneId) {
        changes.laneId = { old: oldNode.laneId, new: node.laneId };
      }
      
      if (Object.keys(changes).length > 0) {
        nodesUpdated.push({ id, changes });
      }
    }
  }

  for (const [id, node] of oldNodes) {
    if (!newNodes.has(id)) {
      nodesRemoved.push(node);
    }
  }

  // Find added/removed edges
  const edgesAdded: GraphEdge[] = [];
  const edgesRemoved: GraphEdge[] = [];

  for (const [key, edge] of newEdges) {
    if (!oldEdges.has(key)) {
      edgesAdded.push(edge);
    }
  }

  for (const [key, edge] of oldEdges) {
    if (!newEdges.has(key)) {
      edgesRemoved.push(edge);
    }
  }

  // Find added/removed lanes
  const lanesAdded = Array.from(newLanes).filter((l) => !oldLanes.has(l));
  const lanesRemoved = Array.from(oldLanes).filter((l) => !newLanes.has(l));

  // Generate summary
  const parts: string[] = [];
  if (nodesAdded.length > 0) {
    parts.push(`Added ${nodesAdded.length} node(s): ${nodesAdded.map((n) => `"${n.label}"`).join(", ")}`);
  }
  if (nodesRemoved.length > 0) {
    parts.push(`Removed ${nodesRemoved.length} node(s): ${nodesRemoved.map((n) => `"${n.label}"`).join(", ")}`);
  }
  if (nodesUpdated.length > 0) {
    parts.push(`Updated ${nodesUpdated.length} node(s)`);
  }
  if (edgesAdded.length > 0) {
    parts.push(`Added ${edgesAdded.length} connection(s)`);
  }
  if (edgesRemoved.length > 0) {
    parts.push(`Removed ${edgesRemoved.length} connection(s)`);
  }
  if (lanesAdded.length > 0) {
    parts.push(`Added lane(s): ${lanesAdded.join(", ")}`);
  }
  if (lanesRemoved.length > 0) {
    parts.push(`Removed lane(s): ${lanesRemoved.join(", ")}`);
  }

  const summary = parts.length > 0 ? parts.join(". ") : "No changes detected";

  return {
    nodesAdded,
    nodesRemoved,
    nodesUpdated,
    edgesAdded,
    edgesRemoved,
    lanesAdded,
    lanesRemoved,
    summary,
  };
}

/**
 * Apply patch operations to FlowZap Code
 */
export function applyChanges(code: string, operations: PatchOperation[]): { code: string; applied: string[] } {
  let lines = code.split("\n");
  const applied: string[] = [];

  // Parse current structure to understand node positions
  const graph = parseToGraph(code);
  const nodeLines = new Map<string, number>(); // nodeId -> line number
  const laneRanges = new Map<string, { start: number; end: number }>(); // laneId -> line range

  // Find node and lane positions
  let currentLane: string | null = null;
  let laneStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    const laneMatch = line.match(/^(.+?)\s*\{/);
    if (laneMatch) {
      currentLane = laneMatch[1].trim();
      laneStart = i;
    }
    
    if (line === "}" && currentLane) {
      laneRanges.set(currentLane, { start: laneStart, end: i });
      currentLane = null;
    }
    
    const nodeMatch = line.match(/^(n\d+):/);
    if (nodeMatch) {
      nodeLines.set(nodeMatch[1], i);
    }
  }

  // Find highest node number
  let maxNodeNum = 0;
  for (const node of graph.nodes) {
    const match = node.id.match(/^n(\d+)$/);
    if (match) {
      maxNodeNum = Math.max(maxNodeNum, parseInt(match[1], 10));
    }
  }

  // Apply operations
  for (const op of operations) {
    switch (op.op) {
      case "insertNode": {
        if (!op.newNode || !op.laneId) {
          applied.push(`insertNode: skipped (missing newNode or laneId)`);
          continue;
        }

        const newNodeId = `n${++maxNodeNum}`;
        const shape = op.newNode.shape || "rectangle";
        let nodeLine = `  ${newNodeId}: ${shape}`;
        
        if (op.newNode.label) {
          nodeLine += ` label:"${escapeLabel(op.newNode.label)}"`;
        }
        if (op.newNode.properties) {
          for (const [key, value] of Object.entries(op.newNode.properties)) {
            nodeLine += ` ${key}:"${escapeLabel(value)}"`;
          }
        }

        // Find insertion point
        const laneRange = laneRanges.get(op.laneId);
        if (!laneRange) {
          applied.push(`insertNode: skipped (lane "${op.laneId}" not found)`);
          continue;
        }

        let insertAt = laneRange.end; // Default: before closing brace

        if (op.afterNodeId && nodeLines.has(op.afterNodeId)) {
          insertAt = nodeLines.get(op.afterNodeId)! + 1;
        }

        lines.splice(insertAt, 0, nodeLine);
        applied.push(`insertNode: added "${op.newNode.label || newNodeId}" as ${newNodeId} in ${op.laneId}`);

        // Update line numbers for subsequent operations
        for (const [nodeId, lineNum] of nodeLines) {
          if (lineNum >= insertAt) {
            nodeLines.set(nodeId, lineNum + 1);
          }
        }
        for (const [laneId, range] of laneRanges) {
          if (range.start >= insertAt) range.start++;
          if (range.end >= insertAt) range.end++;
        }
        nodeLines.set(newNodeId, insertAt);
        break;
      }

      case "removeNode": {
        if (!op.nodeId) {
          applied.push(`removeNode: skipped (missing nodeId)`);
          continue;
        }

        const lineNum = nodeLines.get(op.nodeId);
        if (lineNum === undefined) {
          applied.push(`removeNode: skipped (node "${op.nodeId}" not found)`);
          continue;
        }

        lines.splice(lineNum, 1);
        applied.push(`removeNode: removed ${op.nodeId}`);

        // Update line numbers
        for (const [nodeId, ln] of nodeLines) {
          if (ln > lineNum) {
            nodeLines.set(nodeId, ln - 1);
          }
        }
        nodeLines.delete(op.nodeId);
        break;
      }

      case "updateNode": {
        if (!op.nodeId || !op.updates) {
          applied.push(`updateNode: skipped (missing nodeId or updates)`);
          continue;
        }

        const lineNum = nodeLines.get(op.nodeId);
        if (lineNum === undefined) {
          applied.push(`updateNode: skipped (node "${op.nodeId}" not found)`);
          continue;
        }

        let line = lines[lineNum];
        
        for (const [key, value] of Object.entries(op.updates)) {
          // Replace existing property or add new one
          const propRegex = new RegExp(`${key}\\s*[:=]\\s*"[^"]*"`);
          if (propRegex.test(line)) {
            line = line.replace(propRegex, `${key}:"${escapeLabel(value)}"`);
          } else {
            // Add before end of line
            line = line.trimEnd() + ` ${key}:"${escapeLabel(value)}"`;
          }
        }

        lines[lineNum] = line;
        applied.push(`updateNode: updated ${op.nodeId} with ${Object.keys(op.updates).join(", ")}`);
        break;
      }

      case "insertEdge": {
        if (!op.newEdge) {
          applied.push(`insertEdge: skipped (missing newEdge)`);
          continue;
        }

        const { from, to, label, fromHandle = "right", toHandle = "left" } = op.newEdge;
        
        // Find the lane of the source node
        const sourceNode = graph.nodes.find((n) => n.id === from);
        if (!sourceNode) {
          applied.push(`insertEdge: skipped (source node "${from}" not found)`);
          continue;
        }

        const laneRange = laneRanges.get(sourceNode.laneId);
        if (!laneRange) {
          applied.push(`insertEdge: skipped (lane not found)`);
          continue;
        }

        // Check if target is in different lane (cross-lane edge)
        const targetNode = graph.nodes.find((n) => n.id === to);
        let edgeLine: string;
        
        if (targetNode && targetNode.laneId !== sourceNode.laneId) {
          edgeLine = `  ${from}.handle(${fromHandle}) -> ${targetNode.laneId}.${to}.handle(${toHandle})`;
        } else {
          edgeLine = `  ${from}.handle(${fromHandle}) -> ${to}.handle(${toHandle})`;
        }
        
        if (label) {
          edgeLine += ` [label="${escapeLabel(label)}"]`;
        }

        // Insert before closing brace of the lane
        lines.splice(laneRange.end, 0, edgeLine);
        applied.push(`insertEdge: added ${from} -> ${to}${label ? ` [${label}]` : ""}`);
        
        // Update ranges
        for (const [laneId, range] of laneRanges) {
          if (range.end >= laneRange.end) range.end++;
        }
        break;
      }

      case "removeEdge": {
        if (!op.newEdge) {
          applied.push(`removeEdge: skipped (missing edge specification)`);
          continue;
        }

        const { from, to } = op.newEdge;
        
        // Find and remove the edge line
        const edgePattern = new RegExp(`^\\s*${from}\\.handle\\([^)]+\\)\\s*->\\s*(?:\\w+\\.)?${to}\\.handle`);
        let removed = false;
        
        for (let i = 0; i < lines.length; i++) {
          if (edgePattern.test(lines[i])) {
            lines.splice(i, 1);
            removed = true;
            applied.push(`removeEdge: removed ${from} -> ${to}`);
            break;
          }
        }
        
        if (!removed) {
          applied.push(`removeEdge: skipped (edge ${from} -> ${to} not found)`);
        }
        break;
      }

      default:
        applied.push(`Unknown operation: ${(op as any).op}`);
    }
  }

  return {
    code: lines.join("\n"),
    applied,
  };
}

/**
 * Escape label text
 */
function escapeLabel(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ")
    .trim();
}

/**
 * Handle diff tool call
 */
export function handleDiff(oldCode: unknown, newCode: unknown): string {
  if (typeof oldCode !== "string" || typeof newCode !== "string") {
    return JSON.stringify({
      success: false,
      error: "Both oldCode and newCode must be strings",
    });
  }

  try {
    const diff = diffCode(oldCode, newCode);
    
    return JSON.stringify({
      success: true,
      changes: {
        nodesAdded: diff.nodesAdded.map((n) => ({ id: n.id, label: n.label, lane: n.laneId })),
        nodesRemoved: diff.nodesRemoved.map((n) => ({ id: n.id, label: n.label, lane: n.laneId })),
        nodesUpdated: diff.nodesUpdated,
        edgesAdded: diff.edgesAdded.map((e) => ({ from: e.from, to: e.to, label: e.label })),
        edgesRemoved: diff.edgesRemoved.map((e) => ({ from: e.from, to: e.to, label: e.label })),
        lanesAdded: diff.lanesAdded,
        lanesRemoved: diff.lanesRemoved,
      },
      summary: diff.summary,
    }, null, 2);
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Failed to diff code: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/**
 * Handle apply_change tool call
 */
export async function handleApplyChange(code: unknown, operations: unknown): Promise<string> {
  if (typeof code !== "string") {
    return JSON.stringify({
      success: false,
      error: "code must be a string",
    });
  }

  if (!Array.isArray(operations)) {
    return JSON.stringify({
      success: false,
      error: "operations must be an array",
    });
  }

  // Validate operations
  const validOps = ["insertNode", "removeNode", "updateNode", "insertEdge", "removeEdge"];
  for (const op of operations) {
    if (typeof op !== "object" || !op || !validOps.includes(op.op)) {
      return JSON.stringify({
        success: false,
        error: `Invalid operation: ${JSON.stringify(op)}. op must be one of: ${validOps.join(", ")}`,
      });
    }
  }

  try {
    const result = applyChanges(code, operations as PatchOperation[]);
    
    // Auto-create playground URL
    const playground = await createPlaygroundUrl(result.code);
    
    return JSON.stringify({
      success: true,
      code: result.code,
      url: playground.url || null,
      applied: result.applied,
      summary: `Applied ${result.applied.length} operation(s)`,
      ...(playground.error && { playgroundError: playground.error }),
    }, null, 2);
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Failed to apply changes: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
