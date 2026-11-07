/**
 * Single source of truth for the client identity sent on every outbound call.
 *
 * The version is read from package.json at runtime so a release bump cannot
 * leave a stale literal behind. Before this file existed the package sent five
 * different hardcoded versions from five different modules
 * (1.4.3 x3, 2.0.0, 2.1.0), which made server-side client segmentation measure
 * the code path rather than the client version.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version?: string };

export const CLIENT_NAME = "flowzap-mcp";
export const CLIENT_VERSION: string = pkg.version ?? "0.0.0";
export const USER_AGENT = `${CLIENT_NAME}/${CLIENT_VERSION}`;

export const CLIENT_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "X-MCP-Client": CLIENT_NAME,
  "X-MCP-Client-Version": CLIENT_VERSION,
};
