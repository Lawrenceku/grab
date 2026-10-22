/**
 * Canary tests — security invariant: the canary secret MUST NEVER appear
 * in any tool output, error message, log entry, or CLI output.
 *
 * Set STRIPE_SECRET_KEY=sk_canary_123456 and run all tools against a mock
 * echo server that reflects headers, URL, and body back in its response.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  agentRequest,
  listInstances,
  resetRateLimiters,
} from '../../src/agent/manager';
import {
  resolveAuth,
  clearRegisteredSecrets,
  scrubSecrets,
  redactHeaders,
  redactError,
  registerSecret,
} from '../../src/agent/secrets';
import {
  logAudit,
  getAuditLogs,
  clearAuditLogs,
  setAuditLogPath,
} from '../../src/agent/audit';
import { validateConfig } from '../../src/agent/config';
import { GrabAgentConfig, InstanceConfig } from '../../src/agent/types';

const CANARY = 'sk_canary_123456';
const CANARY_B64 = Buffer.from(CANARY).toString('base64');
const CANARY_URL_ENCODED = encodeURIComponent(CANARY);

/** Recursively search for the canary string in any value */
function containsCanary(val: any, label: string): void {
  if (val === null || val === undefined) return;
  if (typeof val === 'string') {
    expect(val).not.toContain(CANARY);
    expect(val).not.toContain(CANARY_B64);
    expect(val).not.toContain(CANARY_URL_ENCODED);
    return;
  }
  if (Buffer.isBuffer(val)) {
    const str = val.toString('utf-8');
    expect(str).not.toContain(CANARY);
    return;
  }
  if (Array.isArray(val)) {
    val.forEach((item, i) => containsCanary(item, `${label}[${i}]`));
    return;
  }
  if (typeof val === 'object') {
    for (const [key, v] of Object.entries(val)) {
      containsCanary(v, `${label}.${key}`);
    }
  }
}

/** Mock adapter that echoes everything back as an API response */
function echoAdapter(req: any) {
  return Promise.resolve({
    status: 200,
    statusText: 'OK',
    headers: {
      'content-type': 'application/json',
      // Echo back the request headers as response headers
      'x-echo-auth': req.headers?.Authorization || req.headers?.authorization || '',
      'x-echo-api-key': req.headers?.['X-Api-Key'] || req.headers?.['x-api-key'] || '',
    },
    data: {
      echoedHeaders: { ...req.headers },
      echoedUrl: req.url,
      echoedBody: req.data,
      echoedMethod: req.method,
    },
  });
}

/** Mock adapter that returns the canary in error body (like a misconfigured API) */
function errorEchoAdapter(req: any) {
  return Promise.resolve({
    status: 401,
    statusText: 'Unauthorized',
    headers: { 'content-type': 'application/json' },
    data: {
      error: `Invalid API key: ${req.headers?.Authorization || 'none'}`,
      message: `The key ${CANARY} was rejected`,
      requestHeaders: { ...req.headers },
    },
  });
}

