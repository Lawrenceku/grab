import { xhrAdapter, parseHeaders } from '../src/adapters/xhr';
import { AdapterRequest } from '../src/types';

describe('adapters/xhr', () => {
  describe('parseHeaders', () => {
    it('returns empty object for empty or null string', () => {
      expect(parseHeaders('')).toEqual({});
    });

    it('parses multi-line headers into lowercase keys', () => {
      const raw = 'Content-Type: application/json\r\nX-Custom-Header: value123\nDate: today';
      const parsed = parseHeaders(raw);
      expect(parsed).toEqual({
        'content-type': 'application/json',
        'x-custom-header': 'value123',
        date: 'today',
      });
    });
  });

  describe('xhrAdapter', () => {
    let mockXHR: any;
    const originalXHR = (globalThis as any).XMLHttpRequest;

    beforeEach(() => {
      mockXHR = {
        open: jest.fn(),
        send: jest.fn(),
        setRequestHeader: jest.fn(),
        abort: jest.fn(),
        getAllResponseHeaders: jest.fn().mockReturnValue('content-type: application/json'),
        upload: {},
        status: 200,
        statusText: 'OK',
        response: '{"success":true}',
        responseText: '{"success":true}',
      };

      (globalThis as any).XMLHttpRequest = jest.fn(() => mockXHR);
    });

    afterEach(() => {
      (globalThis as any).XMLHttpRequest = originalXHR;
    });

    it('performs request and resolves with parsed json by default', async () => {
      const config: AdapterRequest = {
        url: 'https://example.com/api',
        method: 'GET',
        headers: { 'X-Key': '123' },
      };

      const promise = xhrAdapter(config);
      expect(mockXHR.open).toHaveBeenCalledWith('GET', 'https://example.com/api', true);
      expect(mockXHR.setRequestHeader).toHaveBeenCalledWith('Accept', 'application/json');
      expect(mockXHR.setRequestHeader).toHaveBeenCalledWith('X-Key', '123');

      mockXHR.onload();
      const res = await promise;

      expect(res.status).toBe(200);
      expect(res.data).toEqual({ success: true });
      expect(res.headers['content-type']).toBe('application/json');
    });

    it('wires upload progress callback to xhr.upload.onprogress', async () => {
      const onUploadProgress = jest.fn();
      const config: AdapterRequest = {
        url: 'https://example.com/upload',
        method: 'POST',
        headers: {},
        data: 'file-data',
        onUploadProgress,
      };

      const promise = xhrAdapter(config);
      expect(mockXHR.upload.onprogress).toBe(onUploadProgress);

      mockXHR.onload();
      await promise;
    });

    it('wires download progress callback to xhr.onprogress', async () => {
      const onDownloadProgress = jest.fn();
      const config: AdapterRequest = {
        url: 'https://example.com/download',
        method: 'GET',
        headers: {},
        onDownloadProgress,
      };

      const promise = xhrAdapter(config);
      expect(mockXHR.onprogress).toBe(onDownloadProgress);

      mockXHR.onload();
      await promise;
    });

    it('handles network error and rejects with ERR_NETWORK', async () => {
      const config: AdapterRequest = {
        url: 'https://example.com/fail',
        headers: {},
      };

      const promise = xhrAdapter(config);
      mockXHR.onerror();

      await expect(promise).rejects.toMatchObject({
        code: 'ERR_NETWORK',
        message: 'Network error occurred',
      });
    });

    it('handles timeout and rejects with ETIMEDOUT', async () => {
      const config: AdapterRequest = {
        url: 'https://example.com/timeout',
        headers: {},
        timeout: 500,
      };

      const promise = xhrAdapter(config);
      mockXHR.ontimeout();

      await expect(promise).rejects.toMatchObject({
        code: 'ETIMEDOUT',
        message: 'Request timeout after 500ms',
      });
    });

    it('handles abort signal and rejects with ERR_CANCELED', async () => {
      const controller = new AbortController();
      const config: AdapterRequest = {
        url: 'https://example.com/abort',
        headers: {},
        signal: controller.signal,
      };

      const promise = xhrAdapter(config);
      controller.abort();

      await expect(promise).rejects.toMatchObject({
        code: 'ERR_CANCELED',
        message: 'Request aborted',
      });
      expect(mockXHR.abort).toHaveBeenCalled();
    });

    it('rejects with ERR_CANCELED immediately if signal already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        xhrAdapter({
          url: 'https://example.com/abort',
          headers: {},
          signal: controller.signal,
        })
      ).rejects.toMatchObject({
        code: 'ERR_CANCELED',
        message: 'Request aborted',
      });
    });

    it('rejects with ERR_NO_ADAPTER if XMLHttpRequest is undefined', async () => {
      (globalThis as any).XMLHttpRequest = undefined;

      await expect(
        xhrAdapter({
          url: 'https://example.com',
          headers: {},
        })
      ).rejects.toMatchObject({
        code: 'ERR_NO_ADAPTER',
      });
    });

    it('handles exception in xhr.send and rejects with ERR_NETWORK', async () => {
      mockXHR.send.mockImplementation(() => {
        throw new Error('Blocked by security policy');
      });

      await expect(
        xhrAdapter({
          url: 'https://example.com',
          headers: {},
        })
      ).rejects.toMatchObject({
        code: 'ERR_NETWORK',
        message: 'Blocked by security policy',
      });
    });

    it('triggers fallback timeout timer when xhr.ontimeout does not fire', async () => {
      jest.useFakeTimers();

      const promise = xhrAdapter({
        url: 'https://example.com/slow',
        headers: {},
        timeout: 200,
      });

      jest.advanceTimersByTime(250);

      await expect(promise).rejects.toMatchObject({
        code: 'ETIMEDOUT',
      });

      jest.useRealTimers();
    });

    it('respects existing Accept header without overriding', async () => {
      const config: AdapterRequest = {
        url: 'https://example.com/xml',
        headers: { Accept: 'application/xml', 'X-Custom': 'val' },
      };

      const promise = xhrAdapter(config);
      expect(mockXHR.setRequestHeader).toHaveBeenCalledWith('Accept', 'application/xml');
      expect(mockXHR.setRequestHeader).toHaveBeenCalledWith('X-Custom', 'val');
      expect(mockXHR.setRequestHeader).not.toHaveBeenCalledWith('Accept', 'application/json');

      mockXHR.onload();
      await promise;
    });

    it('handles text and arraybuffer responseType', async () => {
      mockXHR.response = 'plain text content';
      const textRes = await (async () => {
        const p = xhrAdapter({
          url: 'https://example.com/text',
          headers: {},
          responseType: 'text',
        });
        mockXHR.onload();
        return p;
      })();
      expect(textRes.data).toBe('plain text content');

      const buffer = new ArrayBuffer(8);
      mockXHR.response = buffer;
      const abRes = await (async () => {
        const p = xhrAdapter({
          url: 'https://example.com/ab',
          headers: {},
          responseType: 'arraybuffer',
        });
        mockXHR.onload();
        return p;
      })();
      expect(abRes.data).toBe(buffer);
    });

    it('falls back to xhr.responseText when xhr.response is undefined', async () => {
      mockXHR.response = undefined;
      mockXHR.responseText = '{"fromText":true}';

      const promise = xhrAdapter({
        url: 'https://example.com/compat',
        headers: {},
        responseType: 'json',
      });
      mockXHR.onload();
      const res = await promise;
      expect(res.data).toEqual({ fromText: true });
    });

    it('returns raw text if json parsing fails in xhr', async () => {
      mockXHR.response = 'not valid json string';
      const promise = xhrAdapter({
        url: 'https://example.com/badjson',
        headers: {},
        responseType: 'json',
      });
      mockXHR.onload();
      const res = await promise;
      expect(res.data).toBe('not valid json string');
    });

    it('does nothing when onload/onerror fires after request already settled', async () => {
      const controller = new AbortController();
      const promise = xhrAdapter({
        url: 'https://example.com/settle',
        headers: {},
        signal: controller.signal,
      });

      controller.abort();
      await expect(promise).rejects.toMatchObject({ code: 'ERR_CANCELED' });

      // Calling onload / onerror / ontimeout after settle should be no-op (line 87)
      expect(() => mockXHR.onload()).not.toThrow();
      expect(() => mockXHR.onerror()).not.toThrow();
      expect(() => mockXHR.ontimeout()).not.toThrow();
    });
  });
});
