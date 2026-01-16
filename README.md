# FlowZap MCP Server

Create sequence and workflow diagrams using AI assistants like Claude, Cursor, and Windsurf.

## What is FlowZap?

[FlowZap](https://flowzap.xyz) is an AI workflow and sequence diagramming tool with a text-based DSL called **FlowZap Code**. This MCP server lets AI assistants create Sequence and Worflow diagrams in seconds.

## Installation

### For Claude Desktop

Add to your `claude_desktop_config.json`:

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

Config file locations:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### For Cursor

Add to your Cursor MCP settings with the same configuration.

### For Windsurf IDE

Add to your `~/.codeium/windsurf/mcp_config.json`:

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

## Available Tools

### `flowzap_validate`
Validate FlowZap Code syntax before creating a diagram.

### `flowzap_create_playground`
Create a shareable playground URL with your diagram.

### `flowzap_get_syntax`
Get FlowZap Code syntax documentation and examples.

## Usage Examples

Ask your AI assistant:

- "Generate a Sequence diagram of the current Sign In flow implemented in this App"
- "Create a workflow diagram for an order processing system"
- "Make a flowchart showing user registration flow"
- "Diagram a CI/CD pipeline with build, test, and deploy stages"

The assistant will:
1. Generate FlowZap Code based on your description
2. Validate the code
3. Create a playground URL to view the diagrams and share

## FlowZap Code Example

```
sales {
  # Sales Team
  n1: circle label:"Order Received"
  n2: rectangle label:"Validate Order"
  n3: diamond label:"Valid?"
  n1.handle(right) -> n2.handle(left)
  n2.handle(right) -> n3.handle(left)
  n3.handle(right) -> fulfillment.n4.handle(left) [label="Yes"]
  n3.handle(bottom) -> n6.handle(top) [label="No"]
  n6: rectangle label:"Reject Order"
}

fulfillment {
  # Fulfillment
  n4: rectangle label:"Process Order"
  n5: circle label:"Complete"
  n4.handle(right) -> n5.handle(left)
}
```

**Key syntax rules:**
- **Node IDs**: Must be `n1`, `n2`, `n3`... (globally unique, sequential)
- **Shapes**: Only `circle`, `rectangle`, `diamond`, `taskbox`
- **Node attributes**: Use colon → `label:"Text"`
- **Edge labels**: Use equals in brackets → `[label="Yes"]`
- **Edges**: Must use handles → `n1.handle(right) -> n2.handle(left)`
- **Cross-lane**: Prefix with lane name → `fulfillment.n4.handle(left)`

## Security

This MCP server implements comprehensive security measures:

### What It Does
- **Only calls official FlowZap APIs** - Hardcoded to `https://flowzap.xyz` only
- **No authentication required** - Uses only public, anonymous endpoints
- **No user data access** - Cannot read your diagrams, account, or any private data
- **Runs locally** - The server runs on your machine, not exposed to the internet

### Security Features
- **SSRF Protection** - URL whitelist prevents requests to unauthorized hosts
- **Input Validation** - Code size limits (50KB max), sanitization of control characters
- **Rate Limiting** - Client-side rate limiting (30 requests/minute)
- **Request Timeout** - 30-second timeout prevents hanging connections
- **Response Sanitization** - Only expected fields are returned from API responses
- **Error Handling** - Internal errors are logged but not exposed to clients
- **Tool Whitelisting** - Only explicitly defined tools can be called

### What It Cannot Do
- Access your FlowZap account or saved diagrams
- Modify any existing data
- Make requests to any domain other than flowzap.xyz
- Store any credentials or tokens

## Links

- [FlowZap Website](https://flowzap.xyz)
- [FlowZap Code Documentation](https://flowzap.xyz/flowzap-code)
- [FlowZap MCP](https://flowzap.xyz/blog/introducing-the-flowzap-mcp-server)
- [npm Package](https://www.npmjs.com/package/flowzap-mcp)
- [MCP Registry](https://registry.modelcontextprotocol.io)

## License

MIT