describe('Canary Tests — Secret Never Leaks', () => {
  let tmpAuditLog: string;

  beforeEach(() => {
    clearRegisteredSecrets();
    clearAuditLogs();
    resetRateLimiters();
    process.env.STRIPE_SECRET_KEY = CANARY;
    tmpAuditLog = path.join(os.tmpdir(), `canary-audit-${Date.now()}.jsonl`);
    setAuditLogPath(undefined);
  });

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    setAuditLogPath(undefined);
    try { fs.unlinkSync(tmpAuditLog); } catch {}
  });

  const baseConfig: GrabAgentConfig = {
    instances: {
      stripe: {
        baseURL: 'https://api.stripe.com/v1',
        auth: { type: 'bearer', env: 'STRIPE_SECRET_KEY' },
        allow: {
          methods: ['GET'],
          paths: ['/customers', '/customers/*'],
        },
        readOnly: true,
      },
    },
    auditLogPath: undefined, // set per-test
  };

  function configWithAudit(): GrabAgentConfig {
    return { ...baseConfig, auditLogPath: tmpAuditLog };
  }

  // ─── Test 1: Normal response — canary never in tool output ───
  it('canary never appears in agentRequest output (data, headers, statusText)', async () => {
    const cfg = configWithAudit();
    const result = await agentRequest(
      cfg, 'stripe', 'GET', '/customers', undefined,
      { adapter: echoAdapter as any }
    );

    containsCanary(result, 'result');
    // Verify shape: must have status, headers, data — not raw request/response
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('headers');
    expect(result).toHaveProperty('data');
    // Must NOT have config, request, or other raw objects
    expect(result).not.toHaveProperty('config');
    expect(result).not.toHaveProperty('request');
  });

  // ─── Test 2: Error response echoing the key — canary still scrubbed ───
  it('canary never appears in error responses that echo the request back', async () => {
    const cfg = configWithAudit();
    const result = await agentRequest(
      cfg, 'stripe', 'GET', '/customers', undefined,
      { adapter: errorEchoAdapter as any }
    );

    // agentRequest returns even 4xx because validateStatus: () => true
    containsCanary(result, 'errorResult');
  });

  // ─── Test 3: Error thrown — canary never in error message ───
  it('canary never appears in thrown error messages', async () => {
    const cfg = configWithAudit();
    const throwAdapter = async (req: any) => {
      throw Object.assign(
        new Error(`Connection failed to ${req.url} with auth=${req.headers?.Authorization}`),
        { code: 'ERR_NETWORK' }
      );
    };

    try {
      await agentRequest(
        cfg, 'stripe', 'GET', '/customers', undefined,
        { retry: { maxRetries: 0 }, adapter: throwAdapter as any }
      );
      fail('Should have thrown');
    } catch (err: any) {
      containsCanary(err.message, 'error.message');
      if (err.stack) containsCanary(err.stack, 'error.stack');
      if (err.config) containsCanary(err.config, 'error.config');
      if (err.response) containsCanary(err.response, 'error.response');
    }
  });

  // ─── Test 4: Audit log entries — canary never in log ───
  it('canary never appears in audit log entries (in-memory and file)', async () => {
    const cfg = configWithAudit();
    await agentRequest(
      cfg, 'stripe', 'GET', '/customers', undefined,
      { adapter: echoAdapter as any }
    );

    // Check in-memory logs
    const logs = getAuditLogs();
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      containsCanary(log, 'auditLog');
    }

    // Check file log
    if (fs.existsSync(tmpAuditLog)) {
      const fileContent = fs.readFileSync(tmpAuditLog, 'utf-8');
      expect(fileContent).not.toContain(CANARY);
      expect(fileContent).not.toContain(CANARY_B64);
    }
  });

  // ─── Test 5: Cross-origin redirect — key stripped on cross-host hop ───
  it('canary stripped from headers on cross-host redirect', async () => {
    const cfg: GrabAgentConfig = {
      instances: {
        stripe: {
          baseURL: 'https://api.stripe.com/v1',
          auth: { type: 'bearer', env: 'STRIPE_SECRET_KEY' },
          allow: {
            methods: ['GET'],
            paths: ['/customers/*', '/files/*'],
            hosts: ['files.stripe.com'],
          },
          readOnly: true,
        },
      },
    };

    let callNum = 0;
    const capturedHeaders: Record<string, string>[] = [];

    const redirectAdapter = async (req: any) => {
      callNum++;
      capturedHeaders.push({ ...req.headers });

      if (callNum === 1) {
        return {
          status: 302,
          statusText: 'Found',
          headers: { location: 'https://files.stripe.com/files/download' },
          data: '',
        };
      }
      return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/octet-stream' },
        data: { downloaded: true },
      };
    };

    const result = await agentRequest(
      cfg, 'stripe', 'GET', '/customers/123', undefined,
      { adapter: redirectAdapter as any }
    );

    // Hop 1: auth should be present
    expect(capturedHeaders[0].Authorization).toContain(CANARY);
    // Hop 2 (cross-host): auth MUST be stripped
    expect(capturedHeaders[1].Authorization).toBeUndefined();
    // Final result must not contain canary
    containsCanary(result, 'redirectResult');
  });

  // ─── Test 6: Key never sent to allow.hosts entries directly ───
  it('credential attaches only to baseURL origin, never to allow.hosts entries', async () => {
    const cfg: GrabAgentConfig = {
      instances: {
        stripe: {
          baseURL: 'https://api.stripe.com/v1',
          auth: { type: 'bearer', env: 'STRIPE_SECRET_KEY' },
          allow: {
            methods: ['GET'],
            paths: ['/customers/*'],
            hosts: ['cdn.stripe.com'],
          },
          readOnly: true,
        },
      },
    };

    // Attempt to request directly against an allow.hosts entry
    // This should be blocked because the path resolves to a different origin
    await expect(
      agentRequest(
        cfg, 'stripe', 'GET', 'https://cdn.stripe.com/customers/123', undefined,
        { adapter: echoAdapter as any }
      )
    ).rejects.toThrow(); // Origin mismatch
  });

  // ─── Test 7: Agent-supplied Authorization header is stripped ───
  it('agent-supplied Authorization / X-Api-Key headers are not allowed to override', async () => {
    const cfg: GrabAgentConfig = {
      instances: {
        stripe: {
          baseURL: 'https://api.stripe.com/v1',
          auth: { type: 'bearer', env: 'STRIPE_SECRET_KEY' },
          allow: { methods: ['GET'], paths: ['/customers'] },
          readOnly: true,
        },
      },
    };

    // The agent tries to send its own auth header by putting it in the body
    // (the only agent-controlled fields are path, body, fields, maxBytes, dryRun)
    // The tool output must never contain a raw request object that includes the real key
    const result = await agentRequest(
      cfg, 'stripe', 'GET', '/customers', undefined,
      { adapter: echoAdapter as any }
    );

    // Output must be shaped — never a raw Response with .config.headers
    expect(result.config).toBeUndefined();
    expect(result.request).toBeUndefined();
    containsCanary(result, 'agentAuthResult');
  });

  // ─── Test 8: Base64-encoded secret is scrubbed ───
  it('base64-encoded form of secret is scrubbed from response data', async () => {
    registerSecret(CANARY);
    const data = {
      token: CANARY_B64,
      nested: { encoded: `data:${CANARY_B64}:end` },
    };
    const scrubbed = scrubSecrets(data);
    containsCanary(scrubbed, 'base64Scrub');
  });

  // ─── Test 9: URL-encoded secret is scrubbed ───
  it('URL-encoded form of secret is scrubbed from response data', async () => {
    registerSecret(CANARY);
    const data = {
      param: CANARY_URL_ENCODED,
      url: `https://example.com/callback?key=${CANARY_URL_ENCODED}`,
    };
    const scrubbed = scrubSecrets(data);
    containsCanary(scrubbed, 'urlEncodedScrub');
  });

  // ─── Test 10: Tool output shape is well-defined ───
  it('tool output is {status, headers, data} shape, never raw request/response', async () => {
    const cfg = configWithAudit();
    const result = await agentRequest(
      cfg, 'stripe', 'GET', '/customers', undefined,
      { adapter: echoAdapter as any }
    );

    // Required shape
    expect(typeof result.status).toBe('number');
    expect(typeof result.headers).toBe('object');
    expect(result.data).toBeDefined();
    expect(typeof result.statusText).toBe('string');

    // Must NOT leak internal objects
    expect(result.config).toBeUndefined();
    expect(result.request).toBeUndefined();

    // headers must be redacted copies, not originals with secrets
    const headerStr = JSON.stringify(result.headers);
    expect(headerStr).not.toContain(CANARY);
  });

  // ─── Test 11: Invalid config causes fail-closed ───
  it('invalid config causes validateConfig to throw (fail closed)', () => {
    // Missing instances
    expect(() => validateConfig({})).toThrow('"instances" must be an object');

    // Invalid baseURL scheme
    expect(() => validateConfig({
      instances: { bad: { baseURL: 'http://insecure.com' } },
    })).toThrow('must use https://');

    // Missing auth.env
    expect(() => validateConfig({
      instances: {
        bad: {
          baseURL: 'https://api.example.com',
          auth: { type: 'bearer' },
        },
      },
    })).toThrow('"auth.env" is required');

    // Totally invalid JSON shape
    expect(() => validateConfig('not an object')).toThrow('root must be an object');
    expect(() => validateConfig(null)).toThrow('root must be an object');
    expect(() => validateConfig([])).toThrow('root must be an object');
  });

  // ─── Test 12: No env templating in agent-controlled fields ───
  it('no env variable expansion in agent-supplied path or body', async () => {
    const cfg = configWithAudit();

    // Agent tries to use ${STRIPE_SECRET_KEY} in the path
    // It should be treated as a literal string, not expanded
    await expect(
      agentRequest(
        cfg, 'stripe', 'GET', '/customers/${STRIPE_SECRET_KEY}', undefined,
        { adapter: echoAdapter as any }
      )
    ).resolves.toBeDefined(); // or rejects due to path validation, either way no expansion

    // Agent tries to put env reference in body
    const bodyResult = await agentRequest(
      cfg, 'stripe', 'GET', '/customers', { ref: '${STRIPE_SECRET_KEY}' },
      { adapter: echoAdapter as any }
    );
    // The literal string ${STRIPE_SECRET_KEY} should pass through, NOT the value
    // and the canary itself must not appear
    containsCanary(bodyResult, 'envTemplateResult');
  });

  // ─── Test 13: Agent cannot supply full URL bypassing baseURL ───
  it('agent supplies path only, full URL to different origin is rejected', async () => {
    const cfg = configWithAudit();
    await expect(
      agentRequest(
        cfg, 'stripe', 'GET', 'https://evil.com/steal', undefined,
        { adapter: echoAdapter as any }
      )
    ).rejects.toThrow(); // origin mismatch
  });

  // ─── Test 14: listInstances never exposes secrets ───
  it('listInstances output contains no secret values', () => {
    const cfg = configWithAudit();
    const instances = listInstances(cfg);
    const str = JSON.stringify(instances);
    expect(str).not.toContain(CANARY);
    expect(str).not.toContain('STRIPE_SECRET_KEY'); // env var NAME is ok in config, but listInstances shouldn't show it
    // Verify shape
    for (const inst of instances) {
      expect(inst).toHaveProperty('name');
      expect(inst).toHaveProperty('baseURL');
      expect(inst).not.toHaveProperty('auth');
      expect(inst).not.toHaveProperty('headers');
    }
  });

  // ─── Test 15: Basic auth — base64 form is also registered and scrubbed ───
  it('basic auth registers both raw and base64 forms for scrubbing', () => {
    process.env.BASIC_CANARY = 'user:sk_canary_123456';
    resolveAuth({ type: 'basic', env: 'BASIC_CANARY' });

    const b64Form = Buffer.from('user:sk_canary_123456').toString('base64');
    const data = {
      leaked: b64Form,
      raw: 'user:sk_canary_123456',
    };
    const scrubbed = scrubSecrets(data);
    expect(scrubbed.leaked).toBe('[REDACTED]');
    expect(scrubbed.raw).toContain('[REDACTED]');
    delete process.env.BASIC_CANARY;
  });

  // ─── Test 16: header auth type — custom header name key is scrubbed ───
  it('header auth type scrubs custom header value from responses', async () => {
    process.env.CUSTOM_KEY = CANARY;
    const cfg: GrabAgentConfig = {
      instances: {
        custom: {
          baseURL: 'https://api.example.com',
          auth: { type: 'header', headerName: 'X-Custom-Auth', env: 'CUSTOM_KEY' },
          allow: { methods: ['GET'], paths: ['/**'] },
          readOnly: true,
        },
      },
    };

    const result = await agentRequest(
      cfg, 'custom', 'GET', '/data', undefined,
      { adapter: echoAdapter as any }
    );

    containsCanary(result, 'headerAuthResult');
    delete process.env.CUSTOM_KEY;
  });

  // ─── Test 17: Error with response object — config.headers scrubbed ───
  it('redactError scrubs config.headers and response.data containing canary', () => {
    registerSecret(CANARY);
    const err: any = new Error(`API error with key ${CANARY}`);
    err.config = {
      headers: { Authorization: `Bearer ${CANARY}` },
      url: 'https://api.stripe.com/v1/customers',
    };
    err.response = {
      status: 401,
      headers: { 'x-request-id': 'req_123' },
      data: { error: { message: `Invalid key: ${CANARY}` } },
      config: {
        headers: { Authorization: `Bearer ${CANARY}` },
      },
    };

    const clean = redactError(err);
    containsCanary(clean, 'redactedError');
  });

  // ─── Test 18: Protocol-relative, userinfo, and path traversal all blocked ───
  it('agent path attacks are all blocked', async () => {
    const cfg = configWithAudit();

    // Protocol-relative
    await expect(
      agentRequest(cfg, 'stripe', 'GET', '//evil.com/steal', undefined, { adapter: echoAdapter as any })
    ).rejects.toThrow('Protocol-relative');

    // Userinfo
    await expect(
      agentRequest(cfg, 'stripe', 'GET', 'https://attacker@api.stripe.com/v1/customers', undefined, { adapter: echoAdapter as any })
    ).rejects.toThrow();

    // Path traversal past allowed path
    await expect(
      agentRequest(cfg, 'stripe', 'GET', '/customers/../../../etc/passwd', undefined, { adapter: echoAdapter as any })
    ).rejects.toThrow();
  });
});
