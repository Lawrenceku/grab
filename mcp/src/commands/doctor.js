import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateConfig, resolveConfigPath } from 'grab-api';
import { readConfigFile } from '../utils.js';

export async function doctorCommand(options = {}) {
  console.log('\n🔍 grab-mcp doctor\n');

  let hasErrors = false;
  const configPath = resolveConfigPath(options.config);

  // 1. Check config file existence
  if (!fs.existsSync(configPath)) {
    console.log(`[FAIL] Config file not found at: ${configPath}`);
    console.log(`       Run "npx grab-mcp init" to create one.\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`[PASS] Config file found: ${configPath}`);

  // 2. Read and parse config JSON
  let config;
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(raw);
    console.log(`[PASS] Config file is valid JSON.`);
  } catch (err) {
    console.log(`[FAIL] Config file is not valid JSON: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  // 3. Validate config schema with grab-api validateConfig
  try {
    validateConfig(config);
    console.log(`[PASS] Config schema validation succeeded.`);
  } catch (err) {
    console.log(`[FAIL] Config schema validation failed: ${err.message}`);
    hasErrors = true;
  }

  // 4. Inspect instances and environment variables
  const instances = config.instances || {};
  const instanceNames = Object.keys(instances);
  console.log(`\nChecking ${instanceNames.length} configured instance(s):`);

  for (const name of instanceNames) {
    const inst = instances[name];
    console.log(`\n  Instance "${name}":`);
    console.log(`    baseURL:  ${inst.baseURL}`);
    console.log(`    readOnly: ${Boolean(inst.readOnly)}`);

    if (inst.auth?.env) {
      const envName = inst.auth.env;
      const isSet = Boolean(process.env[envName]);
      if (isSet) {
        console.log(`    [PASS] Auth env var "${envName}" is set in current environment.`);
      } else {
        console.log(`    [INFO] Auth env var "${envName}" is not set in current environment.`);
        console.log(`           Note: doctor can only check the current environment. If grab-mcp is`);
        console.log(`           launched by an MCP client (Claude Desktop, Cursor, etc.), ensure this`);
        console.log(`           variable is set in the client config's "env" block.`);
      }
    }
  }

  // 5. Check audit log path if defined
  if (config.auditLogPath) {
    try {
      const dir = path.dirname(path.resolve(config.auditLogPath));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.accessSync(dir, fs.constants.W_OK);
      console.log(`\n[PASS] Audit log directory is writable: ${dir}`);
    } catch (err) {
      console.log(`\n[WARN] Audit log path is not writable: ${err.message}`);
    }
  }

  console.log('\n--------------------------------------------------------------');
  if (hasErrors) {
    console.log('❌ Doctor found configuration errors that need to be resolved.');
    process.exitCode = 1;
  } else {
    console.log('✔ Doctor check passed. grab-mcp is ready to accept requests.');
  }
  console.log('--------------------------------------------------------------\n');
}
