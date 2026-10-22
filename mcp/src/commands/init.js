import {
  scanProject,
  getPresets,
  getPreset,
  listPresetNames,
  createInstanceFromPreset,
} from 'grab-api';
import { readConfigFile, writeConfigFile, createPrompt } from '../utils.js';

export async function initCommand(args = {}) {
  console.log('\n🔒 grab-mcp setup');
  console.log('Secure API access for AI agents (zero key leakage into model context)\n');

  const { config: existingConfig, configPath } = readConfigFile(args.config);
  const config = existingConfig || { instances: {} };

  // 1. Run scanner to detect APIs in current workspace
  console.log('Scanning current project for API signals...');
  const scanResult = scanProject({ rootDir: process.cwd() });
  console.log(`Scanned ${scanResult.filesScanned} files in ${scanResult.rootDir}\n`);

  const instancesToAdd = {};
  const isNonInteractive = Boolean(args.yes || args.y);

  if (args.preset) {
    const preset = getPreset(args.preset);
    if (!preset) {
      console.error(`Error: Unknown preset "${args.preset}". Available: ${listPresetNames().join(', ')}`);
      process.exitCode = 1;
      return;
    }
    const envVar = args.env || preset.auth.defaultEnv;
    instancesToAdd[preset.name] = createInstanceFromPreset(preset, { envVar });
    console.log(`Configuring preset: ${preset.displayName} (env: ${envVar})`);
  } else if (scanResult.matches.length > 0) {
    console.log('Detected API usage:');
    for (const match of scanResult.matches) {
      console.log(`  • ${match.preset.displayName} (${match.preset.name})`);
      for (const ev of match.evidence) {
        console.log(`    - ${ev}`);
      }
    }
    console.log('');

    if (isNonInteractive) {
      // In non-interactive mode with -y, configure all detected presets
      for (const match of scanResult.matches) {
        instancesToAdd[match.preset.name] = createInstanceFromPreset(match.preset, {
          envVar: match.suggestedEnvVar,
        });
      }
    } else {
      const prompt = await createPrompt();
      try {
        for (const match of scanResult.matches) {
          const setupThis = await prompt.confirm(
            `Configure ${match.preset.displayName} API preset?`,
            true
          );
          if (setupThis) {
            const envVar = await prompt.ask(
              `Environment variable for ${match.preset.displayName} key`,
              match.suggestedEnvVar
            );
            const isSet = Boolean(process.env[envVar]);
            if (isSet) {
              console.log(`  ✔ "${envVar}" is currently set in this terminal.`);
            } else {
              console.log(`  ℹ "${envVar}" is not set in this terminal (informational: you can set it in your MCP client config or environment).`);
            }
            instancesToAdd[match.preset.name] = createInstanceFromPreset(match.preset, {
              envVar,
              readOnly: true,
            });
          }
        }

        // Ask if they want to configure additional presets
        const remainingPresets = listPresetNames().filter((n) => !instancesToAdd[n]);
        if (remainingPresets.length > 0) {
          const addOther = await prompt.confirm(
            `Would you like to configure any other preset (${remainingPresets.join(', ')})?`,
            false
          );
          if (addOther) {
            for (const name of remainingPresets) {
              const p = getPreset(name);
              const want = await prompt.confirm(`Configure ${p.displayName}?`, false);
              if (want) {
                const envVar = await prompt.ask(
                  `Environment variable for ${p.displayName}`,
                  p.auth.defaultEnv
                );
                instancesToAdd[p.name] = createInstanceFromPreset(p, { envVar, readOnly: true });
              }
            }
          }
        }
      } finally {
        prompt.close();
      }
    }
  } else {
    // No matches detected
    console.log('No existing API packages or env vars detected.');
    if (isNonInteractive) {
      // Default to stripe preset in non-interactive mode
      const stripePreset = getPreset('stripe');
      instancesToAdd.stripe = createInstanceFromPreset(stripePreset);
    } else {
      const prompt = await createPrompt();
      try {
        console.log(`Available built-in presets: ${listPresetNames().join(', ')}`);
        for (const name of listPresetNames()) {
          const p = getPreset(name);
          const setupThis = await prompt.confirm(`Configure ${p.displayName} preset?`, false);
          if (setupThis) {
            const envVar = await prompt.ask(
              `Environment variable for ${p.displayName} key`,
              p.auth.defaultEnv
            );
            instancesToAdd[p.name] = createInstanceFromPreset(p, { envVar, readOnly: true });
          }
        }
      } finally {
        prompt.close();
      }
    }
  }

  // Merge newly configured instances into config
  const addedNames = Object.keys(instancesToAdd);
  if (addedNames.length === 0) {
    console.log('No instances were selected. Config was not modified.');
    return;
  }

  for (const [name, inst] of Object.entries(instancesToAdd)) {
    config.instances[name] = inst;
  }

  // Save config with 0o600 permissions
  const savedPath = writeConfigFile(config, args.config);

  console.log(`\n✔ Successfully configured grab-mcp!`);
  console.log(`Config file saved to: ${savedPath} (mode: 0600)`);
  console.log('\nConfigured instances:');
  for (const name of addedNames) {
    const inst = config.instances[name];
    console.log(`  • ${name}: ${inst.baseURL} [readOnly: ${inst.readOnly ? 'yes' : 'no'}] -> $${inst.auth?.env}`);
  }

  // Generate example MCP client config
  const envExample = {};
  for (const name of Object.keys(config.instances)) {
    const ev = config.instances[name].auth?.env;
    if (ev) {
      envExample[ev] = '...';
    }
  }

  console.log('\n--------------------------------------------------------------');
  console.log('Add grab-mcp to your MCP client config (e.g. Claude Desktop):');
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          grab: {
            command: 'npx',
            args: ['-y', 'grab-mcp'],
            env: envExample,
          },
        },
      },
      null,
      2
    )
  );
  console.log('--------------------------------------------------------------');
  console.log('Security invariant: API keys are used directly for requests and');
  console.log('are NEVER exposed to the AI model context.');
  console.log('--------------------------------------------------------------\n');
}
