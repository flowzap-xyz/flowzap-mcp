/**
 * Playground API utilities for MCP tools
 * 
 * Shared functions for creating playground URLs from FlowZap Code.
 */

const FLOWZAP_API_BASE = "https://flowzap.xyz";
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Create a playground session and return the URL
 */
export async function createPlaygroundUrl(code: string): Promise<{ url?: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(`${FLOWZAP_API_BASE}/api/playground/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "flowzap-mcp/1.3.4",
        "X-MCP-Client": "flowzap-mcp",
      },
      body: JSON.stringify({ code, source: 'mcp' }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { error: `API error: ${response.status}` };
    }

    const result = await response.json();

    if (result.url) {
      return { url: result.url };
    }

    return { error: result.error || "Unknown error creating playground" };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { error: "Request timed out" };
    }
    return { error: `Failed to create playground: ${error instanceof Error ? error.message : String(error)}` };
  }
}
