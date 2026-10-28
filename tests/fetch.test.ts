import { fetchAdapter } from '../src/adapters/fetch';
import { AdapterRequest } from '../src/types';

describe('adapters/fetch', () => {
  const originalFetch =
    typeof globalThis !== 'undefined' && globalThis.fetch
      ? globalThis.fetch
      : typeof window !== 'undefined'
        ? window.fetch
        : undefined;

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
      if (typeof window !== 'undefined') {
        window.fetch = originalFetch;
      }
      if (typeof global !== 'undefined') {
        (global as any).fetch = originalFetch;
      }
    }
  });

  it('performs successful GET request and returns raw text for json by default', async () => {
    const mockHeaders = new Headers({ 'content-type': 'application/json' });
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: mockHeaders,
      text: async () => JSON.stringify({ message: 'success' }),
    } as any);

    const config: AdapterRequest = {
      url: 'https://example.com/api',
      headers: { 'X-Test': '1' },
      method: 'GET',
    };

    const res = await fetchAdapter(config);
    expect(res.status).toBe(200);
    expect(res.data).toBe(JSON.stringify({ message: 'success' }));
    expect(res.headers['content-type']).toBe('application/json');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({
        method: 'GET',
        body: undefined,
        headers: expect.objectContaining({
          'X-Test': '1',
          Accept: 'application/json, text/plain, */*',
        }),
      })
    );
  });

  it('allows an optional custom fetch implementation to be injected via config', async () => {
    const customFetch = jest.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'x-custom-engine': 'true' }),
      text: async () => 'custom-fetch-response',
    });

    const res = await fetchAdapter({
      url: 'https://custom.example.com',
      headers: {},
      fetch: customFetch,
    });

    expect(customFetch).toHaveBeenCalledWith('https://custom.example.com', expect.anything());
    expect(res.data).toBe('custom-fetch-response');
    expect(res.headers['x-custom-engine']).toBe('true');
  });

  it('performs POST request sending data as body', async () => {
    const mockHeaders = new Headers();
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 201,
      statusText: 'Created',
      headers: mockHeaders,
      text: async () => JSON.stringify({ id: 10 }),
    } as any);

    const config: AdapterRequest = {
      url: 'https://example.com/items',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ name: 'new item' }),
    };

    const res = await fetchAdapter(config);
    expect(res.status).toBe(201);
    expect(res.data).toBe(JSON.stringify({ id: 10 }));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.com/items',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'new item' }),
      })
    );
  });

  it('handles responseType text, arraybuffer, blob, and 204 no content', async () => {
    // 204 No Content
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 204,
      statusText: 'No Content',
      headers: new Headers(),
    } as any);

    const noContentRes = await fetchAdapter({
      url: 'https://example.com/204',
      headers: {},
    });
    expect(noContentRes.data).toBeNull();
    expect(noContentRes.status).toBe(204);

    // text responseType
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      text: async () => 'plain text response',
    } as any);

    const textRes = await fetchAdapter({
      url: 'https://example.com/text',
      headers: {},
      responseType: 'text',
    });
    expect(textRes.data).toBe('plain text response');

    // arraybuffer responseType
    const buffer = new ArrayBuffer(8);
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => buffer,
    } as any);

    const abRes = await fetchAdapter({
      url: 'https://example.com/ab',
      headers: {},
      responseType: 'arraybuffer',
    });
    expect(abRes.data).toBe(buffer);

    // blob responseType
    const mockBlob = { size: 100, type: 'application/octet-stream' };
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      blob: async () => mockBlob,
    } as any);

    const blobRes = await fetchAdapter({
      url: 'https://example.com/blob',
      headers: {},
      responseType: 'blob',
    });
    expect(blobRes.data).toBe(mockBlob);
  });

  it('does not throw on non-2xx status (leaves validation to core)', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => 'Resource not found',
    } as any);

    const res = await fetchAdapter({
      url: 'https://example.com/not-found',
      headers: {},
    });
    expect(res.status).toBe(404);
    expect(res.data).toBe('Resource not found');
  });

  it('maps TimeoutError to ETIMEDOUT when timeout triggers', async () => {
    const timeoutErr = new Error('The operation timed out.');
    timeoutErr.name = 'TimeoutError';
    globalThis.fetch = jest.fn().mockRejectedValue(timeoutErr);

    await expect(
      fetchAdapter({
        url: 'https://example.com/timeout',
        headers: {},
        timeout: 100,
      })
    ).rejects.toMatchObject({
      code: 'ETIMEDOUT',
    });
  });

  it('maps AbortError to ERR_CANCELED when signal is aborted', async () => {
    const controller = new AbortController();
    const abortErr = new Error('The operation was aborted.');
    abortErr.name = 'AbortError';
    globalThis.fetch = jest.fn().mockRejectedValue(abortErr);

    const promise = fetchAdapter({
      url: 'https://example.com/cancel',
      headers: {},
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toMatchObject({
      code: 'ERR_CANCELED',
    });
  });

  it('throws ERR_NETWORK on general fetch failure', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('Failed to fetch'));

    await expect(
      fetchAdapter({
        url: 'https://example.com/fail',
        headers: {},
      })
    ).rejects.toMatchObject({
      code: 'ERR_NETWORK',
      message: 'Failed to fetch',
    });
  });

  it('throws ERR_CANCELED if signal was already aborted before request', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchAdapter({
        url: 'https://example.com/aborted',
        headers: {},
        signal: controller.signal,
      })
    ).rejects.toMatchObject({
      code: 'ERR_CANCELED',
    });
  });

  it('throws ERR_NO_ADAPTER when fetch is completely undefined', async () => {
    const savedFetch = (globalThis as any).fetch;
    const savedWinFetch = typeof window !== 'undefined' ? (window as any).fetch : undefined;
    (globalThis as any).fetch = undefined;
    if (typeof window !== 'undefined') {
      (window as any).fetch = undefined;
    }

    try {
      await expect(
        fetchAdapter({
          url: 'https://example.com',
          headers: {},
        })
      ).rejects.toMatchObject({
        code: 'ERR_NO_ADAPTER',
      });
    } finally {
      (globalThis as any).fetch = savedFetch;
      if (typeof window !== 'undefined') {
        (window as any).fetch = savedWinFetch;
      }
    }
  });

  it('handles stream download progress with blob, text, and arraybuffer', async () => {
    const encoder = new TextEncoder();
    const chunk = encoder.encode('raw text content');
    let readDone = false;

    const mockBody = {
      getReader: () => ({
        read: jest.fn().mockImplementation(async () => {
          if (!readDone) {
            readDone = true;
            return { done: false, value: chunk };
          }
          return { done: true, value: undefined };
        }),
      }),
    };

    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: mockBody,
    } as any);

    const textRes = await fetchAdapter({
      url: 'https://example.com',
      headers: {},
      responseType: 'text',
      onDownloadProgress: () => {},
    });
    expect(textRes.data).toBe('raw text content');

    readDone = false;
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: mockBody,
    } as any);

    const blobRes = await fetchAdapter({
      url: 'https://example.com',
      headers: {},
      responseType: 'blob',
      onDownloadProgress: () => {},
    });
    expect(blobRes.data).toBeDefined();

    readDone = false;
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: mockBody,
    } as any);

    const abStreamRes = await fetchAdapter({
      url: 'https://example.com',
      headers: {},
      responseType: 'arraybuffer',
      onDownloadProgress: () => {},
    });
    expect(abStreamRes.data).toBeInstanceOf(ArrayBuffer);
  });

  it('parses headers when res.headers has forEach instead of entries', async () => {
    const fakeHeaders = {
      forEach: (cb: (v: string, k: string) => void) => {
        cb('custom-header-val', 'X-Custom-H');
      },
    };

    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: fakeHeaders,
      text: () => Promise.resolve('ok'),
    } as any);

    const res = await fetchAdapter({
      url: 'https://example.com',
      headers: {},
      method: 'GET',
    });

    expect(res.headers['x-custom-h']).toBe('custom-header-val');
  });

  it('wires external signal abort to internal controller', async () => {
    const externalController = new AbortController();
    const mockFetch = jest.fn().mockImplementation((url, opts) => {
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
        // Abort the external controller, which should trigger onExternalAbort
        externalController.abort();
      });
    });

    const promise = fetchAdapter({
      url: 'https://example.com/abort',
      headers: {},
      method: 'GET',
      timeout: 5000,
      signal: externalController.signal,
      fetch: mockFetch,
    });

    await expect(promise).rejects.toThrow();
  });

  it('cleans up abort listener on successful request with timeout and signal', async () => {
    const signal = new AbortController().signal;
    const mockFetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve('ok'),
    });
    const res = await fetchAdapter({
      url: 'https://example.com/clean',
      headers: {},
      method: 'GET',
      timeout: 5000,
      signal,
      fetch: mockFetch,
    });
    expect(res.status).toBe(200);
  });
});
