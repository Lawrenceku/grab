import { readConfigFile, writeConfigFile } from '../utils.js';

export async function removeCommand(instanceName, options = {}) {
  if (!instanceName) {
    console.error(`Error: Missing instance name. Usage: grab-mcp remove <name>`);
    process.exitCode = 1;
    return;
  }

  const { config, configPath, exists } = readConfigFile(options.config);
  if (!exists || !config) {
    console.error(`Error: Config file not found at "${configPath}".`);
    process.exitCode = 1;
    return;
  }

  if (!config.instances || !config.instances[instanceName]) {
    console.error(`Error: Instance "${instanceName}" not found in config.`);
    const available = Object.keys(config.instances || {});
    if (available.length > 0) {
      console.error(`Available instances: ${available.join(', ')}`);
    }
    process.exitCode = 1;
    return;
  }

  delete config.instances[instanceName];
  writeConfigFile(config, options.config);

  console.log(`✔ Removed instance "${instanceName}" from ${configPath}`);
}
