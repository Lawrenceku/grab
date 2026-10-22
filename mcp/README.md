# grab-mcp

Model Context Protocol (MCP) server & CLI for [grab-api](https://www.npmjs.com/package/grab-api).

**grab-mcp** lets AI coding assistants (Claude Desktop, Cursor, Antigravity, etc.) interact with external APIs safely. Your API keys are injected at request dispatch and **never enter the AI model's context or conversation history**.

---

## Quick Setup (1 Guided Step)

Run the interactive setup in your project terminal:

```bash
npx grab-mcp init
```

`grab-mcp init` scans your project (dependencies, code references, URLs) to detect matching API presets, confirms your environment variable names, validates your configuration, and prints the ready-to-use MCP client config snippet.

> **Security Note:** The scanner inspects `package.json` and code references to variable names. It **never** reads `.env` files or prints secret values.

---

## Built-In Presets (v1)

grab-mcp ships with safe-by-default presets that work **read-only (GET)** out of the box:

| Preset | Base URL | Auth Type | Default Env Var | Default Allowed Paths | Mode |
|---|---|---|---|---|---|
| **`stripe`** | `https://api.stripe.com/v1` | Bearer | `STRIPE_SECRET_KEY` | `/customers`, `/customers/*`, `/charges/*`, `/invoices/*`, `/payment_intents/*`, `/balance*` | Read-only (`GET`) |
| **`github`** | `https://api.github.com` | Bearer | `GITHUB_TOKEN` | `/repos/*/*`, `/orgs/*`, `/user`, `/users/*` | Read-only (`GET`) |

*Why read-only by default?* AI agents should not be able to mutate customer data or incur charges without deliberate configuration. Mutating methods (`POST`, `PUT`, `DELETE`) require explicit operator opt-in.

---

## CLI Commands

The `grab-mcp` binary routes to CLI tools when given explicit subcommands:

```bash
# Guided interactive setup (or -y for non-interactive defaults)
npx grab-mcp init

# Add a specific preset instance
npx grab-mcp add stripe --env STRIPE_SECRET_KEY
npx grab-mcp add github --env GITHUB_TOKEN

# List all configured instances and policy rules
npx grab-mcp list

# Remove a configured instance
npx grab-mcp remove stripe

# Diagnose configuration and check environment variables
npx grab-mcp doctor
```

### Options
- `--config <path>`: Specify a custom configuration file path (default: `~/.config/grab-mcp/config.json` or `$GRAB_MCP_CONFIG`).
- `--env <VAR>`: Custom environment variable name holding the secret.

Configs are automatically written with restricted permissions (`mode: 0600`).

---

## Running as MCP Server

When invoked **with no arguments**, `npx grab-mcp` starts the MCP stdio server. This maintains 100% backward compatibility with all existing MCP client setups:

```json
{
  "mcpServers": {
    "grab": {
      "command": "npx",
      "args": ["-y", "grab-mcp"],
      "env": {
        "STRIPE_SECRET_KEY": "sk_live_...",
        "GITHUB_TOKEN": "ghp_..."
      }
    }
  }
}
```

### Exposed MCP Tools

1. **`list_instances`**: Lists configured named instances, base URLs, allowed methods, allowed paths, and read-only flags. The agent knows what it can call without guessing.
2. **`request`**: Executes an HTTP request through a named instance.
   - `instance`: `"stripe"`
   - `method`: `"GET"`
   - `path`: `"/customers"`
   - `fields`: `["data.id", "data.email"]` *(optional token-saving field filter)*
   - `dryRun`: `true` *(optional validation without execution)*

---

## Security Model

1. **Zero Secret Leakage:** Secrets exist only in environment variables and are injected into outgoing requests. They are scrubbed from headers, response bodies, and error traces across raw, URL-encoded, and base64-encoded forms.
2. **Per-Hop Redirect Security:** Redirects are validated per hop. Auth headers are stripped on cross-host hops.
3. **Path Traversal Protection:** Relative traversal (`..`), percent-encoded tricks (`%2e%2e`), and origin jumps (`//evil.com`) are blocked before dispatch.
4. **Environment Isolation:** `doctor` and `init` report env var presence informatively without exposing values.
