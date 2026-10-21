import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getRegisteredSecrets,
  clearRegisteredSecrets,
  resolveAuth,
  resolveStaticHeaders,
  redactError,
} from '../../src/agent/secrets';
import {
  createAgentInstance,
  resetRateLimiters,
  listInstances,
  agentRequest,
} from '../../src/agent/manager';
import {
  getAuditLogPath,
  setAuditLogPath,
  logAudit,
  clearAuditLogs,
} from '../../src/agent/audit';
import {
  parseRetryAfter,
  RateLimiter,
  withRetry,
  isRetryable,
} from '../../src/agent/resilience';
import {
  validateStartupEnv,
  validateConfig,
} from '../../src/agent/config';
import { GrabAgentConfig } from '../../src/agent/types';

describe('Agent coverage boost', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grab-cov-'));
    clearRegisteredSecrets();
    clearAuditLogs();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    setAuditLogPath(undefined);
  });

  it('covers getRegisteredSecrets and clearRegisteredSecrets', () => {
    process.env.TEST_BOOST_KEY = 'secret-value-12345';
    resolveAuth({ type: 'bearer', env: 'TEST_BOOST_KEY' });
    const secrets = getRegisteredSecrets();
    expect(secrets.has('secret-value-12345')).toBe(true);

    clearRegisteredSecrets();
    expect(getRegisteredSecrets().size).toBe(0);
    delete process.env.TEST_BOOST_KEY;
  });

  it('covers resetRateLimiters and RateLimiter reset', () => {
    resetRateLimiters();
    const limiter = new RateLimiter(5);
    limiter.acquire();
    limiter.reset();
  });

  it('covers audit log paths and directory auto-creation', () => {
    setAuditLogPath('/test/custom/audit.log');
    expect(getAuditLogPath()).toBe('/test/custom/audit.log');

    const deepLogPath = path.join(tmpDir, 'subdir', 'nested', 'audit.log');
    logAudit(
      {
        instance: 'test',
        method: 'GET',
        url: 'https://api.example.com',
        headers: {},
        durationMs: 10,
      },
      deepLogPath
    );

    expect(fs.existsSync(deepLogPath)).toBe(true);
    const content = fs.readFileSync(deepLogPath, 'utf-8');
    expect(content).toContain('"instance":"test"');
  });

  it('covers parseRetryAfter with HTTP-date and invalid values', () => {
    const futureDate = new Date(Date.now() + 5000).toUTCString();
    const diff = parseRetryAfter(futureDate);
    expect(diff).toBeGreaterThan(0);

    expect(parseRetryAfter('invalid-date-string')).toBe(0);
    expect(parseRetryAfter('')).toBe(0);
  });

  it('covers isRetryable on various errors', () => {
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryable({ code: 'ERR_NETWORK' })).toBe(true);
    expect(isRetryable({ status: 503 })).toBe(true);
    expect(isRetryable({ response: { status: 500 } })).toBe(true);
    expect(isRetryable({ status: 400 })).toBe(false);
  });

  it('covers validateStartupEnv throwing when throwOnError is true', () => {
    const config: GrabAgentConfig = {
      instances: {
        stripe: {
          baseURL: 'https://api.stripe.com',
          auth: { type: 'bearer', env: 'DEFINITELY_MISSING_KEY_XYZ' },
        },
      },
    };

    expect(() => validateStartupEnv(config, true)).toThrow('grab startup validation failed');
  });

  it('covers createAgentInstance methods and interceptor guard', async () => {
    const config: GrabAgentConfig = {
      instances: {
        mock: {
          baseURL: 'https://api.example.com',
        },
      },
    };

    const instance = createAgentInstance('mock', config);

    // Verify interceptors property throws
    expect(() => instance.interceptors).toThrow('Interceptors are disabled on agent instances');

    // Test patch, delete, head, options with dryRun
    const patchRes = await instance.patch('/users/1', { name: 'New' }, { dryRun: true });
    expect(patchRes.dryRun).toBe(true);
    expect(patchRes.method).toBe('PATCH');

    const delRes = await instance.delete('/users/1', { dryRun: true });
    expect(delRes.dryRun).toBe(true);
    expect(delRes.method).toBe('DELETE');

    const headRes = await instance.head('/users/1', { dryRun: true });
    expect(headRes.dryRun).toBe(true);
    expect(headRes.method).toBe('HEAD');

    const optRes = await instance.options('/users/1', { dryRun: true });
    expect(optRes.dryRun).toBe(true);
    expect(optRes.method).toBe('OPTIONS');

    const reqRes = await instance.request({ url: '/users/1', method: 'GET', dryRun: true });
    expect(reqRes.dryRun).toBe(true);
    expect(reqRes.method).toBe('GET');
  });

  it('covers static header resolution with object env', () => {
    process.env.HEADER_SECRET_VAR = 'header-token-999';
    const headers = resolveStaticHeaders({
      'X-Custom': { env: 'HEADER_SECRET_VAR' },
      'X-Plain': 'plain-value',
      'X-Num': 123 as any,
    });

    expect(headers['X-Custom']).toBe('header-token-999');
    expect(headers['X-Plain']).toBe('plain-value');
    expect(headers['X-Num']).toBe('123');
    delete process.env.HEADER_SECRET_VAR;
  });

  it('covers redactError stack scrubbing', () => {
    process.env.LEAK_TOKEN = 'super-secret-password-123';
    resolveAuth({ type: 'bearer', env: 'LEAK_TOKEN' });

    const err = new Error('Failure occurred');
    err.stack = 'Error: Failure occurred\n at super-secret-password-123 in /app/index.js';

    const redacted = redactError(err);
    expect(redacted.stack).not.toContain('super-secret-password-123');
    expect(redacted.stack).toContain('[REDACTED]');
    delete process.env.LEAK_TOKEN;
  });

  it('throws on unknown instance in createAgentInstance', () => {
    const config: GrabAgentConfig = { instances: {} };
    expect(() => createAgentInstance('nonexistent', config)).toThrow('Unknown instance');
  });

  it('covers rate limiter acquire in agentRequest', async () => {
    const config: GrabAgentConfig = {
      instances: {
        limited: {
          baseURL: 'https://api.example.com',
          rateLimitPerMin: 100,
        },
      },
    };

    const mockAdapter = async () => ({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { success: true },
    });

    const res = await agentRequest(
      config,
      'limited',
      'GET',
      '/test',
      undefined,
      { adapter: mockAdapter } as any
    );
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ success: true });
  });

  it('covers AbortSignal.any and timeout in fetchAdapter when available', async () => {
    const originalAny = (AbortSignal as any).any;
    const originalTimeout = (AbortSignal as any).timeout;

    try {
      (AbortSignal as any).timeout = (ms: number) => {
        const c = new AbortController();
        return c.signal;
      };
      (AbortSignal as any).any = (signals: AbortSignal[]) => {
        const c = new AbortController();
        return c.signal;
      };

      const { fetchAdapter } = await import('../../src/adapters/fetch');
      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: () => Promise.resolve('{"ok":true}'),
      });

      const res = await fetchAdapter({
        url: 'https://api.example.com/test',
        method: 'GET',
        headers: {},
        timeout: 500,
        signal: new AbortController().signal,
        fetch: mockFetch,
      });

      expect(res.status).toBe(200);
    } finally {
      (AbortSignal as any).any = originalAny;
      (AbortSignal as any).timeout = originalTimeout;
    }
  });

  it('covers scrubSecrets on arrays, objects, and sensitive keys', () => {
    const { scrubSecrets } = require('../../src/agent/secrets');
    const input = [
      'regular string',
      {
        authorization: 'secret-auth',
        nested: { cookie: 'session=123' },
        list: ['item1'],
      },
    ];
    const scrubbed = scrubSecrets(input);
    expect(scrubbed[1].authorization).toBe('[REDACTED]');
    expect(scrubbed[1].nested.cookie).toBe('[REDACTED]');
  });

  it('covers withRetry with custom retryMethods', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts === 1) {
        const err: any = new Error('Server error');
        err.status = 500;
        throw err;
      }
      return 'ok';
    };

    const res = await withRetry(fn, {
      maxRetries: 1,
      initialDelayMs: 1,
      retryMethods: ['post'],
      method: 'POST',
    });
    expect(res).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('covers barrel exports in src/agent/index.ts', async () => {
    const agentExports = await import('../../src/agent/index');
    expect(typeof agentExports.agentRequest).toBe('function');
    expect(typeof agentExports.listInstances).toBe('function');
    expect(typeof agentExports.createAgentInstance).toBe('function');
    expect(typeof agentExports.shapeResponse).toBe('function');
    expect(typeof agentExports.redactHeaders).toBe('function');
  });
});

