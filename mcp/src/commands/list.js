import { readConfigFile } from '../utils.js';

export async function listCommand(options = {}) {
  const { config, configPath, exists } = readConfigFile(options.config);

  if (!exists || !config) {
    console.log(`No configuration file found at: ${configPath}`);
    console.log(`Run "npx grab-mcp init" to set up your first instance.`);
    return;
  }

  const instanceNames = Object.keys(config.instances || {});
  if (instanceNames.length === 0) {
    console.log(`Config file exists (${configPath}) but contains no instances.`);
    console.log(`Run "npx grab-mcp add <preset>" to add an instance.`);
    return;
  }

  console.log(`\nConfigured instances in ${configPath}:\n`);
  for (const name of instanceNames) {
    const inst = config.instances[name];
    console.log(`• ${name}`);
    console.log(`    Base URL:  ${inst.baseURL}`);
    if (inst.auth) {
      console.log(`    Auth:      ${inst.auth.type} ($${inst.auth.env})`);
    } else {
      console.log(`    Auth:      none`);
    }
    console.log(`    Read-Only: ${Boolean(inst.readOnly)}`);
    console.log(`    Methods:   ${inst.allow?.methods ? inst.allow.methods.join(', ') : 'all'}`);
    console.log(`    Paths:     ${inst.allow?.paths ? inst.allow.paths.join(', ') : '*'}`);
    if (inst.rateLimitPerMin) {
      console.log(`    RateLimit: ${inst.rateLimitPerMin}/min`);
    }
    if (inst.maxResponseBytes) {
      console.log(`    MaxBytes:  ${inst.maxResponseBytes}`);
    }
    console.log('');
  }
}
