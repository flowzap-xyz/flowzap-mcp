/**
 * ExportGraph Tool
 * 
 * Parses FlowZap Code into a structured JSON graph for AI agent reasoning.
 * Enables agents to query diagram structure without re-parsing DSL.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface Lane {
  id: string;
  label: string;
  type: "actor" | "system" | "unknown";
}

export interface GraphNode {
  id: string;
  laneId: string;
  label: string;
  kind: "start" | "end" | "step" | "decision" | "task";
  shape: "circle" | "rectangle" | "diamond" | "taskbox";
  properties?: Record<string, string>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  fromLane?: string;
  toLane?: string;
  label?: string;
  sourceHandle: string;
  targetHandle: string;
}

export interface ExportedGraph {
  lanes: Lane[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    laneCount: number;
    nodeCount: number;
    edgeCount: number;
    crossLaneEdges: number;
  };
}

export const exportGraphTool: Tool = {
  name: "flowzap_export_graph",
  description:
    "Export FlowZap Code as a structured JSON graph (lanes, nodes, edges). Use this to inspect diagrams structurally, query relationships, or analyze workflow patterns without re-parsing DSL.",
  inputSchema: {
    type: "object" as const,
    properties: {
      code: {
        type: "string",
        description: "FlowZap Code to parse into a graph structure",
      },
    },
    required: ["code"],
  },
};

/**
 * Parse FlowZap Code into a structured graph
 */
