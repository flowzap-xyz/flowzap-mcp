# FlowZap MCP Server

Create workflow diagrams using AI assistants like Claude, Comet, and Cursor.

## What is FlowZap?

[FlowZap](https://flowzap.xyz) is a visual workflow diagramming tool with a text-based DSL called **FlowZap Code**. This MCP server lets AI assistants create diagrams for you.

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

### For Comet Browser

Use the Remote MCP URL: `https://flowzap.xyz/mcp/api/sse`

## Available Tools

### `flowzap_validate`
Validate FlowZap Code syntax before creating a diagram.

### `flowzap_create_playground`
Create a shareable playground URL with your diagram.

### `flowzap_get_syntax`
Get FlowZap Code syntax documentation and examples.

## Usage Examples

Ask your AI assistant:

- "Create a workflow diagram for an order processing system"
- "Make a flowchart showing user registration flow"
- "Diagram a CI/CD pipeline with build, test, and deploy stages"

The assistant will:
1. Generate FlowZap Code based on your description
2. Validate the code
3. Create a playground URL you can view and share

## FlowZap Code Example

```
sales {
  # Sales Team
  start: circle label:"Order Received"
  validate: rect label:"Validate Order"
  check: diamond label:"Valid?"
  start -> validate -> check
}

fulfillment {
  # Fulfillment
  process: rect label:"Process Order"
  ship: rect label:"Ship Items"
  end: circle label:"Complete"
  process -> ship -> end
}
```

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
- [API Documentation](https://flowzap.xyz/docs/agent-api)
- [Security Policy](https://flowzap.xyz/terms/agents)

## License

MIT
