import { initCommand } from './commands/init.js';
import { addCommand } from './commands/add.js';
import { listCommand } from './commands/list.js';
import { removeCommand } from './commands/remove.js';
import { doctorCommand } from './commands/doctor.js';

function parseFlags(args) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags[key] = args[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags[key] = args[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

function showHelp() {
  console.log(`
grab-mcp — Model Context Protocol server for secure agent HTTP requests

Usage:
  grab-mcp [command] [options]

Commands:
  init                     Scan workspace and set up API presets interactively
  add <preset>             Add a built-in API preset (stripe, github)
  list                     List all configured API instances and their policies
  remove <name>            Remove a configured API instance
  doctor                   Validate configuration and inspect environment variables

Running as MCP Server:
  npx grab-mcp             Start the MCP stdio server (used by Claude Desktop, Cursor, etc.)

Global Options:
  --config <path>          Path to custom config file (default: ~/.config/grab-mcp/config.json)
  -h, --help               Show this help message

Examples:
  npx grab-mcp init
  npx grab-mcp add stripe --env STRIPE_SECRET_KEY
  npx grab-mcp list
  npx grab-mcp doctor
`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const { flags, positional } = parseFlags(argv);
  const command = positional[0];

  if (!command || flags.help || flags.h || command === 'help') {
    showHelp();
    return;
  }

  switch (command) {
    case 'init':
      await initCommand({
        ...flags,
        preset: flags.preset || positional[1],
      });
      break;

    case 'add':
      await addCommand(positional[1], flags);
      break;

    case 'list':
      await listCommand(flags);
      break;

    case 'remove':
      await removeCommand(positional[1], flags);
      break;

    case 'doctor':
      await doctorCommand(flags);
      break;

    default:
      console.error(`Unknown command: "${command}". Run "grab-mcp --help" for available commands.`);
      process.exitCode = 1;
      break;
  }
}
