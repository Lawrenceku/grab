import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, validateConfig, resolveConfigPath } from '../src/agent/config';

describe('agent/config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grab-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.GRAB_MCP_CONFIG;
  });

  describe('resolveConfigPath', () => {
    it('returns explicit path when provided', () => {
      const result = resolveConfigPath('/my/config.json');
      expect(result).toBe(path.resolve('/my/config.json'));
    });

    it('uses GRAB_MCP_CONFIG env var when set', () => {
      process.env.GRAB_MCP_CONFIG = '/env/config.json';
      const result = resolveConfigPath();
      expect(result).toBe(path.resolve('/env/config.json'));
    });

    it('falls back to ~/.config/grab-mcp/config.json', () => {
      const result = resolveConfigPath();
      expect(result).toBe(path.join(os.homedir(), '.config', 'grab-mcp', 'config.json'));
    });
  });

  describe('loadConfig', () => {
    it('loads a valid config file', () => {
      const configPath = path.join(tmpDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        instances: {
          stripe: {
            baseURL: 'https://api.stripe.com/v1',
            auth: { type: 'bearer', env: 'STRIPE_KEY' },
            allow: { methods: ['GET', 'POST'], paths: ['/customers/*'] },
          },
        },
        limits: { maxResponseBytes: 20000, rateLimitPerMin: 60 },
      }));

      const config = loadConfig(configPath);
      expect(config.instances.stripe.baseURL).toBe('https://api.stripe.com/v1');
      expect(config.instances.stripe.auth!.type).toBe('bearer');
      expect(config.instances.stripe.auth!.env).toBe('STRIPE_KEY');
      expect(config.instances.stripe.allow!.methods).toEqual(['GET', 'POST']);
      expect(config.instances.stripe.allow!.paths).toEqual(['/customers/*']);
      expect(config.limits!.maxResponseBytes).toBe(20000);
      expect(config.limits!.rateLimitPerMin).toBe(60);
    });

    it('throws when config file does not exist', () => {
      expect(() => loadConfig('/nonexistent/config.json')).toThrow('grab config not found');
    });

    it('throws on invalid JSON', () => {
      const configPath = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(configPath, '{ bad json }');
      expect(() => loadConfig(configPath)).toThrow('Invalid JSON');
    });

    it('throws when instances is missing', () => {
      const configPath = path.join(tmpDir, 'no-instances.json');
      fs.writeFileSync(configPath, JSON.stringify({}));
      expect(() => loadConfig(configPath)).toThrow('"instances" must be an object');
    });

    it('throws when instance baseURL is missing', () => {
      const configPath = path.join(tmpDir, 'no-base.json');
      fs.writeFileSync(configPath, JSON.stringify({
        instances: { test: {} },
      }));
      expect(() => loadConfig(configPath)).toThrow('"baseURL" is required');
    });

    it('loads config via GRAB_MCP_CONFIG env var', () => {
      const configPath = path.join(tmpDir, 'env-config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        instances: { api: { baseURL: 'https://api.example.com' } },
      }));
      process.env.GRAB_MCP_CONFIG = configPath;
      const config = loadConfig();
      expect(config.instances.api.baseURL).toBe('https://api.example.com');
    });
  });

  describe('validateConfig', () => {
    it('validates auth type', () => {
      expect(() => validateConfig({
        instances: {
          test: { baseURL: 'https://x.com', auth: { type: 'invalid', env: 'X' } },
        },
      })).toThrow('"auth.type" must be one of');
    });

    it('validates auth.env is required', () => {
      expect(() => validateConfig({
        instances: {
          test: { baseURL: 'https://x.com', auth: { type: 'bearer' } },
        },
      })).toThrow('"auth.env" is required');
    });

    it('requires headerName for header auth type', () => {
      expect(() => validateConfig({
        instances: {
          test: { baseURL: 'https://x.com', auth: { type: 'header', env: 'KEY' } },
        },
      })).toThrow('"auth.headerName" is required');
    });

    it('validates limits are positive numbers', () => {
      expect(() => validateConfig({
        instances: {},
        limits: { maxResponseBytes: -1 },
      })).toThrow('"limits.maxResponseBytes" must be a positive number');

      expect(() => validateConfig({
        instances: {},
        limits: { rateLimitPerMin: 0 },
      })).toThrow('"limits.rateLimitPerMin" must be a positive number');

      expect(() => validateConfig({
        instances: {},
        limits: { maxRetries: -1 },
      })).toThrow('"limits.maxRetries" must be a non-negative number');
    });

    it('normalizes method names to uppercase', () => {
      const config = validateConfig({
        instances: {
          test: {
            baseURL: 'https://x.com',
            allow: { methods: ['get', 'post'] },
          },
        },
      });
      expect(config.instances.test.allow!.methods).toEqual(['GET', 'POST']);
    });

    it('accepts maxRetries of 0', () => {
      const config = validateConfig({
        instances: {},
        limits: { maxRetries: 0 },
      });
      expect(config.limits!.maxRetries).toBe(0);
    });

    it('validates root is an object', () => {
      expect(() => validateConfig(null)).toThrow('root must be an object');
      expect(() => validateConfig([1, 2])).toThrow('root must be an object');
    });

    it('validates instance timeout is positive', () => {
      expect(() => validateConfig({
        instances: { test: { baseURL: 'https://x.com', timeout: -5 } },
      })).toThrow('"timeout" must be a positive number');
    });

    it('validates allow.methods is an array', () => {
      expect(() => validateConfig({
        instances: { test: { baseURL: 'https://x.com', allow: { methods: 'GET' } } },
      })).toThrow('"allow.methods" must be an array');
    });

    it('validates allow.paths entries are strings', () => {
      expect(() => validateConfig({
        instances: { test: { baseURL: 'https://x.com', allow: { paths: [123] } } },
      })).toThrow('"allow.paths" must be a string');
    });

    it('validates allow.hosts entries are strings', () => {
      expect(() => validateConfig({
        instances: { test: { baseURL: 'https://x.com', allow: { hosts: [true] } } },
      })).toThrow('"allow.hosts" must be a string');
    });
  });
});
