import {
  buildURL,
  defaultTransformRequest,
  defaultTransformResponse,
  InterceptorManagerImpl,
  isCancel,
  GrabInstance,
  dispatchRequest,
} from '../src/core';
import { registerAdapter, clearRegistry } from '../src/adapters/registry';
import { Adapter } from '../src/types';

describe('core', () => {
  describe('buildURL', () => {
    it('returns empty string when url and baseURL are undefined', () => {
      expect(buildURL()).toBe('');
    });

    it('returns url directly when no baseURL or params are provided', () => {
      expect(buildURL('/api/users')).toBe('/api/users');
    });

    it('combines baseURL and relative url with correct slashes', () => {
      expect(buildURL('users', 'https://api.example.com/')).toBe('https://api.example.com/users');
      expect(buildURL('/users', 'https://api.example.com')).toBe('https://api.example.com/users');
      expect(buildURL('/users/', 'https://api.example.com/v1/')).toBe(
        'https://api.example.com/v1/users/'
      );
    });

    it('does not prepend baseURL if url is already absolute', () => {
      expect(buildURL('https://other.com/test', 'https://api.example.com')).toBe(
        'https://other.com/test'
      );
    });

    it('returns baseURL if url is undefined', () => {
      expect(buildURL(undefined, 'https://api.example.com')).toBe('https://api.example.com');
    });

    it('appends params correctly', () => {
      const date = new Date('2025-01-01T00:00:00.000Z');
      const params = {
        name: 'alice',
        tags: ['a', 'b'],
        date,
        nested: { key: 'val' },
        skipped: null,
      };
      const url = buildURL('/search', undefined, params);
      expect(url).toContain('name=alice');
      expect(url).toContain('tags%5B%5D=a&tags%5B%5D=b');
      expect(url).toContain(encodeURIComponent(date.toISOString()));
      expect(url).toContain('nested%5Bkey%5D=val');
      expect(url).not.toContain('skipped');
    });

    it('appends with & if url already contains query parameters', () => {
      const url = buildURL('/search?type=user', undefined, { page: 2 });
      expect(url).toBe('/search?type=user&page=2');
    });

    it('accepts config object directly as first argument', () => {
      const url = buildURL({
        url: 'posts/1',
        baseURL: 'https://example.com/api',
        params: { active: true },
      });
      expect(url).toBe('https://example.com/api/posts/1?active=true');
    });
  });

  describe('defaultTransformRequest', () => {
    it('serializes plain object to JSON and sets Content-Type', () => {
      const headers: Record<string, string> = {};
      const result = defaultTransformRequest({ foo: 'bar' }, headers);
      expect(result).toBe('{"foo":"bar"}');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('preserves existing Content-Type header with different casing', () => {
      const headers: Record<string, string> = { 'content-type': 'application/merge-patch+json' };
      const result = defaultTransformRequest({ foo: 'bar' }, headers);
      expect(result).toBe('{"foo":"bar"}');
      expect(headers['content-type']).toBe('application/merge-patch+json');
      expect(headers['Content-Type']).toBeUndefined();
    });

    it('passes through URLSearchParams, Blob, ArrayBuffer, and primitives unmodified', () => {
      const headers: Record<string, string> = {};
      const params = new URLSearchParams({ a: '1' });
      expect(defaultTransformRequest(params, headers)).toBe(params);
      expect(defaultTransformRequest('string', headers)).toBe('string');
      expect(defaultTransformRequest(123, headers)).toBe(123);
      expect(defaultTransformRequest(null, headers)).toBeNull();

      if (typeof Blob !== 'undefined') {
        const blob = new Blob(['abc']);
        expect(defaultTransformRequest(blob, headers)).toBe(blob);
      }

      if (typeof FormData !== 'undefined') {
        const formData = new FormData();
        expect(defaultTransformRequest(formData, headers)).toBe(formData);
      }

      const ab = new ArrayBuffer(8);
      expect(defaultTransformRequest(ab, headers)).toBe(ab);

      const uint8 = new Uint8Array(8);
      expect(defaultTransformRequest(uint8, headers)).toBe(uint8);
    });

    it('passes through streams with pipe method', () => {
      const stream = { pipe: () => {} };
      const headers: Record<string, string> = {};
      expect(defaultTransformRequest(stream, headers)).toBe(stream);
    });
  });

  describe('defaultTransformResponse', () => {
    it('parses valid JSON string into object', () => {
      expect(defaultTransformResponse('{"hello":"world"}')).toEqual({ hello: 'world' });
    });

    it('returns raw string when JSON parse fails', () => {
      expect(defaultTransformResponse('not json')).toBe('not json');
    });

    it('returns non-string values as-is', () => {
      expect(defaultTransformResponse(123)).toBe(123);
      expect(defaultTransformResponse({ a: 1 })).toEqual({ a: 1 });
      expect(defaultTransformResponse(null)).toBeNull();
    });
  });

  describe('InterceptorManagerImpl', () => {
    it('manages interceptors with use, eject, forEach, getHandlers', () => {
      const manager = new InterceptorManagerImpl<number>();
      const fn1 = (v: number) => v + 1;
      const fn2 = (v: number) => v * 2;

      const id1 = manager.use(fn1);
      const id2 = manager.use(fn2);

      expect(manager.getHandlers().length).toBe(2);

      const captured: any[] = [];
      manager.forEach(i => captured.push(i.fulfilled));
      expect(captured).toEqual([fn1, fn2]);

      manager.eject(id1);
      expect(manager.getHandlers().length).toBe(1);
      expect(manager.getHandlers()[0].fulfilled).toBe(fn2);

      manager.eject(id2);
      expect(manager.getHandlers().length).toBe(0);
    });
  });

  describe('dispatchRequest', () => {
    it('dispatches request directly through resolved adapter', async () => {
      const mockAdapter: Adapter = async (cfg) => ({
        data: 'dispatched:' + cfg.url,
        status: 200,
        statusText: 'OK',
        headers: {},
        request: {},
      });
      const res = await dispatchRequest({ url: '/test-dispatch', adapter: mockAdapter });
      expect(res.data).toBe('dispatched:/test-dispatch');
    });
  });

  describe('isCancel', () => {
    it('returns true for ERR_CANCELED or ABORTED', () => {
      expect(isCancel({ code: 'ERR_CANCELED' })).toBe(true);
      expect(isCancel({ code: 'ABORTED' })).toBe(true);
    });

    it('returns false for other errors or undefined', () => {
      expect(isCancel({ code: 'ETIMEDOUT' })).toBe(false);
      expect(isCancel(null)).toBe(false);
      expect(isCancel(undefined)).toBe(false);
      expect(isCancel(new Error('fail'))).toBe(false);
    });
  });

  describe('GrabInstance with mock adapter', () => {
    const mockAdapter: Adapter = async config => {
      const status = config.url.includes('error-500') ? 500 : 200;
      return {
        data: { url: config.url, method: config.method, data: config.data },
        status,
        statusText: status === 200 ? 'OK' : 'Internal Server Error',
        headers: { 'content-type': 'application/json' },
        request: config,
      };
    };

    beforeAll(() => {
      registerAdapter('fetch', mockAdapter);
    });

    afterAll(() => {
      clearRegistry();
    });

    it('performs requests via get, post, put, delete, patch, head, options', async () => {
      const api = GrabInstance.create({ adapter: mockAdapter });

      const getRes = await api.get('/test');
      expect(getRes.status).toBe(200);
      expect(getRes.data.method).toBe('GET');

      const postRes = await api.post('/test', { name: 'john' });
      expect(postRes.status).toBe(200);
      expect(postRes.data.method).toBe('POST');
      expect(postRes.data.data).toBe('{"name":"john"}');

      const putRes = await api.put('/test', { name: 'john' });
      expect(putRes.data.method).toBe('PUT');

      const delRes = await api.delete('/test');
      expect(delRes.data.method).toBe('DELETE');

      const patchRes = await api.patch('/test', { patch: true });
      expect(patchRes.data.method).toBe('PATCH');

      const headRes = await api.head('/test');
      expect(headRes.data.method).toBe('HEAD');

      const optRes = await api.options('/test');
      expect(optRes.data.method).toBe('OPTIONS');
    });

    it('throws ERR_BAD_RESPONSE when validateStatus fails', async () => {
      const api = new GrabInstance({ adapter: mockAdapter });

      await expect(api.get('/error-500')).rejects.toMatchObject({
        code: 'ERR_BAD_RESPONSE',
        status: 500,
        isGrabError: true,
      });
    });

    it('allows custom validateStatus', async () => {
      const api = new GrabInstance({
        adapter: mockAdapter,
        validateStatus: status => status === 500,
      });

      const res = await api.get('/error-500');
      expect(res.status).toBe(500);
    });

    it('executes request and response interceptors', async () => {
      const api = new GrabInstance({ adapter: mockAdapter });

      api.interceptors.request.use(config => {
        config.headers = config.headers || {};
        config.headers['X-Custom'] = 'intercepted';
        return config;
      });

      api.interceptors.response.use(response => {
        response.data.intercepted = true;
        return response;
      });

      const res = await api.get('/test');
      expect(res.data.intercepted).toBe(true);
      expect(res.config.headers?.['X-Custom']).toBe('intercepted');
    });

    it('handles rejected interceptors correctly', async () => {
      const api = new GrabInstance({ adapter: mockAdapter });

      api.interceptors.request.use(() => {
        throw new Error('Blocked by request interceptor');
      });

      await expect(api.get('/test')).rejects.toThrow('Blocked by request interceptor');
    });

    it('executes request interceptors in LIFO order and response interceptors in FIFO order', async () => {
      const api = new GrabInstance({ adapter: mockAdapter });
      const order: string[] = [];

      api.interceptors.request.use(config => {
        order.push('request-1');
        return config;
      });
      api.interceptors.request.use(config => {
        order.push('request-2');
        return config;
      });

      api.interceptors.response.use(response => {
        order.push('response-1');
        return response;
      });
      api.interceptors.response.use(response => {
        order.push('response-2');
        return response;
      });

      await api.get('/test');
      expect(order).toEqual(['request-2', 'request-1', 'response-1', 'response-2']);
    });

    it('honors rejected handler on request interceptors for error recovery', async () => {
      const api = new GrabInstance({ adapter: mockAdapter });

      // Registered first -> runs last in LIFO request chain, catching upstream error
      api.interceptors.request.use(
        config => config,
        () => {
          // Recover by returning valid config
          return { url: '/recovered', adapter: mockAdapter };
        }
      );
      // Registered second -> runs first in LIFO request chain, throws error
      api.interceptors.request.use(
        () => {
          throw new Error('Initial error');
        }
      );

      const res = await api.get('/initial');
      expect(res.data.url).toBe('/recovered');
    });

    it('supports custom transforms and body alias', async () => {
      const customReqTransform = (d: any) => `custom-${d}`;
      const customResTransform = (d: any) => ({ ...d, transformed: true });

      const api = new GrabInstance({
        adapter: mockAdapter,
        transformRequest: [customReqTransform],
        transformResponse: [customResTransform],
      });

      const res = await api.post('/test', undefined, { body: 'data' });
      expect(res.data.transformed).toBe(true);
      expect(res.data.data).toBe('custom-data');
    });

    it('handles response interceptor rejection and recovery', async () => {
      const api = new GrabInstance({ adapter: mockAdapter });

      api.interceptors.response.use(
        res => res,
        err => {
          return { data: 'recovered', status: 200, statusText: 'OK', headers: {}, config: err.config };
        }
      );

      const res = await api.get('/error-500');
      expect(res.data).toBe('recovered');
    });

    it('supports static isCancel', () => {
      expect(GrabInstance.isCancel({ code: 'ERR_CANCELED' })).toBe(true);
      expect(GrabInstance.isCancel({ code: 'OTHER' })).toBe(false);
    });
  });
});
