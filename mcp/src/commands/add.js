import { getPreset, listPresetNames, createInstanceFromPreset } from 'grab-api';
import { readConfigFile, writeConfigFile } from '../utils.js';

export async function addCommand(presetName, options = {}) {
  if (!presetName) {
    console.error(`Error: Missing preset name. Usage: grab-mcp add <preset> [--env <VAR>]`);
    console.error(`Available presets: ${listPresetNames().join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const preset = getPreset(presetName);
  if (!preset) {
    console.error(`Error: Unknown preset "${presetName}". Available presets: ${listPresetNames().join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const { config: existingConfig, configPath } = readConfigFile(options.config);
  const config = existingConfig || { instances: {} };

  if (config.instances[preset.name]) {
    console.log(`Notice: Instance "${preset.name}" already exists in config. Overwriting with new settings.`);
  }

  const envVar = options.env || preset.auth.defaultEnv;
  const instance = createInstanceFromPreset(preset, {
    envVar,
    readOnly: options.readOnly !== undefined ? options.readOnly : true,
  });

  config.instances[preset.name] = instance;
  const savedPath = writeConfigFile(config, options.config);

  console.log(`✔ Added "${preset.displayName}" instance to ${savedPath}`);
  console.log(`  Base URL:  ${instance.baseURL}`);
  console.log(`  Auth:      Bearer ($${instance.auth.env})`);
  console.log(`  Read-Only: ${instance.readOnly}`);
  console.log(`  Methods:   ${instance.allow.methods.join(', ')}`);
  console.log(`  Paths:     ${instance.allow.paths.join(', ')}`);

  const isSet = Boolean(process.env[instance.auth.env]);
  if (isSet) {
    console.log(`  Env check: $${instance.auth.env} is set in current environment.`);
  } else {
    console.log(`  Env check: $${instance.auth.env} is NOT set in current environment (informational).`);
  }
}
