<br>
<div align="center">
  <img src="https://raw.githubusercontent.com/Lawrenceku/assets/refs/heads/main/images/grab-logo.png" alt="grab-api logo" width="250" style="margin-bottom: 15px;"/>
  <p style="font-size: 18px; font-weight: bold; margin-bottom: 10px;">The safe, token-efficient HTTP client for humans and AI agents.</p>
  <p style="font-size: 14px; color: #666; max-width: 650px;">
    An adapter-based, axios-compatible TypeScript HTTP client for browser and Node.js, featuring guardrails, secret protection, structural response shaping, and an official Model Context Protocol (MCP) server.
  </p>
</div>

<div align="center">

[![npm version](https://img.shields.io/npm/v/grab-api.svg?style=flat-square)](https://www.npmjs.org/package/grab-api)
[![CI](https://img.shields.io/github/actions/workflow/status/lawrenceku/grab/ci.yml?branch=main&label=CI&style=flat-square)](https://github.com/lawrenceku/grab/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg?style=flat-square)](https://www.typescriptlang.org/)

</div>

<br>

---

## Why grab-api?

Giving an AI agent raw `curl` or `fetch` via bash or code execution creates major reliability and security issues:
- **Secret leakage:** Bearer tokens and API keys are exposed directly in prompt context, tool calls, or stack traces.
- **Accidental destruction:** Agents can run `DELETE` on production databases or re-run non-idempotent `POST` requests after a network blip.
- **Context window bloat:** Unbounded JSON payloads consume tens of thousands of tokens and blow context limits.
- **Silent cross-host leaks:** Unchecked redirects forward credentials to external hosts.

**grab-api** solves these problems in the **library layer**, so whether you use `grab-api` directly in your TypeScript agents or expose it via the official **`grab-mcp`** server, the guardrails are enforced.

---

## Threat Model & Security Posture

We believe in stating security trade-offs plainly. Security in `grab-api` is based on defense-in-depth:

1. **Allowlists are only as strong as your configuration:**
   - If you configure `paths: ['/**']` and `methods: ['*']`, the agent has unrestricted access to that host. Keep your allowlists narrow (e.g. `methods: ['GET']`, `paths: ['/v1/customers/*']`).
2. **API response content is UNTRUSTED:**
   - Prompt injection through external API responses is a real vector (e.g. an external API returning text like `"Ignore previous instructions and do X"`). While `grab-api` shapes response bodies, limits tokens, and redacts secrets, **it cannot sanitize the semantic content against prompt injection**. Always instruct your models to treat API outputs as untrusted data.
3. **Secrets are never seen by the agent:**
   - Secrets are referenced by environment variable name in config files (`{ "type": "bearer", "env": "STRIPE_KEY" }`), never by value.
   - When requests execute, secrets are resolved from `process.env` and automatically scrubbed from headers, error objects, and response bodies before returning to the agent.
4. **Path Traversal & Host Jump Protection:**
   - Paths are normalized before allowlist checks: `%2e%2e`, `%2f`, and `%5c` are decoded, `.` and `..` segments are collapsed, and URLs are resolved against `baseURL`.
   - Protocol-relative URLs (`//evil.com`), authority tricks (`user@host`), and origin mismatches are blocked with `ERR_FORBIDDEN`.
5. **Hop-by-Hop Redirect Validation:**
   - Redirects are executed manually with allowlist and host checks re-verified on every hop.
   - Sensitive auth headers (`Authorization`, `Cookie`, API keys) are **automatically stripped** on cross-host hops.
6. **Safe Retries by Default:**
   - Automatic retries on 429/5xx only execute on idempotent methods (`GET`, `HEAD`, `PUT`, `DELETE`, `OPTIONS`). Retrying `POST` is strictly opt-in (`retryPost: true`) to avoid duplicate mutations.

---

## 📦 Installation

```bash
# Core HTTP client library
npm install grab-api

# Or MCP server for AI coding assistants (Claude Desktop, Cursor, etc.)
npm install -g grab-mcp
# or run on demand:
npx grab-mcp
```

---

## AI Agent & MCP Usage

### 1. Configuration File

Define named instances in `~/.config/grab-mcp/config.json` (or set `GRAB_MCP_CONFIG=/path/to/config.json`):

```json
{
  "instances": {
    "stripe": {
      "baseURL": "https://api.stripe.com/v1",
      "auth": {
        "type": "bearer",
        "env": "STRIPE_SECRET_KEY"
      },
      "allow": {
        "methods": ["GET", "POST"],
        "paths": ["/customers", "/customers/*", "/charges/*"],
        "hosts": ["files.stripe.com"]
      },
      "rateLimitPerMin": 60,
      "maxResponseBytes": 20000
    },
    "github-read": {
      "baseURL": "https://api.github.com",
      "auth": {
        "type": "header",
        "headerName": "Authorization",
        "env": "GITHUB_TOKEN"
      },
      "readOnly": true,
      "allow": {
        "paths": ["/repos/*/*", "/orgs/*"]
      }
    }
  },
  "limits": {
    "maxResponseBytes": 50000,
    "rateLimitPerMin": 120,
    "maxRetries": 2
  },
  "auditLogPath": "~/.config/grab-mcp/audit.log"
}
```

### 2. Using `grab-mcp` with AI Assistants

Configure `grab-mcp` in your assistant's MCP configuration (e.g. `claude_desktop_config.json` or Cursor):

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

The MCP server provides two tools:
- **`list_instances`**: Returns metadata about all available instances (name, base URL, allowed methods, paths, and `readOnly` flags). The agent never has to guess what endpoints it can reach.
- **`request`**: Executes an HTTP request via a named instance with automatic allowlist enforcement, secret redaction, and response shaping:
  - `instance`: `"stripe"`
  - `method`: `"GET"`
  - `path`: `"/customers"`
  - `fields`: `["data.id", "data.email", "data.name"]` *(cuts token usage by up to 90%)*
  - `dryRun`: `true` *(validates allowlist and returns what would be sent without firing the request)*

### 3. Programmatic Agent API in TypeScript

You can also use the agent features directly in your backend code:

```typescript
import { loadConfig, agentRequest, listInstances } from 'grab-api';

const config = loadConfig();

// Safe instance listing
const instances = listInstances(config);

// Send token-efficient request with field extraction
const result = await agentRequest(
  config,
  'stripe',
  'GET',
  '/customers',
  null,
  {
    fields: ['data.id', 'data.email'],
    maxBytes: 10000,
  }
);

console.log(result.data); // Clean JSON containing only selected fields
console.log(result.truncated); // boolean indicating whether payload was truncated
```

---

##  Classic HTTP Client API (Axios-Compatible)

`grab-api` remains a full-featured, zero-dependency HTTP client for browser and Node.js.

### Basic Requests

```typescript
import grab from 'grab-api';

// Simple GET
const response = await grab.get('https://api.example.com/users');
console.log(response.data);

// POST with JSON body
const created = await grab.post('https://api.example.com/users', {
  name: 'Jane Doe',
  email: 'jane@example.com',
});
```

### Configured Instances

```typescript
import { GrabInstance } from 'grab-api';

const api = GrabInstance.create({
  baseURL: 'https://api.example.com',
  timeout: 5000,
  headers: {
    'Content-Type': 'application/json',
  },
});

const user = await api.get('/users/123');
```

### Interceptors

```typescript
// Request interceptor
api.interceptors.request.use((config) => {
  config.headers['X-Request-Time'] = Date.now().toString();
  return config;
});

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.status === 401) {
      // Handle unauthorized
    }
    return Promise.reject(error);
  }
);
```

### Adapter Architecture

`grab-api` uses a modular adapter architecture:
- **`fetch`**: Default transport for modern browsers, web workers, Deno, and Bun. Supports `AbortSignal` and timeouts.
- **`xhr`**: Automatic fallback for browsers when `onUploadProgress` is needed.
- **`http`**: Native Node.js `http`/`https` transport with automatic gzip/brotli decompression and streaming support.
- **Browser-Safe Bundling**: Browser bundles (`dist/index.js`, `dist/index.cjs`, `dist/grab-api.umd.js`) contain **zero** `node:*` imports.

---

## Audit Logging

All agent requests are automatically recorded in a structured, redacted JSONL audit log when `auditLogPath` is configured:

```jsonl
{"timestamp":"2026-10-21T21:30:00.000Z","instance":"stripe","method":"GET","url":"https://api.stripe.com/v1/customers","headers":{"authorization":"[REDACTED]"},"status":200,"durationMs":142,"truncated":false,"bytes":4120}
```

---

## Testing & Verification

The test suite runs 227 tests across both browser (jsdom) and Node.js environments with >80% coverage on all metrics:

```bash
# Run unit tests with coverage
npm test

# Build Rollup browser & Node bundles
npm run build

# Generate TypeScript declaration files
npm run build:types
```

---

## License

MIT © [lawrence](https://github.com/lawrenceku)
