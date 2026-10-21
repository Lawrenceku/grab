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

  it('performs successful GET request and returns json by default', async () => {
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
    expect(res.data).toEqual({ message: 'success' });
    expect(res.headers['content-type']).toBe('application/json');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({
        method: 'GET',
        body: undefined,
        headers: expect.objectContaining({ 'X-Test': '1', Accept: 'application/json' }),
      })
    );
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
      url: 'https://example.com/api',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      data: '{"name":"bob"}',
    };

    const res = await fetchAdapter(config);
    expect(res.status).toBe(201);
    expect(res.data).toEqual({ id: 10 });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({
        method: 'POST',
        body: '{"name":"bob"}',
      })
    );
  });

  it('handles responseType text, arraybuffer, blob, and 204 no content', async () => {
    // text
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      text: async () => 'plain text output',
    } as any);
    const textRes = await fetchAdapter({ url: 'https://example.com', headers: {}, responseType: 'text' });
    expect(textRes.data).toBe('plain text output');

    // arraybuffer
    const buf = new ArrayBuffer(8);
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => buf,
    } as any);
    const abRes = await fetchAdapter({ url: 'https://example.com', headers: {}, responseType: 'arraybuffer' });
    expect(abRes.data).toBe(buf);

    // blob
    const blob = new Blob(['data']);
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      blob: async () => blob,
    } as any);
    const blobRes = await fetchAdapter({ url: 'https://example.com', headers: {}, responseType: 'blob' });
    expect(blobRes.data).toBe(blob);

    // 204
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 204,
      headers: new Headers(),
    } as any);
    const noContentRes = await fetchAdapter({ url: 'https://example.com', headers: {} });
    expect(noContentRes.data).toBeNull();
  });

  it('handles onDownloadProgress with readable stream', async () => {
    const encoder = new TextEncoder();
    const chunk1 = encoder.encode('{"part":');
    const chunk2 = encoder.encode('1}');
    let readCount = 0;

    const mockReader = {
      read: jest.fn().mockImplementation(async () => {
        readCount++;
        if (readCount === 1) return { done: false, value: chunk1 };
        if (readCount === 2) return { done: false, value: chunk2 };
        return { done: true, value: undefined };
      }),
    };

    const mockBody = {
      getReader: () => mockReader,
    };

    const mockHeaders = new Headers({ 'content-length': String(chunk1.length + chunk2.length) });
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: mockHeaders,
      body: mockBody,
    } as any);

    const progressEvents: any[] = [];
    const res = await fetchAdapter({
      url: 'https://example.com',
      headers: {},
      responseType: 'json',
      onDownloadProgress: e => progressEvents.push(e),
    });

    expect(progressEvents.length).toBe(2);
    expect(res.data).toEqual({ part: 1 });
  });

  it('throws ETIMEDOUT when timeout triggers', async () => {
    jest.useFakeTimers();

    globalThis.fetch = jest.fn().mockImplementation((_url, opts) => {
      return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const promise = fetchAdapter({
      url: 'https://example.com',
      headers: {},
      timeout: 100,
    });

    jest.advanceTimersByTime(150);

    await expect(promise).rejects.toMatchObject({
      code: 'ETIMEDOUT',
      message: 'Request timeout after 100ms',
    });

    jest.useRealTimers();
  });

  it('throws ERR_CANCELED when signal is aborted', async () => {
    const controller = new AbortController();
    globalThis.fetch = jest.fn().mockImplementation((_url, opts) => {
      return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The user aborted a request.');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const promise = fetchAdapter({
      url: 'https://example.com',
      headers: {},
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toMatchObject({
      code: 'ERR_CANCELED',
      message: 'Request aborted',
    });
  });

  it('throws ERR_NETWORK on fetch failure', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      fetchAdapter({
        url: 'https://example.com',
        headers: {},
      })
    ).rejects.toMatchObject({
      code: 'ERR_NETWORK',
      message: 'Failed to fetch',
    });
  });

  it('throws ERR_CANCELED if signal was already aborted before request', async () => {
    globalThis.fetch = jest.fn();
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchAdapter({
        url: 'https://example.com',
        headers: {},
        signal: controller.signal,
        timeout: 1000,
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

  it('handles stream download progress with blob and text response types', async () => {
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

    // Stream with arraybuffer
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

    // Stream with invalid json
    readDone = false;
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: mockBody,
    } as any);

    const badJsonStreamRes = await fetchAdapter({
      url: 'https://example.com',
      headers: {},
      responseType: 'json',
      onDownloadProgress: () => {},
    });
    expect(badJsonStreamRes.data).toBe('raw text content');

    // Non-stream invalid json fallback
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      text: async () => 'not a valid json string',
    } as any);

    const badJsonRes = await fetchAdapter({
      url: 'https://example.com',
      headers: {},
      responseType: 'json',
    });
    expect(badJsonRes.data).toBe('not a valid json string');
  });
});
