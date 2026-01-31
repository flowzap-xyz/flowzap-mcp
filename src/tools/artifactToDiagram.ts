/**
 * ArtifactToDiagram Tool
 * 
 * Parses real artifacts (HTTP logs, OpenAPI specs, code snippets) into FlowZap Code.
 * Gives AI agents a capability they don't have natively: structured extraction from logs/specs.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createPlaygroundUrl } from "./playgroundApi.js";

export type ArtifactType = "http_logs" | "openapi" | "code" | "diff";

export interface ParsedArtifact {
  code: string;
  view: "workflow" | "sequence";
  notes: string;
  actors: string[];
  stepCount: number;
}

export const artifactToDiagramTool: Tool = {
  name: "flowzap_artifact_to_diagram",
  description:
    "Parse real artifacts (HTTP logs, OpenAPI specs, code snippets) into FlowZap Code diagrams. Use this to convert raw technical data into visual workflows that can be explained and refined.",
  inputSchema: {
    type: "object" as const,
    properties: {
      artifactType: {
        type: "string",
        enum: ["http_logs", "openapi", "code"],
        description: "Type of artifact: http_logs (request/response sequences), openapi (API specs), code (function call traces)",
      },
      content: {
        type: "string",
        description: "Raw artifact content to parse",
      },
      view: {
        type: "string",
        enum: ["workflow", "sequence"],
        description: "Preferred diagram view (default: sequence for logs, workflow for openapi)",
      },
    },
    required: ["artifactType", "content"],
  },
};

/**
 * Parse HTTP logs into FlowZap Code
 * 
 * Supports formats:
 * - Apache/Nginx combined log format
 * - Simple request/response pairs
 * - HAR-like JSON
 */
function parseHttpLogs(content: string): ParsedArtifact {
  const lines = content.split("\n").filter((l) => l.trim());
  const actors = new Set<string>(["Client"]);
  const steps: Array<{ from: string; to: string; label: string }> = [];

  // Try to detect format
  let nodeId = 1;

  // Pattern 1: Simple "METHOD URL -> STATUS" or "CLIENT -> SERVER: MESSAGE"
  const simplePattern = /^(\w+)?\s*(?:->|→)\s*(\w+)(?:\s*:\s*(.+))?$/;
  const httpPattern = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)(?:\s+(\d{3}))?/i;
  const responsePattern = /^(\d{3})\s+(.+)/;

  let currentServer = "Server";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try HTTP method pattern
    const httpMatch = trimmed.match(httpPattern);
    if (httpMatch) {
      const [, method, path, status] = httpMatch;
      
      // Extract server from path if it's a full URL
      try {
        const url = new URL(path.startsWith("http") ? path : `https://example.com${path}`);
        currentServer = url.hostname.split(".")[0] || "Server";
      } catch {
        // Keep current server
      }
      
      actors.add(currentServer);
      
      // Request
      steps.push({
        from: "Client",
        to: currentServer,
        label: `${method} ${path.length > 30 ? path.substring(0, 30) + "..." : path}`,
      });

      // Response if status included
      if (status) {
        steps.push({
          from: currentServer,
          to: "Client",
          label: `${status} Response`,
        });
      }
      continue;
    }

    // Try simple arrow pattern
    const simpleMatch = trimmed.match(simplePattern);
    if (simpleMatch) {
      const [, from = "Client", to, message = "Request"] = simpleMatch;
      actors.add(from);
      actors.add(to);
      steps.push({ from, to, label: message });
      continue;
    }

    // Try response pattern (just status code)
    const responseMatch = trimmed.match(responsePattern);
    if (responseMatch && steps.length > 0) {
      const lastStep = steps[steps.length - 1];
      steps.push({
        from: lastStep.to,
        to: lastStep.from,
        label: `${responseMatch[1]} ${responseMatch[2]}`,
      });
    }
  }

  // If no steps parsed, create a placeholder
  if (steps.length === 0) {
    return {
      code: `client {\n  # Client\n  n1: circle label:"No parseable requests found"\n}`,
      view: "sequence",
      notes: "Could not parse HTTP log format. Try a simpler format like 'GET /api/users 200' or 'Client -> Server: Request'",
      actors: ["Client"],
      stepCount: 0,
    };
  }

  // Generate FlowZap Code
  const actorList = Array.from(actors);
  const laneNodes = new Map<string, string[]>();
  const allEdges: string[] = [];

  // Initialize lanes
  for (const actor of actorList) {
    laneNodes.set(actor, []);
  }

  // Create nodes and edges
  for (const step of steps) {
    const fromLane = step.from;
    const toLane = step.to;
    
    // Create source node if this is first action from this actor
    const fromNodes = laneNodes.get(fromLane) || [];
    let fromNodeId: string;
    
    if (fromNodes.length === 0) {
      fromNodeId = `n${nodeId++}`;
      fromNodes.push(`  ${fromNodeId}: rectangle label:"${escapeLabel(step.label)}"`);
      laneNodes.set(fromLane, fromNodes);
    } else {
      // Use last node as source
      const lastNode = fromNodes[fromNodes.length - 1];
      const match = lastNode.match(/^\s*(n\d+):/);
      fromNodeId = match ? match[1] : `n${nodeId++}`;
    }

    // Create target node
    const toNodes = laneNodes.get(toLane) || [];
    const toNodeId = `n${nodeId++}`;
    toNodes.push(`  ${toNodeId}: rectangle label:"${escapeLabel(step.label)}"`);
    laneNodes.set(toLane, toNodes);

    // Create edge
    if (fromLane === toLane) {
      allEdges.push(`  ${fromNodeId}.handle(right) -> ${toNodeId}.handle(left)`);
    } else {
      allEdges.push(`  ${fromNodeId}.handle(bottom) -> ${toLane.toLowerCase().replace(/\s+/g, "")}.${toNodeId}.handle(top) [label="${escapeLabel(step.label)}"]`);
    }
  }

  // Build code
  let code = "";
  for (const [actor, nodes] of laneNodes) {
    const laneId = actor.toLowerCase().replace(/\s+/g, "");
    code += `${laneId} {\n  # ${actor}\n`;
    code += nodes.join("\n") + "\n";
    
    // Add edges that originate from this lane
    const laneEdges = allEdges.filter((e) => e.includes(`${laneId}.`) || e.match(new RegExp(`^\\s*n\\d+\\.handle`)));
    if (laneEdges.length > 0) {
      code += laneEdges.join("\n") + "\n";
    }
    
    code += "}\n\n";
  }

  return {
    code: code.trim(),
    view: "sequence",
    notes: `Inferred ${actorList.length} actors and ${steps.length} steps from HTTP logs`,
    actors: actorList,
    stepCount: steps.length,
  };
}

