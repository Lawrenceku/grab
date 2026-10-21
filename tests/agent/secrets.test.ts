import { resolveAuth, redactHeaders, redactError } from '../src/agent/secrets';

describe('agent/secrets', () => {
  describe('resolveAuth', () => {
    afterEach(() => {
      delete process.env.TEST_BEARER_KEY;
      delete process.env.TEST_BASIC_KEY;
      delete process.env.TEST_HEADER_KEY;
    });

    it('resolves bearer auth from env var', () => {
      process.env.TEST_BEARER_KEY = 'sk_test_123';
      const headers = resolveAuth({ type: 'bearer', env: 'TEST_BEARER_KEY' });
      expect(headers).toEqual({ Authorization: 'Bearer sk_test_123' });
    });

    it('resolves basic auth from env var (base64 encoded)', () => {
      process.env.TEST_BASIC_KEY = 'user:pass';
      const headers = resolveAuth({ type: 'basic', env: 'TEST_BASIC_KEY' });
      const expected = Buffer.from('user:pass').toString('base64');
      expect(headers).toEqual({ Authorization: `Basic ${expected}` });
    });

    it('resolves custom header auth from env var', () => {
      process.env.TEST_HEADER_KEY = 'my-api-key-123';
      const headers = resolveAuth({ type: 'header', env: 'TEST_HEADER_KEY', headerName: 'X-API-Key' });
      expect(headers).toEqual({ 'X-API-Key': 'my-api-key-123' });
    });

    it('defaults headerName to X-API-Key when not specified', () => {
      process.env.TEST_HEADER_KEY = 'key123';
      const headers = resolveAuth({ type: 'header', env: 'TEST_HEADER_KEY' });
      expect(headers).toEqual({ 'X-API-Key': 'key123' });
    });

    it('throws ERR_AUTH when env var is not set', () => {
      expect(() => resolveAuth({ type: 'bearer', env: 'NONEXISTENT_KEY' }))
        .toThrow('Environment variable "NONEXISTENT_KEY" is not set');
    });

    it('thrown error has code ERR_AUTH', () => {
      try {
        resolveAuth({ type: 'bearer', env: 'NONEXISTENT_KEY' });
        fail('should have thrown');
      } catch (err: any) {
        expect(err.code).toBe('ERR_AUTH');
      }
    });
  });

  describe('redactHeaders', () => {
    it('redacts authorization headers', () => {
      const result = redactHeaders({
        'Authorization': 'Bearer sk_test_123',
        'Content-Type': 'application/json',
      });
      expect(result.Authorization).toBe('[REDACTED]');
      expect(result['Content-Type']).toBe('application/json');
    });

    it('redacts case-insensitively', () => {
      const result = redactHeaders({
        'authorization': 'Bearer xxx',
        'x-api-key': 'secret',
        'cookie': 'session=abc',
        'set-cookie': 'token=def',
        'proxy-authorization': 'Basic xxx',
      });
      expect(result.authorization).toBe('[REDACTED]');
      expect(result['x-api-key']).toBe('[REDACTED]');
      expect(result.cookie).toBe('[REDACTED]');
      expect(result['set-cookie']).toBe('[REDACTED]');
      expect(result['proxy-authorization']).toBe('[REDACTED]');
    });

    it('does not mutate the original object', () => {
      const original = { Authorization: 'Bearer secret' };
      redactHeaders(original);
      expect(original.Authorization).toBe('Bearer secret');
    });

    it('passes through non-sensitive headers unchanged', () => {
      const result = redactHeaders({
        'Content-Type': 'application/json',
        'Accept': 'text/html',
        'X-Request-Id': '12345',
      });
      expect(result['Content-Type']).toBe('application/json');
      expect(result['Accept']).toBe('text/html');
      expect(result['X-Request-Id']).toBe('12345');
    });
  });

  describe('redactError', () => {
    it('redacts auth headers from error.config', () => {
      const error = {
        message: 'Request failed',
        name: 'GrabError',
        code: 'ERR_BAD_RESPONSE',
        isGrabError: true,
        config: {
          headers: { Authorization: 'Bearer sk_live_secret' },
        },
      };

      const clean = redactError(error);
      expect(clean.config.headers.Authorization).toBe('[REDACTED]');
      expect(clean.code).toBe('ERR_BAD_RESPONSE');
    });

    it('redacts Bearer tokens from error message', () => {
      const error = {
        message: 'Failed with Bearer sk_live_secret at endpoint',
        name: 'GrabError',
      };

      const clean = redactError(error);
      expect(clean.message).toContain('Bearer [REDACTED]');
      expect(clean.message).not.toContain('sk_live_secret');
    });

    it('redacts response headers too', () => {
      const error = {
        message: 'Error',
        name: 'GrabError',
        response: {
          headers: { 'set-cookie': 'token=secret123' },
          config: { headers: { Authorization: 'Bearer xxx' } },
        },
      };

      const clean = redactError(error);
      expect(clean.response.headers['set-cookie']).toBe('[REDACTED]');
      expect(clean.response.config.headers.Authorization).toBe('[REDACTED]');
    });

    it('handles null/undefined error gracefully', () => {
      expect(redactError(null)).toBe(null);
      expect(redactError(undefined)).toBe(undefined);
    });
  });
});
