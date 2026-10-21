#!/usr/bin/env node

/**
 * grab-mcp: Model Context Protocol (MCP) server for grab-api.
 *
 * Exposes two tools over stdio:
 * 1. list_instances — lists configured named API instances, their base URLs, allowed methods, and paths
 * 2. request — executes HTTP requests through configured instances with allowlist guards,
 *    token-efficient response shaping, and secret redaction.
 *
 * CRITICAL RULE: Never console.log in this file!
 * stdout is strictly reserved for JSON-RPC messages. All diagnostics and logs MUST go to stderr.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  loadConfig,
  listInstances,
  agentRequest,
  validateStartupEnv,
} from 'grab-api';

// Create the MCP server instance
const server = new McpServer({
  name: 'grab-mcp',
  version: '2.0.0',
});

// Load configuration
let config;
try {
  config = loadConfig();
  validateStartupEnv(config, false);
} catch (err) {
  process.stderr.write(`[grab-mcp error] Failed to load config: ${err.message}\n`);
  // Initialize with empty instances so server can start and report configuration error
  config = { instances: {} };
}

// Tool 1: list_instances
server.tool(
  'list_instances',
  'List all configured API instances available for requests. Returns names, base URLs, allowed methods, paths, and read-only flags.',
  {},
  async () => {
    try {
      const instances = listInstances(config);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ instances }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error listing instances: ${err.message}`,
          },
        ],
      };
    }
  }
);

// Tool 2: request
server.tool(
  'request',
  'Send an HTTP request via a configured API instance with automatic secret injection, allowlist enforcement, rate limiting, and response shaping.',
  {
    instance: z.string().describe('The name of the configured API instance to use (from list_instances)'),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']).describe('HTTP method to use'),
    path: z.string().describe('URL path relative to instance baseURL (e.g. "/v1/customers")'),
    body: z.any().optional().describe('Optional request body data for POST/PUT/PATCH'),
    fields: z.array(z.string()).optional().describe('Optional dot-notation fields to extract from JSON response (e.g. ["id", "customer.email", "items.sku"]) to save tokens'),
    maxBytes: z.number().positive().optional().describe('Optional max response body bytes before structural truncation'),
    dryRun: z.boolean().optional().describe('If true, validates request and allowlist, returning what would be sent without executing the request'),
  },
  async ({ instance, method, path, body, fields, maxBytes, dryRun }) => {
    try {
      const result = await agentRequest(
        config,
        instance,
        method,
        path,
        body,
        {
          fields,
          maxBytes,
          dryRun,
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: err.message || String(err),
          },
        ],
      };
    }
  }
);

// Start the stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[grab-mcp] Server running on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`[grab-mcp fatal] ${err.message}\n`);
  process.exit(1);
});