/**
 * Parse OpenAPI spec into FlowZap Code
 */
function parseOpenAPI(content: string): ParsedArtifact {
  let spec: any;
  
  try {
    spec = JSON.parse(content);
  } catch {
    // Try YAML-like parsing (basic)
    try {
      // Very basic YAML parsing for common patterns
      const lines = content.split("\n");
      spec = { paths: {}, info: { title: "API" } };
      let currentPath = "";
      let currentMethod = "";
      
      for (const line of lines) {
        const pathMatch = line.match(/^\/[\w\-\/{}]+:/);
        if (pathMatch) {
          currentPath = pathMatch[0].replace(":", "");
          spec.paths[currentPath] = {};
        }
        const methodMatch = line.match(/^\s+(get|post|put|delete|patch):/i);
        if (methodMatch && currentPath) {
          currentMethod = methodMatch[1].toLowerCase();
          spec.paths[currentPath][currentMethod] = { summary: "" };
        }
        const summaryMatch = line.match(/^\s+summary:\s*(.+)/);
        if (summaryMatch && currentPath && currentMethod) {
          spec.paths[currentPath][currentMethod].summary = summaryMatch[1].trim().replace(/^["']|["']$/g, "");
        }
      }
    } catch {
      return {
        code: `api {\n  # API\n  n1: circle label:"Could not parse OpenAPI spec"\n}`,
        view: "workflow",
        notes: "Failed to parse OpenAPI content. Ensure it's valid JSON or YAML.",
        actors: ["API"],
        stepCount: 0,
      };
    }
  }

  const paths = spec.paths || {};
  const title = spec.info?.title || "API";
  const actors = new Set<string>(["Client", title]);
  const steps: Array<{ method: string; path: string; summary: string }> = [];

  // Extract endpoints
  for (const [path, methods] of Object.entries(paths)) {
    if (typeof methods !== "object" || methods === null) continue;
    
    for (const [method, details] of Object.entries(methods as Record<string, any>)) {
      if (!["get", "post", "put", "delete", "patch"].includes(method.toLowerCase())) continue;
      
      const summary = details?.summary || details?.operationId || `${method.toUpperCase()} ${path}`;
      steps.push({
        method: method.toUpperCase(),
        path,
        summary: String(summary),
      });
    }
  }

  if (steps.length === 0) {
    return {
      code: `api {\n  # ${title}\n  n1: circle label:"No endpoints found"\n}`,
      view: "workflow",
      notes: "No API endpoints found in the OpenAPI spec.",
      actors: [title],
      stepCount: 0,
    };
  }

  // Generate workflow diagram
  const apiLaneId = title.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, "");
  let code = `client {\n  # Client\n  n1: circle label:"Start"\n}\n\n`;
  code += `${apiLaneId} {\n  # ${title}\n`;

  let nodeId = 2;
  const nodeIds: string[] = [];

  for (const step of steps) {
    const label = step.summary.length > 40 ? step.summary.substring(0, 40) + "..." : step.summary;
    code += `  n${nodeId}: rectangle label:"${escapeLabel(label)}"\n`;
    nodeIds.push(`n${nodeId}`);
    nodeId++;
  }

  // Add edges between consecutive endpoints
  for (let i = 0; i < nodeIds.length - 1; i++) {
    code += `  ${nodeIds[i]}.handle(right) -> ${nodeIds[i + 1]}.handle(left)\n`;
  }

  // Add end node
  code += `  n${nodeId}: circle label:"End"\n`;
  if (nodeIds.length > 0) {
    code += `  ${nodeIds[nodeIds.length - 1]}.handle(right) -> n${nodeId}.handle(left)\n`;
  }

  code += "}\n";

  // Add cross-lane edge from client to first API node
  code = code.replace(
    "n1: circle label:\"Start\"\n}",
    `n1: circle label:"Start"\n  n1.handle(bottom) -> ${apiLaneId}.n2.handle(top)\n}`
  );

  return {
    code,
    view: "workflow",
    notes: `Extracted ${steps.length} endpoints from OpenAPI spec "${title}"`,
    actors: Array.from(actors),
    stepCount: steps.length,
  };
}

/**
 * Parse code snippets into FlowZap Code (function call trace)
 */
function parseCode(content: string): ParsedArtifact {
  const lines = content.split("\n").filter((l) => l.trim());
  const actors = new Set<string>();
  const calls: Array<{ caller: string; callee: string; method: string }> = [];

  // Patterns for function calls
  const patterns = [
    // JavaScript/TypeScript: object.method() or await object.method()
    /(?:await\s+)?(\w+)\.(\w+)\s*\(/g,
    // Python: object.method() or Class.method()
    /(\w+)\.(\w+)\s*\(/g,
    // Function definition: function name() or def name():
    /(?:function|def|async\s+function)\s+(\w+)/g,
    // Class method: class.method or self.method
    /(?:this|self)\.(\w+)\s*\(/g,
  ];

  let currentModule = "Main";

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Detect class/module definitions
    const classMatch = trimmed.match(/^(?:class|module|namespace)\s+(\w+)/);
    if (classMatch) {
      currentModule = classMatch[1];
      actors.add(currentModule);
      continue;
    }

    // Detect function definitions
    const funcMatch = trimmed.match(/^(?:function|def|async\s+function|async\s+def)\s+(\w+)/);
    if (funcMatch) {
      actors.add(currentModule);
      continue;
    }

    // Detect method calls
    const callMatch = trimmed.match(/(?:await\s+)?(\w+)\.(\w+)\s*\(/);
    if (callMatch) {
      const [, obj, method] = callMatch;
      
      // Skip common non-actor objects
      if (["console", "Math", "JSON", "Object", "Array", "String", "this", "self"].includes(obj)) {
        continue;
      }
      
      actors.add(obj);
      calls.push({
        caller: currentModule,
        callee: obj,
        method,
      });
    }
  }

  if (calls.length === 0) {
    return {
      code: `main {\n  # Main\n  n1: circle label:"No function calls detected"\n}`,
      view: "sequence",
      notes: "Could not detect function call patterns in the code.",
      actors: ["Main"],
      stepCount: 0,
    };
  }

  // Generate sequence diagram
  const actorList = Array.from(actors);
  if (!actorList.includes("Main")) {
    actorList.unshift("Main");
  }

  let code = "";
  const laneNodes = new Map<string, number>();
  let nodeId = 1;

  // Initialize lanes
  for (const actor of actorList) {
    const laneId = actor.toLowerCase().replace(/[^a-z0-9]/g, "");
    code += `${laneId} {\n  # ${actor}\n`;
    laneNodes.set(actor, 0);
    code += "}\n\n";
  }

  // We'll rebuild with nodes and edges
  code = "";
  const allNodes: Array<{ lane: string; id: string; label: string }> = [];
  const allEdges: Array<{ lane: string; edge: string }> = [];

  for (const call of calls) {
    const fromLane = call.caller.toLowerCase().replace(/[^a-z0-9]/g, "");
    const toLane = call.callee.toLowerCase().replace(/[^a-z0-9]/g, "");
    
    const fromNodeId = `n${nodeId++}`;
    const toNodeId = `n${nodeId++}`;
    
    allNodes.push({ lane: fromLane, id: fromNodeId, label: `Call ${call.method}` });
    allNodes.push({ lane: toLane, id: toNodeId, label: call.method });
    
    if (fromLane === toLane) {
      allEdges.push({ lane: fromLane, edge: `  ${fromNodeId}.handle(right) -> ${toNodeId}.handle(left)` });
    } else {
      allEdges.push({ lane: fromLane, edge: `  ${fromNodeId}.handle(bottom) -> ${toLane}.${toNodeId}.handle(top) [label="${call.method}"]` });
    }
  }

  // Group nodes by lane
  const nodesByLane = new Map<string, typeof allNodes>();
  for (const node of allNodes) {
    const existing = nodesByLane.get(node.lane) || [];
    existing.push(node);
    nodesByLane.set(node.lane, existing);
  }

  // Build code
  for (const actor of actorList) {
    const laneId = actor.toLowerCase().replace(/[^a-z0-9]/g, "");
    code += `${laneId} {\n  # ${actor}\n`;
    
    const nodes = nodesByLane.get(laneId) || [];
    for (const node of nodes) {
      code += `  ${node.id}: rectangle label:"${escapeLabel(node.label)}"\n`;
    }
    
    const edges = (allEdges as any[]).filter((e: any) => e.lane === laneId);
    for (const e of edges) {
      code += e.edge + "\n";
    }
    
    code += "}\n\n";
  }

  return {
    code: code.trim(),
    view: "sequence",
    notes: `Detected ${calls.length} function calls across ${actorList.length} modules`,
    actors: actorList,
    stepCount: calls.length,
  };
}

/**
 * Escape label text for FlowZap Code
 */
function escapeLabel(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ")
    .trim();
}

/**
 * Main handler for artifact_to_diagram tool
 */
export async function handleArtifactToDiagram(
  artifactType: unknown,
  content: unknown,
  view?: unknown
): Promise<string> {
  // Validate inputs
  if (typeof artifactType !== "string") {
    return JSON.stringify({
      success: false,
      error: "artifactType must be a string",
    });
  }

  if (!["http_logs", "openapi", "code"].includes(artifactType)) {
    return JSON.stringify({
      success: false,
      error: `Invalid artifactType "${artifactType}". Must be one of: http_logs, openapi, code`,
    });
  }

  if (typeof content !== "string") {
    return JSON.stringify({
      success: false,
      error: "content must be a string",
    });
  }

  if (content.trim().length === 0) {
    return JSON.stringify({
      success: false,
      error: "content cannot be empty",
    });
  }

  if (content.length > 100000) {
    return JSON.stringify({
      success: false,
      error: "content exceeds maximum length of 100,000 characters",
    });
  }

  try {
    let result: ParsedArtifact;

    switch (artifactType) {
      case "http_logs":
        result = parseHttpLogs(content);
        break;
      case "openapi":
        result = parseOpenAPI(content);
        break;
      case "code":
        result = parseCode(content);
        break;
      default:
        return JSON.stringify({
          success: false,
          error: `Unsupported artifact type: ${artifactType}`,
        });
    }

    // Override view if specified
    if (view === "workflow" || view === "sequence") {
      result.view = view;
    }

    // Auto-create playground URL
    const playground = await createPlaygroundUrl(result.code);

    return JSON.stringify({
      success: true,
      code: result.code,
      url: playground.url || null,
      view: result.view,
      notes: result.notes,
      stats: {
        actors: result.actors,
        stepCount: result.stepCount,
      },
      ...(playground.error && { playgroundError: playground.error }),
    }, null, 2);
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Failed to parse artifact: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
