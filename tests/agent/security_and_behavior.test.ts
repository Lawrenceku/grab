import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  resolveAndValidatePath,
  checkAllowlist,
  checkRedirectHop,
} from '../../src/agent/allowlist';
import {
  agentRequest,
  createAgentInstance,
  listInstances,
} from '../../src/agent/manager';
import {
  resolveAuth,
  resolveStaticHeaders,
  redactHeaders,
  redactError,
  scrubSecrets,
  clearRegisteredSecrets,
} from '../../src/agent/secrets';
import {
  truncateResponse,
  selectFields,
} from '../../src/agent/response';
import {
  withRetry,
  parseRetryAfter,
  RateLimiter,
} from '../../src/agent/resilience';
import {
  validateConfig,
  validateStartupEnv,
} from '../../src/agent/config';
import {
  logAudit,
  getAuditLogs,
  clearAuditLogs,
  setAuditLogPath,
} from '../../src/agent/audit';
import { GrabAgentConfig } from '../../src/agent/types';

describe('Security & Behavior Improvements', () => {
  beforeEach(() => {
    clearRegisteredSecrets();
    clearAuditLogs();
  });

  describe('Path handling & normalization (Security)', () => {
    const baseURL = 'https://api.stripe.com/v1';

    it('collapses .. and . segments so /customers/../admin cannot slip past /customers/*', () => {
      const { resolvedPath } = resolveAndValidatePath('/customers/../admin', baseURL, 'stripe');
      expect(resolvedPath).toBe('/admin');

      const config = {
        baseURL: 'https://api.stripe.com',
        allow: { paths: ['/customers/*'] },
      };
      expect(() => {
        checkAllowlist(config, 'GET', '/customers/../admin', 'stripe');
      }).toThrow('Path "/admin" is not allowed on instance "stripe"');
    });

    it('decodes %2e%2e and %2f first before resolving', () => {
      const { resolvedPath } = resolveAndValidatePath('/customers/%2e%2e/admin', baseURL, 'stripe');
      expect(resolvedPath).toBe('/admin');

      const config = {
        baseURL: 'https://api.stripe.com',
        allow: { paths: ['/customers/*'] },
      };
      expect(() => {
        checkAllowlist(config, 'GET', '/customers/%2e%2e/admin', 'stripe');
      }).toThrow('Path "/admin" is not allowed on instance "stripe"');
    });

    it('rejects protocol-relative URLs (//evil.com)', () => {
      expect(() => {
        resolveAndValidatePath('//evil.com/secret', baseURL, 'stripe');
      }).toThrow('Protocol-relative URL');
    });

    it('rejects user@host authority tricks', () => {
      expect(() => {
        resolveAndValidatePath('https://attacker@api.stripe.com/customers', baseURL, 'stripe');
      }).toThrow('User credentials');

      expect(() => {
        resolveAndValidatePath('user:pass@api.stripe.com/customers', baseURL, 'stripe');
      }).toThrow('User credentials');
    });

    it('rejects URLs whose origin differs from baseURL', () => {
      expect(() => {
        resolveAndValidatePath('https://evil.com/customers', baseURL, 'stripe');
      }).toThrow('differs from base origin');
    });

    it('matches allowlist against final resolved path rather than raw string', () => {
      const config = {
        baseURL: 'https://api.stripe.com',
        allow: { paths: ['/customers/*'] },
      };
      // /customers/./123 resolves to /customers/123 which matches /customers/*
      expect(() => {
        checkAllowlist(config, 'GET', '/customers/./123', 'stripe');
      }).not.toThrow();

      // /customers/%2f..%2fadmin resolves to /admin which does NOT match
      expect(() => {
        checkAllowlist(config, 'GET', '/customers/%2e%2e%2fadmin', 'stripe');
      }).toThrow();
    });
  });

  describe('Redirects and Cross-host Auth Stripping (Security)', () => {
    const config = {
      baseURL: 'https://api.stripe.com',
      allow: {
        paths: ['/v1/customers/*'],
        hosts: ['cdn.stripe.com'],
      },
    };

    it('allows same-host redirect when target path is permitted', () => {
      const hop = checkRedirectHop(
        config,
        'GET',
        'https://api.stripe.com/v1/customers/1',
        'https://api.stripe.com/v1/customers/2',
        'stripe'
      );
      expect(hop.isCrossHost).toBe(false);
    });

    it('blocks redirect if target path violates allowlist', () => {
      expect(() => {
        checkRedirectHop(
          config,
          'GET',
          'https://api.stripe.com/v1/customers/1',
          'https://api.stripe.com/v1/admin/secrets',
          'stripe'
        );
      }).toThrow('Path "/v1/admin/secrets" is not allowed');
    });

    it('flags cross-host redirects so auth headers can be stripped', () => {
      const hop = checkRedirectHop(
        config,
        'GET',
        'https://api.stripe.com/v1/customers/1',
        'https://cdn.stripe.com/v1/customers/doc.pdf',
        'stripe'
      );
      expect(hop.isCrossHost).toBe(true);
    });
  });

  describe('Interceptors encapsulation (Security)', () => {
    it('does not expose interceptor list on agent instances', () => {
      const cfg: GrabAgentConfig = {
        instances: {
          stripe: { baseURL: 'https://api.stripe.com' },
        },
      };
      const agentInstance = createAgentInstance('stripe', cfg);
      expect(() => {
        // Accessing interceptors should fail/be blocked
        return agentInstance.interceptors;
      }).toThrow('Interceptors are disabled on agent instances');
    });
  });

  describe('Redact by value and static header { env } (Security)', () => {
    afterEach(() => {
      delete process.env.API_KEY_SECRET;
      delete process.env.STATIC_SECRET_VAL;
    });

    it('resolves and redacts statically configured headers with { env }', () => {
      process.env.STATIC_SECRET_VAL = 'static_secret_xyz123';

      const headers = resolveStaticHeaders({
        'X-Public': 'normal-value',
        'X-Custom-Secret': { env: 'STATIC_SECRET_VAL' },
      });

      expect(headers['X-Public']).toBe('normal-value');
      expect(headers['X-Custom-Secret']).toBe('static_secret_xyz123');

      const redacted = redactHeaders(headers);
      expect(redacted['X-Public']).toBe('normal-value');
      expect(redacted['X-Custom-Secret']).toBe('[REDACTED]');
    });

    it('scrubs resolved secret values from response bodies and errors by value', () => {
      process.env.API_KEY_SECRET = 'sk_live_supersecret999';
      resolveAuth({ type: 'bearer', env: 'API_KEY_SECRET' });

      // An API response echoing the key back
      const apiResponse = {
        error: 'Key sk_live_supersecret999 is invalid',
        details: { token: 'sk_live_supersecret999' },
      };

      const scrubbed = scrubSecrets(apiResponse);
      expect(scrubbed.error).toBe('Key [REDACTED] is invalid');
      expect(scrubbed.details.token).toBe('[REDACTED]');

      // Error message echoing the key back
      const err = new Error('Server returned 401 with sk_live_supersecret999');
      const cleanErr = redactError(err);
      expect(cleanErr.message).toBe('Server returned 401 with [REDACTED]');
    });
  });

  describe('Retries on non-idempotent methods (Behavior)', () => {
    it('retries GET and PUT by default', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) {
          const err: any = new Error('Server Error');
          err.status = 500;
          throw err;
        }
        return 'success';
      };

      const result = await withRetry(fn, {
        method: 'GET',
        maxRetries: 2,
        initialDelayMs: 1,
      });

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    it('does NOT retry POST by default', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        const err: any = new Error('Server Error');
        err.status = 500;
        throw err;
      };

      await expect(
        withRetry(fn, {
          method: 'POST',
          maxRetries: 2,
          initialDelayMs: 1,
        })
      ).rejects.toThrow('Server Error');

      expect(attempts).toBe(1); // Never retried
    });

    it('retries POST when retryPost is opted in', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) {
          const err: any = new Error('Server Error');
          err.status = 500;
          throw err;
        }
        return 'charged';
      };

      const result = await withRetry(fn, {
        method: 'POST',
        retryPost: true,
        maxRetries: 2,
        initialDelayMs: 1,
      });

      expect(result).toBe('charged');
      expect(attempts).toBe(2);
    });

    it('parses Retry-After header correctly', () => {
      expect(parseRetryAfter('5')).toBe(5000);
      expect(parseRetryAfter('0')).toBe(0);
    });
  });

  describe('Structural truncation and array selectFields (Behavior)', () => {
    it('truncates arrays structurally keeping first items and returning valid array', () => {
      const items = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Item ${i}` }));
      const result = truncateResponse(items, 300);

      expect(result.truncated).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeLessThan(100);
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.hint).toContain('fields');
    });

    it('selectFields maps over nested arrays (items.sku)', () => {
      const order = {
        id: 'ord_123',
        customer: 'Alice',
        items: [
          { sku: 'A1', qty: 2, price: 10 },
          { sku: 'B2', qty: 1, price: 20 },
        ],
      };

      const filtered = selectFields(order, ['id', 'items.sku', 'items.qty']);
      expect(filtered).toEqual({
        id: 'ord_123',
        items: [
          { sku: 'A1', qty: 2 },
          { sku: 'B2', qty: 1 },
        ],
      });
    });

    it('handles binary Buffers and non-JSON content types cleanly', () => {
      const buf = Buffer.from('Binary content for download');
      const truncatedBuf = truncateResponse(buf, 10);
      expect(truncatedBuf.truncated).toBe(true);
      expect(Buffer.isBuffer(truncatedBuf.data)).toBe(true);
      expect(truncatedBuf.data.length).toBe(10);
    });
  });

  describe('Dry-run and readOnly guardrail (Behavior)', () => {
    const config: GrabAgentConfig = {
      instances: {
        stripe: {
          baseURL: 'https://api.stripe.com',
          readOnly: true,
          allow: { paths: ['/v1/customers'] },
        },
      },
    };

    it('enforces readOnly flag blocking mutating methods with clear error', async () => {
      await expect(
        agentRequest(config, 'stripe', 'POST', '/v1/customers', { name: 'Alice' })
      ).rejects.toThrow('Method POST not allowed on read-only instance "stripe"; allowed: GET, HEAD, OPTIONS');
    });

    it('dryRun returns what would be sent after allowlist passes', async () => {
      const result = await agentRequest(
        config,
        'stripe',
        'GET',
        '/v1/customers',
        undefined,
        { dryRun: true }
      );

      expect(result.dryRun).toBe(true);
      expect(result.method).toBe('GET');
      expect(result.url).toBe('https://api.stripe.com/v1/customers');
      expect(result.message).toContain('Dry run');
    });
  });

  describe('Startup validation, list_instances, and Audit Logging', () => {
    it('validates baseURL scheme requiring https unless localhost', () => {
      expect(() => {
        validateConfig({
          instances: {
            remote: { baseURL: 'http://insecure-api.com' },
          },
        });
      }).toThrow('"baseURL" must use https:// scheme unless localhost');

      // Localhost is permitted with http://
      expect(() => {
        validateConfig({
          instances: {
            local: { baseURL: 'http://localhost:3000' },
            localIp: { baseURL: 'http://127.0.0.1:8080' },
          },
        });
      }).not.toThrow();
    });

    it('validateStartupEnv checks for missing env vars and outputs to stderr', () => {
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const cfg: GrabAgentConfig = {
        instances: {
          api: {
            baseURL: 'https://api.example.com',
            auth: { type: 'bearer', env: 'NONEXISTENT_VAR_12345' },
          },
        },
      };

      const missing = validateStartupEnv(cfg, false);
      expect(missing.length).toBe(1);
      expect(missing[0]).toContain('NONEXISTENT_VAR_12345');
      expect(stderrSpy).toHaveBeenCalled();

      stderrSpy.mockRestore();
    });

    it('listInstances output includes allowed paths and readOnly status explicitly', () => {
      const cfg: GrabAgentConfig = {
        instances: {
          test: {
            baseURL: 'https://api.test.com',
            allow: { paths: ['/customers/*'] },
            readOnly: true,
          },
          open: {
            baseURL: 'https://api.open.com',
          },
        },
      };

      const info = listInstances(cfg);
      expect(info).toEqual([
        {
          name: 'test',
          baseURL: 'https://api.test.com',
          methods: ['GET', 'HEAD', 'OPTIONS'],
          paths: ['/customers/*'],
          readOnly: true,
        },
        {
          name: 'open',
          baseURL: 'https://api.open.com',
          methods: ['*'],
          paths: ['*'],
          readOnly: false,
        },
      ]);
    });

    it('writes redacted JSONL audit log', () => {
      const tmpFile = path.join(os.tmpdir(), `audit-test-${Date.now()}.jsonl`);
      setAuditLogPath(tmpFile);

      logAudit({
        instance: 'stripe',
        method: 'GET',
        url: 'https://api.stripe.com/v1/customers',
        headers: { Authorization: 'Bearer sk_test_secret123' },
        durationMs: 45,
        status: 200,
      });

      const inMemory = getAuditLogs();
      expect(inMemory.length).toBe(1);
      expect(inMemory[0].headers.Authorization).toBe('[REDACTED]');

      const fileContent = fs.readFileSync(tmpFile, 'utf-8');
      expect(fileContent).toContain('"instance":"stripe"');
      expect(fileContent).toContain('[REDACTED]');
      expect(fileContent).not.toContain('sk_test_secret123');

      fs.unlinkSync(tmpFile);
    });
  });

  describe('Agent Instance Client Methods & RateLimiter', () => {
    it('provides convenience HTTP methods on agent instance', async () => {
      const cfg: GrabAgentConfig = {
        instances: {
          test: {
            baseURL: 'https://api.test.com',
            allow: { paths: ['/v1/**'] },
          },
        },
      };

      const agent = createAgentInstance('test', cfg);

      // Verify methods return dryRun previews
      const getRes = await agent.get('/v1/items', { dryRun: true });
      expect(getRes.method).toBe('GET');

      const postRes = await agent.post('/v1/items', { name: 'A' }, { dryRun: true });
      expect(postRes.method).toBe('POST');
      expect(postRes.body).toEqual({ name: 'A' });

      const putRes = await agent.put('/v1/items/1', { name: 'B' }, { dryRun: true });
      expect(putRes.method).toBe('PUT');

      const delRes = await agent.delete('/v1/items/1', { dryRun: true });
      expect(delRes.method).toBe('DELETE');

      const patchRes = await agent.patch('/v1/items/1', { name: 'C' }, { dryRun: true });
      expect(patchRes.method).toBe('PATCH');

      const headRes = await agent.head('/v1/items/1', { dryRun: true });
      expect(headRes.method).toBe('HEAD');

      const optRes = await agent.options('/v1/items', { dryRun: true });
      expect(optRes.method).toBe('OPTIONS');

      const reqRes = await agent.request({
        method: 'GET',
        url: '/v1/items',
        dryRun: true,
      });
      expect(reqRes.method).toBe('GET');
    });

    it('manages rate limiting properly and throws when exceeded', () => {
      const limiter = new RateLimiter(2);
      limiter.acquire();
      limiter.acquire();
      expect(() => limiter.acquire()).toThrow('Rate limit exceeded');
      limiter.reset();
      expect(() => limiter.acquire()).not.toThrow();
    });

    it('executes agentRequest end-to-end with response shaping and secret scrubbing', async () => {
      process.env.API_KEY_E2E = 'sk_e2e_secret_token_123';

      const cfg: GrabAgentConfig = {
        instances: {
          test: {
            baseURL: 'https://api.test.com',
            auth: { type: 'bearer', env: 'API_KEY_E2E' },
            allow: { paths: ['/v1/**'] },
          },
        },
      };

      const mockAdapter = async (req: any) => {
        expect(req.headers.Authorization).toBe('Bearer sk_e2e_secret_token_123');
        return {
          status: 200,
          statusText: 'OK',
          headers: {
            'content-type': 'application/json',
            'set-cookie': 'session=abc',
          },
          data: {
            id: 'item_1',
            secretEcho: 'sk_e2e_secret_token_123',
            extra: 'something',
          },
        };
      };

      const res = await agentRequest(
        cfg,
        'test',
        'GET',
        '/v1/items',
        undefined,
        {
          fields: ['id', 'secretEcho'],
          adapter: mockAdapter as any,
        }
      );

      expect(res.status).toBe(200);
      expect(res.data.id).toBe('item_1');
      // Secret must be scrubbed by value!
      expect(res.data.secretEcho).toBe('[REDACTED]');
      expect(res.headers['set-cookie']).toBe('[REDACTED]');

      delete process.env.API_KEY_E2E;
    });

    it('executes cross-host redirect stripping auth headers at runtime', async () => {
      process.env.STRIPE_AUTH_KEY = 'sk_stripe_runtime_auth_123';

      const cfg: GrabAgentConfig = {
        instances: {
          stripe: {
            baseURL: 'https://api.stripe.com',
            auth: { type: 'bearer', env: 'STRIPE_AUTH_KEY' },
            allow: {
              paths: ['/v1/**'],
              hosts: ['cdn.stripe.com'],
            },
          },
        },
      };

      let callCount = 0;
      const capturedHeaders: any[] = [];

      const mockAdapter = async (req: any) => {
        callCount++;
        capturedHeaders.push({ ...req.headers });

        if (callCount === 1) {
          return {
            status: 302,
            statusText: 'Found',
            headers: {
              location: 'https://cdn.stripe.com/v1/files/download',
            },
            data: '',
          };
        }

        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          data: { downloaded: true },
        };
      };

      const res = await agentRequest(
        cfg,
        'stripe',
        'GET',
        '/v1/customers/123',
        undefined,
        { adapter: mockAdapter as any }
      );

      expect(callCount).toBe(2);
      expect(capturedHeaders[0].Authorization).toBe('Bearer sk_stripe_runtime_auth_123');
      // On hop 2 (cdn.stripe.com), Authorization header MUST be stripped
      expect(capturedHeaders[1].Authorization).toBeUndefined();
      expect(res.data).toEqual({ downloaded: true });

      delete process.env.STRIPE_AUTH_KEY;
    });

    it('handles request failure in agentRequest and logs redacted error in audit', async () => {
      const cfg: GrabAgentConfig = {
        instances: {
          failApi: {
            baseURL: 'https://api.fail.com',
          },
        },
      };

      const mockAdapter = async () => {
        const err: any = new Error('Network timeout with secret_value_999');
        err.code = 'ERR_NETWORK';
        throw err;
      };

      await expect(
        agentRequest(
          cfg,
          'failApi',
          'GET',
          '/endpoint',
          undefined,
          {
            retry: { maxRetries: 0 },
            adapter: mockAdapter as any,
          }
        )
      ).rejects.toThrow('Network timeout');

      const logs = getAuditLogs();
      const last = logs[logs.length - 1];
      expect(last.instance).toBe('failApi');
      expect(last.error).toBeDefined();
    });

    it('retries when response object returns 429 status and honors Retry-After', async () => {
      let calls = 0;
      const fn = async () => {
        calls++;
        if (calls === 1) {
          return {
            status: 429,
            headers: { 'retry-after': '0' },
            data: { error: 'Rate limit' },
          };
        }
        return {
          status: 200,
          headers: {},
          data: { success: true },
        };
      };

      const res: any = await withRetry(fn, {
        method: 'GET',
        maxRetries: 2,
        initialDelayMs: 1,
      });

      expect(res.status).toBe(200);
      expect(calls).toBe(2);
    });
  });
});

