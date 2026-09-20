# FlowZap MCP Server

[![npm version](https://img.shields.io/npm/v/flowzap-mcp)](https://www.npmjs.com/package/flowzap-mcp) [![MCP](https://img.shields.io/badge/MCP-2.1.0-purple)](https://flowzap.xyz/docs/mcp)

Create workflow, sequence, architecture, and mind map diagrams using AI assistants like Claude, Cursor, Windsurf, and 8 other MCP-compatible tools.

[FlowZap](https://flowzap.xyz) is a visual workflow diagramming tool with a text-based DSL called **FlowZap Code**. This MCP server lets AI assistants create diagrams for you.

## What is FlowZap?

FlowZap turns text prompts into quad-view diagrams (Workflow, Sequence, Architecture & Mind Map) using FlowZap Code DSL. It is NOT Mermaid, NOT PlantUML - it is a unique domain-specific language designed for simplicity and AI generation.

**Key Facts:**
- Only 4 shapes: `circle`, `rectangle`, `diamond`, `taskbox`
- Node attributes use colon: `label:"Text"`
- Edge labels use equals: `[label="Text"]`
- Handles required: `n1.handle(right) -> n2.handle(left)`
- Lane display label must be on the same line as the opening brace: `laneName { # Label`
- Sequence diagram quality: every cross-lane request needs a matching response edge before the next major request; define edges in chronological order; keep a strict request → response → next request rhythm; no orphaned nodes

## Installation

The FlowZap MCP Server works with **any tool that supports the Model Context Protocol (MCP)**:

### All Compatible Coding Tools

| Tool | How to Configure |
|------|------------------|
| **Claude Desktop** | Add to `claude_desktop_config.json`:<br>**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`<br>**Windows:** `%APPDATA%\Claude\claude_desktop_config.json` |
| **Claude Code** | Run: `claude mcp add --transport stdio flowzap -- npx -y flowzap-mcp`<br>Or add to `.mcp.json` in your project root. |
| **Cursor** | Open Settings → Features → MCP Servers → Add Server. Use the same JSON config. |
| **Windsurf IDE** | Add to `~/.codeium/windsurf/mcp_config.json` |
| **OpenAI Codex** | Add to `~/.codex/config.toml`:<br>`[mcp_servers.flowzap]`<br>`command = "npx"`<br>`args = ["-y", "flowzap-mcp"]`<br>Or run: `codex mcp add flowzap -- npx -y flowzap-mcp` |
| **Warp Terminal** | Settings → MCP Servers → Click "+ Add" → Paste the JSON config. |
| **Zed Editor** | Add to `settings.json`:<br>`{"context_servers": {"flowzap": {"command": "npx", "args": ["-y", "flowzap-mcp"]}}}` |
| **Cline** (VS Code) | Open Cline sidebar → MCP Servers icon → Edit `cline_mcp_settings.json` |
| **Roo Code** (VS Code) | Add to `.roo/mcp.json` in project or global settings. |
| **Continue.dev** | Create `.continue/mcpServers/flowzap.yaml` with:<br>`name: FlowZap`<br>`mcpServers:`<br>`  - name: flowzap`<br>`    command: npx`<br>`    args: ["-y", "flowzap-mcp"]` |
| **Sourcegraph Cody** | Add to VS Code `settings.json` via `openctx.providers` configuration. |

> **Not Compatible:** Replit and Lovable.dev only support remote MCP servers via URL. Use the [Public API](https://flowzap.xyz/api/playground/create) instead.

### JSON Configuration

All tools use the same JSON configuration format:

```json
{
  "mcpServers": {
    "flowzap": {
      "command": "npx",
      "args": ["-y", "flowzap-mcp"]
    }
  }
}
```

> **Windows Users:** If tools don't appear, use the absolute path:
> ```json
> "command": "C:\\Program Files\\nodejs\\npx.cmd"
> ```
> Find your npx path with: `where.exe npx`

## Available Tools

### Core Tools
| Tool | Description |
|------|-------------|
| `flowzap_validate` | Validate FlowZap Code syntax |
| `flowzap_fix` | Deterministically repair mechanical FlowZap Code errors (numbering, inferred handles, label syntax, missing lane labels, emoji/control chars) and return the repaired code plus the corrections applied |
| `flowzap_create_playground` | Create a shareable diagram URL |
| `flowzap_get_syntax` | Get FlowZap Code syntax documentation |

### Agent-Focused Tools
| Tool | Description |
|------|-------------|
| `flowzap_export_graph` | Export FlowZap Code as structured JSON graph (lanes, nodes, edges) for reasoning |
| `flowzap_artifact_to_diagram` | Parse HTTP logs, OpenAPI specs, or code into FlowZap diagrams |
| `flowzap_diff` | Compare two versions of FlowZap Code and get structured diff |
| `flowzap_apply_change` | Apply structured patch operations (insert/remove/update nodes/edges) |

### Compliance Tool
| Tool | Description |
|------|-------------|
| `flowzap_compliance_check` | Run automated SOC2, GDPR, and PIPL compliance analysis on a FlowZap Code data-flow diagram. Backed by Deepseek LLM with strict rate limits (3/day per IP, 1/hour burst, global 5-min circuit breaker). Returns a shareable ephemeral result URL (60-min TTL). |

### Mind Map Tools
| Tool | Description |
|------|-------------|
| `flowzap_mindmap_validate` | Validate FlowZap Code syntax and mind-map readiness |
| `flowzap_mindmap_approve` | Check if code is suitable for Mind Map rendering (diamonds/taskboxes = ERROR) |
| `flowzap_mindmap_template` | Generate a ready-to-extend Mind Map tree skeleton |
| `flowzap_mindmap_create_playground` | Create a playground URL with `?view=mindmap` |

## Usage Examples

### Basic Diagram Creation
Ask your AI assistant:
- "Generate a Sequence diagram of the current Sign In flow implemented in this App"
- "Create a workflow diagram for an order processing system"
- "Create an architecture diagram for a microservices API gateway"
- "Make a flowchart showing user registration flow"
- "Diagram a CI/CD pipeline with build, test, and deploy stages"

### Agent-Focused Workflows

**Parse HTTP Logs into Diagrams:**
```
"Here are my nginx access logs. Create a sequence diagram showing the request flow."
```
The agent uses `flowzap_artifact_to_diagram` with `artifactType: "http_logs"`.

**Analyze Diagram Structure:**
```
"Which steps in this workflow touch the database?"
```
The agent uses `flowzap_export_graph` to get a JSON graph, then queries it.

**Show What Changed:**
```
"I updated the workflow. What's different from the previous version?"
```
The agent uses `flowzap_diff` to compare old and new code.

**Safe Incremental Updates:**
```
"Add a logging step after the API call in this diagram."
```
The agent uses `flowzap_apply_change` with a structured patch instead of regenerating.

**Repair Invalid Code:**
```
"My FlowZap Code fails validation. Fix the mechanical errors for me."
```
The agent uses `flowzap_fix` to deterministically repair numbering, inferred handles, label syntax, lane labels, emoji and control characters, then validates the repaired code. Anything the repairer cannot fix is reported as-is — it never invents content.

**Compliance Audit:**
```
"Check my data flow diagram for SOC2, GDPR, and PIPL compliance."
```
The agent uses `flowzap_compliance_check` to run an automated audit and returns a shareable result page.

**Mind Map Creation:**
```
"Create a mind map about AI agent architecture"
```
The agent uses `flowzap_mindmap_template` to generate a skeleton, then validates and creates a playground with `?view=mindmap`.

The assistant will:
1. Generate FlowZap Code based on your description
2. Validate the code
3. Create a playground URL with the appropriate view (workflow, sequence, or architecture) to view and share

## FlowZap Code Example

```
sales { # Sales Team
  n1: circle label:"Order Received"
  n2: rectangle label:"Submit Order"
  n5: rectangle label:"Receive decision"
  n1.handle(right) -> n2.handle(left)
  n2.handle(bottom) -> fulfillment.n3.handle(top) [label="Submit"]
}

fulfillment { # Fulfillment
  n3: rectangle label:"Review Order"
  n4: rectangle label:"Return decision"
  n3.handle(right) -> n4.handle(left)
  n4.handle(top) -> sales.n5.handle(bottom) [label="Approved"]
}
```

## Public API Endpoints

These endpoints are available for external integrations (no authentication required):

| Endpoint | Method | Rate Limit | Description |
|----------|--------|------------|-------------|
| `/api/validate` | POST | 30/min | Validate FlowZap Code syntax |
| `/api/fix` | POST | 30/min | Deterministically repair mechanical FlowZap Code errors and return the repaired code + applied corrections |
| `/api/playground/create` | POST | 5/min, 50/day | Create ephemeral playground URL (15-min TTL) |
| `/api/compliance-check` | POST | 5/min, 30/day | Run SOC2/GDPR/PIPL compliance analysis on FlowZap Code. Returns frameworks + shareable result URL (60-min TTL). Backed by Deepseek LLM. |

## Security

- **No authentication required** - Uses only public FlowZap APIs
- **No user data access** - Cannot read your diagrams or account
- **Runs locally** - The MCP server runs on your machine
- **SSRF protected** - Only connects to flowzap.xyz
- **Rate limited** - 30 requests/minute client-side
- **Input validation** - 50KB max code size

## Agent Skill (skills.sh)

Install the FlowZap skill for 40+ compatible coding agents via [skills.sh](https://skills.sh):

```bash
npx skills add flowzap-xyz/flowzap-mcp
```

- **skills.sh listing:** [https://skills.sh/flowzap-xyz/flowzap-mcp/flowzap-diagrams](https://skills.sh/flowzap-xyz/flowzap-mcp/flowzap-diagrams)
- **Skill source:** [skills/flowzap-diagrams/](https://github.com/flowzap-xyz/flowzap-mcp/tree/main/skills/flowzap-diagrams)
- Compatible with: Claude Code, Cursor, Windsurf, Codex, Gemini CLI, GitHub Copilot, Cline, Roo Code, Augment, OpenCode, and more.

## Public MCP Adoption Signals

- **Public MCP Usage Stats:** [https://flowzap.xyz/.well-known/flowzap-stats.json](https://flowzap.xyz/.well-known/flowzap-stats.json)
- **MCP Calls Badge JSON:** [https://flowzap.xyz/.well-known/flowzap-stats-badge.json](https://flowzap.xyz/.well-known/flowzap-stats-badge.json)

## Official Listings

- **Official MCP Registry:** [https://registry.modelcontextprotocol.io/?q=flowzap](https://registry.modelcontextprotocol.io/?q=flowzap)
- **Smithery Server:** [https://smithery.ai/server/@flowzap/flowzap](https://smithery.ai/server/@flowzap/flowzap)
- **Smithery Skill:** [https://smithery.ai/skills/Flowzap/diagram-skill](https://smithery.ai/skills/Flowzap/diagram-skill)
- **PulseMCP:** [https://www.pulsemcp.com/servers/flowzap](https://www.pulsemcp.com/servers/flowzap)
- **Glama:** [https://glama.ai/mcp/servers/flowzap-xyz/flowzap-mcp](https://glama.ai/mcp/servers/flowzap-xyz/flowzap-mcp)
- **MCPServers.org:** [https://mcpservers.org/servers/flowzap-xyz-docs-mcp](https://mcpservers.org/servers/flowzap-xyz-docs-mcp)
- **AIBase:** [https://mcp.aibase.com/server/1639702939289526535](https://mcp.aibase.com/server/1639702939289526535)

## Links

- [FlowZap Website](https://flowzap.xyz)
- [FlowZap Code Documentation](https://flowzap.xyz/flowzap-code)
- [FlowZap MCP Blog](https://flowzap.xyz/blog/introducing-the-flowzap-mcp-server)
- [LLM Context](https://flowzap.xyz/llms.txt)
- [Templates Library](https://flowzap.xyz/templates)
- [npm Package](https://www.npmjs.com/package/flowzap-mcp)
- [GitHub Repository](https://github.com/flowzap-xyz/flowzap-mcp)

## License

MIT
