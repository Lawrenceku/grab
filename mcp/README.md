# grab-mcp

Model Context Protocol (MCP) stdio server for [grab-api](https://github.com/lawrenceku/grab).

Exposes two tools over stdio:
- `list_instances`: lists configured named API instances, their base URLs, allowed methods, and paths.
- `request`: sends HTTP requests via configured instances with allowlist checks, secret redaction, and response shaping.

## Usage

Configure in your MCP client (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "grab": {
      "command": "npx",
      "args": ["-y", "grab-mcp"],
      "env": {
        "STRIPE_KEY": "sk_test_..."
      }
    }
  }
}
```

Configuration is loaded from `~/.config/grab-mcp/config.json` or the path specified in `GRAB_MCP_CONFIG`.
