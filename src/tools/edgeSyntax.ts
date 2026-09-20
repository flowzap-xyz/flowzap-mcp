/**
 * Edge syntax normalization for FlowZap Code.
 *
 * NOTE: This is a manual duplicate of `src/lib/edge-syntax.ts` in the FlowZap
 * Next.js app. The `flowzap-mcp` package is published standalone and has no
 * access to `src/lib`, so the function is copied here. Keep both copies in
 * sync when the tolerant edge syntax evolves.
 *
 * Accepted syntaxes (all normalize to `source.handle(dir) -> target.handle(dir)`):
 *   (a) `n1 -> n2`                    — no handles: both directions inferred.
 *   (b) `n1 --> n2` / `n1 ---> n2`    — Mermaid-ish arrows (2+ dashes) collapse
 *                                        to `->`, then rule (a) applies.
 *   (c) `n1.handle(right) -> n2`      — source handle only: target inferred.
 *   (full) `n1.handle(right) -> n2.handle(left)` — canonical form, unchanged.
 *
 * Inference rule (documented simplification):
 *   - Default source direction is "right", default target direction is "left".
 *   - EXCEPTION: when source and target are in the SAME lane AND the target node
 *     appears BEFORE the source node in the code, the direction is flipped to
 *     source "left" / target "right" to avoid a visually "backwards" arrow.
 */

export type HandleDirection = "top" | "bottom" | "left" | "right";

const HANDLE_DIRECTIONS: readonly HandleDirection[] = ["left", "right", "top", "bottom"];

/** Optional context used by the handle-inference rule (see module docblock). */
export interface EdgeSyntaxContext {
  /** Maps a nodeId to its lane name (only nodes already defined). */
  nodeLane?: ReadonlyMap<string, string>;
  /** Maps a nodeId to its definition order (index of first appearance). */
  nodeOrder?: ReadonlyMap<string, number>;
}

export interface NormalizedEdge {
  srcNodeId: string;
  srcLane: string | null;
  tgtNodeId: string;
  tgtLane: string | null;
  srcDir: HandleDirection;
  tgtDir: HandleDirection;
  srcDirExplicit: string | null;
  tgtDirExplicit: string | null;
  label: string;
  inferred: boolean;
}

function isValidDirection(dir: string): dir is HandleDirection {
  return (HANDLE_DIRECTIONS as readonly string[]).includes(dir);
}

function splitNodeRef(token: string): { lane: string | null; nodeId: string } {
  const parts = token.trim().split(".");
  if (parts.length > 1) {
    return { lane: parts[0], nodeId: parts[parts.length - 1] };
  }
  return { lane: null, nodeId: parts[0] };
}

function buildEdge(
  srcNodeId: string,
  srcLane: string | null,
  srcDirExplicit: string | null,
  tgtNodeId: string,
  tgtLane: string | null,
  tgtDirExplicit: string | null,
  label: string,
  ctx: EdgeSyntaxContext | undefined,
): NormalizedEdge {
  const srcDirRaw = srcDirExplicit ? srcDirExplicit.trim() : null;
  const tgtDirRaw = tgtDirExplicit ? tgtDirExplicit.trim() : null;

  const srcResolvedLane = srcLane ?? ctx?.nodeLane?.get(srcNodeId) ?? null;
  const tgtResolvedLane = tgtLane ?? ctx?.nodeLane?.get(tgtNodeId) ?? null;

  const sameLane = srcResolvedLane !== null && srcResolvedLane === tgtResolvedLane;
  const srcOrder = ctx?.nodeOrder?.get(srcNodeId);
  const tgtOrder = ctx?.nodeOrder?.get(tgtNodeId);
  const targetIsUpstream =
    sameLane && srcOrder !== undefined && tgtOrder !== undefined && tgtOrder < srcOrder;

  const srcInferred = srcDirRaw === null;
  const tgtInferred = tgtDirRaw === null;

  const srcLower = srcDirRaw?.toLowerCase() ?? null;
  const tgtLower = tgtDirRaw?.toLowerCase() ?? null;

  let srcDir: HandleDirection;
  if (srcLower !== null && isValidDirection(srcLower)) {
    srcDir = srcLower;
  } else if (srcInferred) {
    srcDir = targetIsUpstream ? "left" : "right";
  } else {
    srcDir = "right";
  }

  let tgtDir: HandleDirection;
  if (tgtLower !== null && isValidDirection(tgtLower)) {
    tgtDir = tgtLower;
  } else if (tgtInferred) {
    tgtDir = targetIsUpstream ? "right" : "left";
  } else {
    tgtDir = "left";
  }

  return {
    srcNodeId,
    srcLane,
    tgtNodeId,
    tgtLane,
    srcDir,
    tgtDir,
    srcDirExplicit: srcDirRaw,
    tgtDirExplicit: tgtDirRaw,
    label,
    inferred: srcInferred || tgtInferred,
  };
}

/**
 * Normalize a single (already trimmed) edge line into a `NormalizedEdge`, or
 * return `null` when the line is not a recognizable edge.
 */
export function normalizeEdgeSyntax(line: string, ctx?: EdgeSyntaxContext): NormalizedEdge | null {
  const normalizedLine = line.replace(/-{2,}>/g, "->");

  // Canonical full-handle syntax.
  const full = normalizedLine.match(
    /^(.+?)\.handle\(([^)]+)\)\s*->\s*(.+?)\.handle\(([^)]+)\)(?:\s*\[label\s*[:=]\s*(?:"([^"]*)"|'([^']*)')\])?$/,
  );
  if (full) {
    const [, srcFull, srcDirRaw, tgtFull, tgtDirRaw, dblLabel, sglLabel] = full;
    const src = splitNodeRef(srcFull);
    const tgt = splitNodeRef(tgtFull);
    return buildEdge(src.nodeId, src.lane, srcDirRaw, tgt.nodeId, tgt.lane, tgtDirRaw, dblLabel ?? sglLabel ?? "", ctx);
  }

  // Source-handle-only syntax.
  const srcOnly = normalizedLine.match(
    /^(.+?)\.handle\(([^)]+)\)\s*->\s*(.+?)(?:\s*\[label\s*[:=]\s*(?:"([^"]*)"|'([^']*)')\])?$/,
  );
  if (srcOnly) {
    const [, srcFull, srcDirRaw, tgtFull, dblLabel, sglLabel] = srcOnly;
    const src = splitNodeRef(srcFull);
    const tgt = splitNodeRef(tgtFull);
    return buildEdge(src.nodeId, src.lane, srcDirRaw, tgt.nodeId, tgt.lane, null, dblLabel ?? sglLabel ?? "", ctx);
  }

  // No-handle shortcut.
  if (!normalizedLine.includes(".handle")) {
    const bare = normalizedLine.match(
      /^((?:\w+\.)?\w+)\s*->\s*((?:\w+\.)?\w+)(?:\s*\[label\s*[:=]\s*(?:"([^"]*)"|'([^']*)')\])?$/,
    );
    if (bare) {
      const [, srcFull, tgtFull, dblLabel, sglLabel] = bare;
      const src = splitNodeRef(srcFull);
      const tgt = splitNodeRef(tgtFull);
      return buildEdge(src.nodeId, src.lane, null, tgt.nodeId, tgt.lane, null, dblLabel ?? sglLabel ?? "", ctx);
    }
  }

  return null;
}
