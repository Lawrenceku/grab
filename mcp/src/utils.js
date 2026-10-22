import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { resolveConfigPath, validateConfig } from 'grab-api';

/**
 * Read and parse configuration file safely.
 * Returns null if file does not exist.
 */
export function readConfigFile(explicitPath) {
  const configPath = resolveConfigPath(explicitPath);
  if (!fs.existsSync(configPath)) {
    return { config: null, configPath, exists: false };
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    return { config, configPath, exists: true };
  } catch (err) {
    throw new Error(`Failed to parse config file at "${configPath}": ${err.message}`);
  }
}

/**
 * Write configuration file safely with 0o600 mode permissions.
 */
export function writeConfigFile(config, explicitPath) {
  validateConfig(config);
  const configPath = resolveConfigPath(explicitPath);
  const dir = path.dirname(configPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const content = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(configPath, content, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    // chmod may be a no-op or throw on some Windows filesystems
  }

  return configPath;
}

/**
 * Prompt helper using node:readline/promises.
 */
export async function createPrompt() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    async ask(questionText, defaultValue = '') {
      const promptText = defaultValue ? `${questionText} [${defaultValue}]: ` : `${questionText}: `;
      const answer = await rl.question(promptText);
      const trimmed = answer.trim();
      return trimmed === '' ? defaultValue : trimmed;
    },
    async confirm(questionText, defaultYes = true) {
      const suffix = defaultYes ? ' [Y/n]: ' : ' [y/N]: ';
      const answer = await rl.question(`${questionText}${suffix}`);
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === '') return defaultYes;
      return trimmed === 'y' || trimmed === 'yes';
    },
    close() {
      rl.close();
    },
  };
}
