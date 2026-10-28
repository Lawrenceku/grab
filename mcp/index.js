#!/usr/bin/env node

/**
 * grab-mcp: Model Context Protocol (MCP) server & CLI for grab-api.
 *
 * Default mode (no arguments):
 * Starts the MCP stdio server. This ensures all existing MCP client configs
 * continue to work without modification.
 *
 * CLI mode (when invoked with subcommands: init, add, list, remove, doctor, --help, -h):
 * Routes to the grab-mcp CLI for setup, preset configuration, and diagnostics.
 */

const args = process.argv.slice(2);
const firstArg = args[0];

const CLI_COMMANDS = new Set([
  'init',
  'add',
  'list',
  'remove',
  'doctor',
  'help',
  '--help',
  '-h',
]);

if (firstArg && CLI_COMMANDS.has(firstArg)) {
  const { runCli } = await import('./src/cli.js');
  runCli(args).catch((err) => {
    console.error(`[grab-mcp CLI error] ${err.message}`);
    process.exit(1);
  });
} else {
  const { startServer } = await import('./src/server.js');
  startServer().catch((err) => {
    process.stderr.write(`[grab-mcp fatal] ${err.message}\n`);
    process.exit(1);
  });
}
