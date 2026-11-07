/**
 * flowzap_fix — deterministic FlowZap Code repair
 *
 * Calls the public FlowZap `/api/fix` endpoint and renders the result as plain
 * text suitable for an MCP `text` content block.
 *
 * The repair engine lives server-side (in the FlowZap app); this handler only
 * transports the code and formats the response. Repairs are bounded and
 * deterministic: anything the engine cannot repair is reported as-is — it never
 * invents content.
 *
 * Security: the endpoint is a compile-time constant on the `flowzap.xyz`
 * allowlist (SSRF-safe), the input is capped at 50 KB and sanitized (null bytes
 * and control characters stripped), and the request has a 30-second timeout.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { CLIENT_HEADERS } from "../clientMeta.js";

const FLOWZAP_API_BASE = "https://flowzap.xyz";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_CODE_LENGTH = 50_000;

export const fixCodeTool: Tool = {
  name: "flowzap_fix",
  description:
    "Deterministically repair mechanical FlowZap Code errors: non-sequential node numbering, inferred edge handles, node/edge label syntax (label:\"…\" on nodes vs [label=\"…\"] on edges), missing lane display labels, emoji and non-printable characters. Returns the repaired code plus the list of applied corrections. Errors that cannot be repaired are reported as-is — the repairer never invents content. Run flowzap_validate on the repaired code afterwards.",
  inputSchema: {
    type: "object" as const,
    properties: {
      code: {
        type: "string",
        description: "FlowZap Code to repair (max 50,000 chars)",
      },
      lng: {
        type: "string",
        enum: ["en", "fr", "zh"],
        description: "Response language hint (default: en)",
      },
    },
    required: ["code"],
  },
};

interface FixAppliedItem {
  code: string;
  message: string;
  count: number;
}

interface FixUnfixableItem {
  code: string;
  message: string;
}

interface FixPayload {
  success?: boolean;
  fixed?: boolean;
  code?: string;
  applied?: FixAppliedItem[];
  unfixable?: FixUnfixableItem[];
  validation?: { valid?: boolean };
  error?: string;
}

/** Strip null bytes and control characters, matching the other handlers. */
function sanitizeCode(input: string): string {
  return input
    .replace(/\0/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function renderFixResult(payload: FixPayload): string {
  const applied = Array.isArray(payload.applied) ? payload.applied : [];
  const unfixable = Array.isArray(payload.unfixable) ? payload.unfixable : [];
  const valid = payload.validation?.valid === true;

  // Nothing was repaired because the code already validates.
  if (!payload.fixed && valid) {
    return "✅ The code is already valid — no repair was needed.";
  }

  const sections: string[] = [];

  if (applied.length > 0) {
    sections.push("✅ Deterministic repairs applied:");
    for (const item of applied) {
      sections.push(`- ${item.code}: ${item.message} (×${item.count})`);
    }
  }

  if (typeof payload.code === "string") {
    sections.push("```");
    sections.push(payload.code);
    sections.push("```");
  }

  if (unfixable.length > 0) {
    sections.push("⚠️ Issues that could not be repaired automatically:");
    for (const item of unfixable) {
      sections.push(`- ${item.code}: ${item.message}`);
    }
    sections.push("Please correct these points manually — the repairer never invents content.");
  }

  return sections.join("\n");
}

/**
 * Repair FlowZap Code through the public API.
 *
 * @param rawCode Untrusted `code` argument from the MCP client.
 * @param _rawLng Accepted for schema parity with the HTTP MCP surface; the
 *                repair response is language-neutral code plus English
 *                validator messages, so it is not forwarded to the API.
 */
export async function handleFixCode(rawCode: unknown, _rawLng?: unknown): Promise<string> {
  if (typeof rawCode !== "string") {
    return "❌ Repair failed: `code` must be a string.";
  }
  if (rawCode.trim().length === 0) {
    return "❌ Repair failed: `code` cannot be empty.";
  }
  if (rawCode.length > MAX_CODE_LENGTH) {
    return `❌ Repair failed: \`code\` exceeds ${MAX_CODE_LENGTH.toLocaleString("en-US")} characters.`;
  }

  const code = sanitizeCode(rawCode);

  try {
    const response = await fetch(`${FLOWZAP_API_BASE}/api/fix`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...CLIENT_HEADERS,
      },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    let payload: FixPayload | null = null;
    try {
      payload = (await response.json()) as FixPayload;
    } catch {
      payload = null;
    }

    if (response.status === 429) {
      return "❌ Repair rate limit reached. Please wait a moment and try again (30 requests/minute per IP).";
    }

    if (!response.ok || !payload || payload.success !== true) {
      return "❌ Repair failed. Please try again later.";
    }

    return renderFixResult(payload);
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return "❌ Repair timed out after 30 seconds. Please try again.";
    }
    return "❌ Repair failed. Please try again.";
  }
}
