import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { GrabAgentConfig, InstanceConfig, InstanceAuth, AllowConfig } from './types';

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.config', 'grab-mcp');
const DEFAULT_CONFIG_FILE = 'config.json';

/**
 * Resolve the config file path from:
 * 1. Explicit argument
 * 2. GRAB_MCP_CONFIG env var
 * 3. Default: ~/.config/grab-mcp/config.json
 */
export function resolveConfigPath(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  const fromEnv = process.env.GRAB_MCP_CONFIG;
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_FILE);
}

/**
 * Validate that required environment variables exist for all configured instances.
 * Outputs clear messages to stderr.
 */
export function validateStartupEnv(
  config: GrabAgentConfig,
  throwOnError: boolean = false
): string[] {
  const missing: string[] = [];

  for (const [name, inst] of Object.entries(config.instances)) {
    // Check auth env var
    if (inst.auth?.env) {
      if (!process.env[inst.auth.env]) {
        const msg = `[grab config] Missing environment variable "${inst.auth.env}" for instance "${name}". Set it in your environment before making requests.\n`;
        process.stderr.write(msg);
        missing.push(msg);
      }
    }

    // Check header { env } env vars
    if (inst.headers) {
      for (const [headerKey, headerVal] of Object.entries(inst.headers)) {
        if (typeof headerVal === 'object' && headerVal !== null && 'env' in headerVal) {
          const envName = headerVal.env;
          if (!process.env[envName]) {
            const msg = `[grab config] Missing environment variable "${envName}" for header "${headerKey}" in instance "${name}".\n`;
            process.stderr.write(msg);
            missing.push(msg);
          }
        }
      }
    }
  }

  if (throwOnError && missing.length > 0) {
    throw new Error(`grab startup validation failed:\n${missing.join('')}`);
  }

  return missing;
}

/**
 * Load and validate the agent config from disk.
 * Throws with a descriptive message if the file is missing or malformed.
 */
export function loadConfig(configPath?: string, options: { validateEnv?: boolean } = {}): GrabAgentConfig {
  const filePath = resolveConfigPath(configPath);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `grab config not found at ${filePath}. ` +
      `Create it or set GRAB_MCP_CONFIG to point to your config file.`
    );
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err: any) {
    throw new Error(`Failed to read grab config at ${filePath}: ${err.message}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`Invalid JSON in grab config at ${filePath}: ${err.message}`);
  }

  const validated = validateConfig(parsed, filePath);

  if (options.validateEnv) {
    validateStartupEnv(validated, true);
  } else {
    // Non-throwing check to print helpful stderr warnings at startup
    validateStartupEnv(validated, false);
  }

  return validated;
}

/**
 * Validate a parsed config object. Returns the typed config or throws.
 */
export function validateConfig(obj: any, source: string = '<inline>'): GrabAgentConfig {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new Error(`grab config (${source}): root must be an object`);
  }

  if (typeof obj.instances !== 'object' || obj.instances === null || Array.isArray(obj.instances)) {
    throw new Error(`grab config (${source}): "instances" must be an object`);
  }

  const config: GrabAgentConfig = {
    instances: {},
  };

  // Validate each instance
  for (const [name, inst] of Object.entries(obj.instances)) {
    config.instances[name] = validateInstance(inst, name, source);
  }

  // Validate global limits
  if (obj.limits !== undefined) {
    if (typeof obj.limits !== 'object' || obj.limits === null) {
      throw new Error(`grab config (${source}): "limits" must be an object`);
    }
    config.limits = {};
    if (obj.limits.maxResponseBytes !== undefined) {
      if (typeof obj.limits.maxResponseBytes !== 'number' || obj.limits.maxResponseBytes <= 0) {
        throw new Error(`grab config (${source}): "limits.maxResponseBytes" must be a positive number`);
      }
      config.limits.maxResponseBytes = obj.limits.maxResponseBytes;
    }
    if (obj.limits.rateLimitPerMin !== undefined) {
      if (typeof obj.limits.rateLimitPerMin !== 'number' || obj.limits.rateLimitPerMin <= 0) {
        throw new Error(`grab config (${source}): "limits.rateLimitPerMin" must be a positive number`);
      }
      config.limits.rateLimitPerMin = obj.limits.rateLimitPerMin;
    }
    if (obj.limits.maxRetries !== undefined) {
      if (typeof obj.limits.maxRetries !== 'number' || obj.limits.maxRetries < 0) {
        throw new Error(`grab config (${source}): "limits.maxRetries" must be a non-negative number`);
      }
      config.limits.maxRetries = obj.limits.maxRetries;
    }
  }

  if (obj.auditLogPath !== undefined) {
    if (typeof obj.auditLogPath !== 'string') {
      throw new Error(`grab config (${source}): "auditLogPath" must be a string`);
    }
    config.auditLogPath = obj.auditLogPath;
  }

  return config;
}

function validateInstance(obj: any, name: string, source: string): InstanceConfig {
  const ctx = `grab config (${source}), instance "${name}"`;

  if (typeof obj !== 'object' || obj === null) {
    throw new Error(`${ctx}: must be an object`);
  }

  if (typeof obj.baseURL !== 'string' || obj.baseURL.length === 0) {
    throw new Error(`${ctx}: "baseURL" is required and must be a non-empty string`);
  }

  // Validate baseURL scheme: must be https:// unless localhost
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(obj.baseURL);
  } catch {
    throw new Error(`${ctx}: "baseURL" must be a valid URL`);
  }

  const isLocalhost =
    parsedUrl.hostname === 'localhost' ||
    parsedUrl.hostname === '127.0.0.1' ||
    parsedUrl.hostname === '::1' ||
    parsedUrl.hostname === '[::1]';

  if (parsedUrl.protocol !== 'https:' && !isLocalhost) {
    process.stderr.write(
      `[grab config] Insecure baseURL scheme "${parsedUrl.protocol}" for instance "${name}". Only https:// is allowed unless localhost.\n`
    );
    throw new Error(`${ctx}: "baseURL" must use https:// scheme unless localhost (got "${obj.baseURL}")`);
  }

  const inst: InstanceConfig = {
    baseURL: obj.baseURL,
  };

  if (obj.readOnly !== undefined) {
    if (typeof obj.readOnly !== 'boolean') {
      throw new Error(`${ctx}: "readOnly" must be a boolean`);
    }
    inst.readOnly = obj.readOnly;
  }

  if (obj.auth !== undefined) {
    inst.auth = validateAuth(obj.auth, ctx);
  }

  if (obj.allow !== undefined) {
    inst.allow = validateAllow(obj.allow, ctx);
  }

  if (obj.headers !== undefined) {
    if (typeof obj.headers !== 'object' || obj.headers === null || Array.isArray(obj.headers)) {
      throw new Error(`${ctx}: "headers" must be an object`);
    }
    for (const [hKey, hVal] of Object.entries(obj.headers)) {
      if (typeof hVal === 'object' && hVal !== null) {
        if (typeof (hVal as any).env !== 'string' || !(hVal as any).env) {
          throw new Error(`${ctx}: header "${hKey}" object must specify "env" property as non-empty string`);
        }
      } else if (typeof hVal !== 'string') {
        throw new Error(`${ctx}: header "${hKey}" must be a string or { env: string } object`);
      }
    }
    inst.headers = obj.headers;
  }

  if (obj.timeout !== undefined) {
    if (typeof obj.timeout !== 'number' || obj.timeout <= 0) {
      throw new Error(`${ctx}: "timeout" must be a positive number`);
    }
    inst.timeout = obj.timeout;
  }

  if (obj.maxResponseBytes !== undefined) {
    if (typeof obj.maxResponseBytes !== 'number' || obj.maxResponseBytes <= 0) {
      throw new Error(`${ctx}: "maxResponseBytes" must be a positive number`);
    }
    inst.maxResponseBytes = obj.maxResponseBytes;
  }

  if (obj.rateLimitPerMin !== undefined) {
    if (typeof obj.rateLimitPerMin !== 'number' || obj.rateLimitPerMin <= 0) {
      throw new Error(`${ctx}: "rateLimitPerMin" must be a positive number`);
    }
    inst.rateLimitPerMin = obj.rateLimitPerMin;
  }

  return inst;
}

