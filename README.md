# FlowZap MCP Server

Create workflow, sequence, and architecture diagrams using AI assistants like Claude, Cursor, Windsurf, and 8 other MCP-compatible tools.

[FlowZap](https://flowzap.xyz) is a visual workflow diagramming tool with a text-based DSL called **FlowZap Code**. This MCP server lets AI assistants create diagrams for you.

## What is FlowZap?

FlowZap turns text prompts into triple-view diagrams (Workflow, Sequence & Architecture) using FlowZap Code DSL. It is NOT Mermaid, NOT PlantUML - it is a unique domain-specific language designed for simplicity and AI generation.

**Key Facts:**
- Only 4 shapes: `circle`, `rectangle`, `diamond`, `taskbox`
- Node attributes use colon: `label:"Text"`
- Edge labels use equals: `[label="Text"]`
- Handles required: `n1.handle(right) -> n2.handle(left)`

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
| `flowzap_create_playground` | Create a shareable diagram URL |
| `flowzap_get_syntax` | Get FlowZap Code syntax documentation |

### Agent-Focused Tools
| Tool | Description |
|------|-------------|
| `flowzap_export_graph` | Export FlowZap Code as structured JSON graph (lanes, nodes, edges) for reasoning |
| `flowzap_artifact_to_diagram` | Parse HTTP logs, OpenAPI specs, or code into FlowZap diagrams |
| `flowzap_diff` | Compare two versions of FlowZap Code and get structured diff |
| `flowzap_apply_change` | Apply structured patch operations (insert/remove/update nodes/edges) |

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

The assistant will:
1. Generate FlowZap Code based on your description
2. Validate the code
3. Create a playground URL with the appropriate view (workflow, sequence, or architecture) to view and share

## FlowZap Code Example

```
sales { # Sales Team
  n1: circle label:"Order Received"
  n2: rectangle label:"Validate Order"
  n3: diamond label:"Valid?"
  n1.handle(right) -> n2.handle(left)
  n2.handle(right) -> n3.handle(left)
  n3.handle(right) -> fulfillment.n4.handle(left) [label="Yes"]
}

fulfillment { # Fulfillment
  n4: rectangle label:"Process Order"
  n5: circle label:"Complete"
  n4.handle(right) -> n5.handle(left)
}
```

## Security

- **No authentication required** - Uses only public FlowZap APIs
- **No user data access** - Cannot read your diagrams or account
- **Runs locally** - The MCP server runs on your machine
- **SSRF protected** - Only connects to flowzap.xyz
- **Rate limited** - 30 requests/minute client-side
- **Input validation** - 50KB max code size

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
