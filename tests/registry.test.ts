import {
  registerAdapter,
  resolveAdapter,
  createError,
  isAdapterAvailable,
  getRegisteredAdapter,
  clearRegistry,
} from '../src/adapters/registry';
import { Adapter, AdapterRequest, AdapterResponse, RequestConfig } from '../src/types';

describe('adapters/registry', () => {
  const dummyAdapter: Adapter = async (config: AdapterRequest): Promise<AdapterResponse> => ({
    data: 'dummy',
    status: 200,
    statusText: 'OK',
    headers: {},
    request: config,
  });

  afterEach(() => {
    clearRegistry();
  });

  describe('createError', () => {
    it('creates GrabError with all standardized properties', () => {
      const config: RequestConfig = { url: '/test' };
      const response = {
        data: { error: 'Not found' },
        status: 404,
        statusText: 'Not Found',
        headers: {},
        config,
      };
      const req = { id: 123 };

      const err = createError('Not Found', 'ERR_BAD_RESPONSE', config, req, response);

      expect(err.name).toBe('GrabError');
      expect(err.message).toBe('Not Found');
      expect(err.code).toBe('ERR_BAD_RESPONSE');
      expect(err.config).toBe(config);
      expect(err.request).toBe(req);
      expect(err.response).toBe(response);
      expect(err.status).toBe(404);
      expect(err.isGrabError).toBe(true);
      expect(err.isAxiosError).toBe(true);
    });

    it('creates GrabError without optional response or request', () => {
      const err = createError('Network failed', 'ERR_NETWORK');
      expect(err.message).toBe('Network failed');
      expect(err.code).toBe('ERR_NETWORK');
      expect(err.status).toBeUndefined();
      expect(err.response).toBeUndefined();
      expect(err.isGrabError).toBe(true);
    });
  });

  describe('registerAdapter and getRegisteredAdapter', () => {
    it('registers and retrieves adapters by name', () => {
      expect(getRegisteredAdapter('fetch')).toBeUndefined();
      registerAdapter('fetch', dummyAdapter);
      expect(getRegisteredAdapter('fetch')).toBe(dummyAdapter);
    });
  });

  describe('isAdapterAvailable', () => {
    const hasFetch =
      (typeof window !== 'undefined' && typeof window.fetch === 'function') ||
      (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function');
    const hasXHR = typeof XMLHttpRequest !== 'undefined';

    it('returns false for unregistered adapter', () => {
      expect(isAdapterAvailable('fetch')).toBe(false);
    });

    it('checks fetch availability based on runtime environment', () => {
      registerAdapter('fetch', dummyAdapter);
      // In jsdom, fetch is not provided; result depends on env
      expect(isAdapterAvailable('fetch')).toBe(hasFetch);
    });

    it('checks xhr availability', () => {
      registerAdapter('xhr', dummyAdapter);
      expect(isAdapterAvailable('xhr')).toBe(hasXHR);
    });

    it('checks http availability (Node process)', () => {
      registerAdapter('http', dummyAdapter);
      expect(isAdapterAvailable('http')).toBe(true);
    });
  });

  describe('resolveAdapter', () => {
    it('returns custom function adapter directly', () => {
      const custom: Adapter = async () => ({
        data: 'custom',
        status: 200,
        statusText: 'OK',
        headers: {},
      });
      expect(resolveAdapter(custom)).toBe(custom);
      expect(resolveAdapter({ adapter: custom })).toBe(custom);
    });

    it('resolves registered adapter by string name (bypasses availability)', () => {
      registerAdapter('fetch', dummyAdapter);
      // Explicit string name does a direct registry lookup, no availability check
      expect(resolveAdapter('fetch')).toBe(dummyAdapter);
      expect(resolveAdapter({ adapter: 'fetch' })).toBe(dummyAdapter);
    });

    it('throws ERR_NO_ADAPTER for unregistered string adapter', () => {
      expect(() => resolveAdapter('http')).toThrow();
      try {
        resolveAdapter('http');
      } catch (e: any) {
        expect(e.code).toBe('ERR_NO_ADAPTER');
        expect(e.isGrabError).toBe(true);
      }
    });

    it('resolves first available adapter from array', () => {
      registerAdapter('xhr', dummyAdapter);
      const chosen = resolveAdapter(['http', 'xhr'] as any);
      expect(chosen).toBe(dummyAdapter);
    });

    it('resolves function inside adapter array', () => {
      const chosen = resolveAdapter([dummyAdapter]);
      expect(chosen).toBe(dummyAdapter);
    });

    it('throws ERR_NO_ADAPTER when none of array adapters are available', () => {
      // Neither http nor fetch is registered
      expect(() => resolveAdapter(['http', 'fetch'] as any)).toThrow();
      try {
        resolveAdapter(['http', 'fetch'] as any);
      } catch (e: any) {
        expect(e.code).toBe('ERR_NO_ADAPTER');
      }
    });

    it('falls back to XHR when onUploadProgress is specified', () => {
      const xhrMock: Adapter = async () => ({ data: 'xhr', status: 200, statusText: 'OK', headers: {} });
      const fetchMock: Adapter = async () => ({ data: 'fetch', status: 200, statusText: 'OK', headers: {} });
      registerAdapter('xhr', xhrMock);
      registerAdapter('fetch', fetchMock);

      const resolved = resolveAdapter({ onUploadProgress: () => {} });
      expect(resolved).toBe(xhrMock);
    });

    it('default resolution picks best available adapter for environment', () => {
      const xhrMock: Adapter = async () => ({ data: 'xhr', status: 200, statusText: 'OK', headers: {} });
      const fetchMock: Adapter = async () => ({ data: 'fetch', status: 200, statusText: 'OK', headers: {} });
      registerAdapter('xhr', xhrMock);
      registerAdapter('fetch', fetchMock);

      // Default resolution checks runtime availability:
      // - In jsdom: fetch unavailable, XHR available → picks XHR
      // - In real browser/Node 18+: fetch available → picks fetch
      const resolved = resolveAdapter({});
      const hasFetchRuntime =
        (typeof window !== 'undefined' && typeof window.fetch === 'function') ||
        (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function');
      if (hasFetchRuntime) {
        expect(resolved).toBe(fetchMock);
      } else {
        expect(resolved).toBe(xhrMock);
      }
    });

    it('resolves adapter when specified inside config object', () => {
      registerAdapter('fetch', dummyAdapter);
      // Function adapter in config
      expect(resolveAdapter({ adapter: dummyAdapter })).toBe(dummyAdapter);
      // String adapter in config (direct registry lookup, no availability check)
      expect(resolveAdapter({ adapter: 'fetch' })).toBe(dummyAdapter);
      // Function inside array always works
      expect(resolveAdapter({ adapter: [dummyAdapter] })).toBe(dummyAdapter);
    });

    it('falls back to http if registered when fetch and xhr are not available', () => {
      const httpMock: Adapter = async () => ({ data: 'http', status: 200, statusText: 'OK', headers: {} });
      registerAdapter('http', httpMock);
      expect(resolveAdapter({})).toBe(httpMock);
    });

    it('throws ERR_NO_ADAPTER when no adapter is available', () => {
      expect(() => resolveAdapter({})).toThrow();
      try {
        resolveAdapter({});
      } catch (e: any) {
        expect(e.code).toBe('ERR_NO_ADAPTER');
      }
    });
  });
});