function validateAuth(obj: any, ctx: string): InstanceAuth {
  if (typeof obj !== 'object' || obj === null) {
    throw new Error(`${ctx}: "auth" must be an object`);
  }

  const validTypes = ['bearer', 'basic', 'header'];
  if (!validTypes.includes(obj.type)) {
    throw new Error(`${ctx}: "auth.type" must be one of: ${validTypes.join(', ')}`);
  }

  if (typeof obj.env !== 'string' || obj.env.length === 0) {
    throw new Error(`${ctx}: "auth.env" is required and must be a non-empty string`);
  }

  if (obj.type === 'header' && (!obj.headerName || typeof obj.headerName !== 'string')) {
    throw new Error(`${ctx}: "auth.headerName" is required when auth.type is "header"`);
  }

  return {
    type: obj.type,
    env: obj.env,
    ...(obj.headerName ? { headerName: obj.headerName } : {}),
  };
}

function validateAllow(obj: any, ctx: string): AllowConfig {
  if (typeof obj !== 'object' || obj === null) {
    throw new Error(`${ctx}: "allow" must be an object`);
  }

  const allow: AllowConfig = {};

  if (obj.methods !== undefined) {
    if (!Array.isArray(obj.methods)) {
      throw new Error(`${ctx}: "allow.methods" must be an array`);
    }
    allow.methods = obj.methods.map((m: any) => {
      if (typeof m !== 'string') {
        throw new Error(`${ctx}: each entry in "allow.methods" must be a string`);
      }
      return m.toUpperCase();
    });
  }

  if (obj.paths !== undefined) {
    if (!Array.isArray(obj.paths)) {
      throw new Error(`${ctx}: "allow.paths" must be an array`);
    }
    for (const p of obj.paths) {
      if (typeof p !== 'string') {
        throw new Error(`${ctx}: each entry in "allow.paths" must be a string`);
      }
    }
    allow.paths = obj.paths;
  }

  if (obj.hosts !== undefined) {
    if (!Array.isArray(obj.hosts)) {
      throw new Error(`${ctx}: "allow.hosts" must be an array`);
    }
    for (const h of obj.hosts) {
      if (typeof h !== 'string') {
        throw new Error(`${ctx}: each entry in "allow.hosts" must be a string`);
      }
    }
    allow.hosts = obj.hosts;
  }

  return allow;
}