export function parseToGraph(code: string): ExportedGraph {
  const lines = String(code || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const lanes: Lane[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const laneMap = new Map<string, Lane>();
  const nodeToLane = new Map<string, string>();

  let currentLane: string | null = null;
  let edgeIdx = 1;

  for (const line of lines) {
    // Lane definition: `laneName { # Display Label`
    const laneMatch = line.match(/^(.+?)\s*\{\s*(?:#\s*(.*))?$/);
    if (laneMatch) {
      const laneId = laneMatch[1].trim();
      const laneLabel = laneMatch[2]?.trim() || laneId;
      
      if (!laneMap.has(laneId)) {
        const lane: Lane = {
          id: laneId,
          label: laneLabel,
          type: inferLaneType(laneId, laneLabel),
        };
        lanes.push(lane);
        laneMap.set(laneId, lane);
      }
      currentLane = laneId;
      continue;
    }

    // Closing brace
    if (line === "}") {
      currentLane = null;
      continue;
    }

    // Node definition: `nX: shape label:"Text" [other props]`
    const nodeMatch = line.match(/^(\w+):\s*(circle|rectangle|diamond|taskbox)\s*(.*)$/);
    if (nodeMatch && !line.includes("->")) {
      const [, nodeId, shape, propsStr] = nodeMatch;
      
      // Parse properties
      const props: Record<string, string> = {};
      const propRe = /(\w+)\s*[:=]\s*"([^"]*)"/g;
      let m: RegExpExecArray | null;
      while ((m = propRe.exec(propsStr))) {
        props[m[1]] = m[2];
      }

      const node: GraphNode = {
        id: nodeId,
        laneId: currentLane || "default",
        label: props.label || props.description || nodeId,
        kind: inferNodeKind(shape, props.label || ""),
        shape: shape as GraphNode["shape"],
      };

      // Add extra properties for taskbox
      if (shape === "taskbox") {
        node.properties = {};
        if (props.owner) node.properties.owner = props.owner;
        if (props.description) node.properties.description = props.description;
        if (props.system) node.properties.system = props.system;
      }

      nodes.push(node);
      nodeToLane.set(nodeId, currentLane || "default");
      continue;
    }

    // Edge definition: `n1.handle(right) -> n2.handle(left) [label="text"]`
    const edgeMatch = line.match(
      /^(.+?)\.handle\(([^)]+)\)\s*->\s*(.+?)\.handle\(([^)]+)\)(?:\s*\[label\s*[:=]\s*"([^"]*)"\])?/
    );
    if (edgeMatch) {
      const [, srcFullRaw, srcDir, tgtFullRaw, tgtDir, label] = edgeMatch;
      
      // Parse source (may be cross-lane: laneName.nodeId)
      const srcParts = srcFullRaw.trim().split(".");
      const srcNodeId = srcParts[srcParts.length - 1];
      const srcLane = srcParts.length > 1 ? srcParts[0] : nodeToLane.get(srcNodeId);
      
      // Parse target (may be cross-lane: laneName.nodeId)
      const tgtParts = tgtFullRaw.trim().split(".");
      const tgtNodeId = tgtParts[tgtParts.length - 1];
      const tgtLane = tgtParts.length > 1 ? tgtParts[0] : nodeToLane.get(tgtNodeId);

      const edge: GraphEdge = {
        id: `e${edgeIdx++}`,
        from: srcNodeId,
        to: tgtNodeId,
        sourceHandle: srcDir.toLowerCase(),
        targetHandle: tgtDir.toLowerCase(),
      };

      if (srcLane) edge.fromLane = srcLane;
      if (tgtLane) edge.toLane = tgtLane;
      if (label) edge.label = label;

      edges.push(edge);
    }
  }

  // Count cross-lane edges
  const crossLaneEdges = edges.filter(
    (e) => e.fromLane && e.toLane && e.fromLane !== e.toLane
  ).length;

  return {
    lanes,
    nodes,
    edges,
    stats: {
      laneCount: lanes.length,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      crossLaneEdges,
    },
  };
}

/**
 * Infer lane type from name/label
 */
function inferLaneType(id: string, label: string): Lane["type"] {
  const combined = `${id} ${label}`.toLowerCase();
  
  // Actor patterns
  if (
    combined.includes("user") ||
    combined.includes("customer") ||
    combined.includes("client") ||
    combined.includes("actor") ||
    combined.includes("person") ||
    combined.includes("human")
  ) {
    return "actor";
  }
  
  // System patterns
  if (
    combined.includes("api") ||
    combined.includes("server") ||
    combined.includes("database") ||
    combined.includes("db") ||
    combined.includes("service") ||
    combined.includes("system") ||
    combined.includes("backend") ||
    combined.includes("frontend")
  ) {
    return "system";
  }
  
  return "unknown";
}

/**
 * Infer node kind from shape and label
 */
function inferNodeKind(shape: string, label: string): GraphNode["kind"] {
  const lowerLabel = label.toLowerCase();
  
  if (shape === "circle") {
    if (lowerLabel.includes("start") || lowerLabel.includes("begin")) {
      return "start";
    }
    if (lowerLabel.includes("end") || lowerLabel.includes("complete") || lowerLabel.includes("finish")) {
      return "end";
    }
    return "start"; // Default for circles
  }
  
  if (shape === "diamond") {
    return "decision";
  }
  
  if (shape === "taskbox") {
    return "task";
  }
  
  return "step";
}

/**
 * Handle the export_graph tool call
 */
export function handleExportGraph(code: unknown): string {
  if (typeof code !== "string") {
    return JSON.stringify({
      success: false,
      error: "Code must be a string",
    });
  }

  if (code.trim().length === 0) {
    return JSON.stringify({
      success: false,
      error: "Code cannot be empty",
    });
  }

  try {
    const graph = parseToGraph(code);
    
    return JSON.stringify({
      success: true,
      graph,
      _usage: {
        hint: "Use this graph to query structure: find nodes by lane, trace paths between nodes, identify decision points, etc.",
        examples: [
          "Find all nodes in lane 'api': graph.nodes.filter(n => n.laneId === 'api')",
          "Find decision points: graph.nodes.filter(n => n.kind === 'decision')",
          "Find cross-lane connections: graph.edges.filter(e => e.fromLane !== e.toLane)",
        ],
      },
    }, null, 2);
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Failed to parse code: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
