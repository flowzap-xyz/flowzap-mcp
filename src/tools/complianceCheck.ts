/**
 * flowzap_compliance_check — automated SOC2 / GDPR / PIPL compliance analysis
 *
 * Calls the public FlowZap compliance endpoint and renders the result as
 * Markdown text suitable for an MCP `text` content block.
 *
 * Strict server-side rate limits apply (3/day per IP, 1/hour burst, global
 * 5-minute circuit breaker). This tool surfaces those limits cleanly to the
 * agent without leaking internal details.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const FLOWZAP_API_BASE = "https://flowzap.xyz";
const REQUEST_TIMEOUT_MS = 30_000;
const ALLOWED_LNG = ["en", "fr", "zh"] as const;
type ComplianceLng = (typeof ALLOWED_LNG)[number];

const STATUS_ICON: Record<string, string> = {
  present: "✅",
  partial: "⚠️",
  missing: "❌",
};

const FRAMEWORK_LABELS: Record<string, string> = {
  gdpr: "GDPR",
  soc2: "SOC2",
  pipl: "PIPL",
};

export const complianceCheckTool: Tool = {
  name: "flowzap_compliance_check",
  description:
    "Run automated SOC2, GDPR, and PIPL compliance analysis on a FlowZap Code data-flow diagram. Returns a Markdown audit report with risks, recommendations, and a link to the manual checker. Backed by Deepseek LLM with strict rate limits (3/day per IP, 1/hour burst, global 5-min circuit breaker). Use when the user asks for a privacy, security, or regulatory review of a data-flow diagram.",
  inputSchema: {
    type: "object" as const,
    properties: {
      code: {
        type: "string",
        description: "FlowZap Code data-flow diagram to analyze (max 50,000 chars)",
      },
      lng: {
        type: "string",
        enum: ["en", "fr", "zh"],
        description: "Response language (default: en)",
      },
    },
    required: ["code"],
  },
};

interface ComplianceFinding {
  control: string;
  status: string;
  detail: string;
  recommendation?: string;
}

interface ComplianceResponse {
  frameworks?: {
    gdpr?: { findings?: ComplianceFinding[] };
    soc2?: { findings?: ComplianceFinding[] };
    pipl?: { findings?: ComplianceFinding[] };
  };
  disclaimer?: string;
  error?: string;
  code?: string;
  retryAfter?: number;
}

function renderFindings(findings: ComplianceFinding[]): string {
  if (!findings || findings.length === 0) {
    return "_No specific findings flagged for this framework._";
  }
  return findings
    .slice(0, 8)
    .map((f) => {
      const icon = STATUS_ICON[f.status] || "•";
      const rec = f.recommendation ? `\n  - **Recommendation:** ${f.recommendation}` : "";
      return `- ${icon} **${f.control}** (${f.status}): ${f.detail}${rec}`;
    })
    .join("\n");
}

function renderMarkdown(payload: ComplianceResponse): string {
  const fw = payload.frameworks || {};
  const sections: string[] = ["# Compliance Check Results (SOC2 · GDPR · PIPL)\n"];
  for (const key of ["gdpr", "soc2", "pipl"] as const) {
    const findings = fw[key]?.findings || [];
    sections.push(`## ${FRAMEWORK_LABELS[key]} (${findings.length} finding${findings.length === 1 ? "" : "s"})`);
    sections.push(renderFindings(findings));
    sections.push("");
  }
  if (payload.disclaimer) {
    sections.push(`---\n${payload.disclaimer}`);
  }
  sections.push(
    "\nFor a full interactive audit, visit https://flowzap.xyz/soc2-gdpr-pipl-compliance-checker",
  );
  return sections.join("\n");
}

export async function handleComplianceCheck(
  rawCode: unknown,
  rawLng: unknown,
): Promise<string> {
  if (typeof rawCode !== "string") {
    return "❌ Compliance check failed: `code` must be a string.";
  }
  if (rawCode.trim().length === 0) {
    return "❌ Compliance check failed: `code` cannot be empty.";
  }
  if (rawCode.length > 50_000) {
    return "❌ Compliance check failed: `code` exceeds 50,000 characters.";
  }

  const lng: ComplianceLng =
    typeof rawLng === "string" && (ALLOWED_LNG as readonly string[]).includes(rawLng)
      ? (rawLng as ComplianceLng)
      : "en";

  const sanitizedCode = rawCode
    .replace(/\0/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${FLOWZAP_API_BASE}/api/compliance-check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "flowzap-mcp/1.4.0",
        "X-MCP-Client": "flowzap-mcp",
      },
      body: JSON.stringify({ code: sanitizedCode, lng }),
      signal: controller.signal,
    });

    let payload: ComplianceResponse | null = null;
    try {
      payload = (await response.json()) as ComplianceResponse;
    } catch {
      payload = null;
    }

    if (response.status === 429) {
      const retryAfter = payload?.retryAfter ? ` Retry in ~${payload.retryAfter}s.` : "";
      return `❌ Compliance check rate limit exceeded.${retryAfter} Limits: 3 successful checks/day per IP, 1/hour burst, global 5-min circuit breaker. Try the manual checker at https://flowzap.xyz/soc2-gdpr-pipl-compliance-checker.`;
    }

    if (!response.ok || !payload || payload.error) {
      const message = payload?.error || `API error: ${response.status}`;
      return `❌ Compliance check failed: ${message}`;
    }

    return renderMarkdown(payload);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return "❌ Compliance check timed out after 30 seconds. Please try again.";
    }
    return "❌ Compliance check failed. Please try again.";
  } finally {
    clearTimeout(timeoutId);
  }
}
