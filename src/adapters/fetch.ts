import { Adapter, AdapterRequest, AdapterResponse } from '../types';
import { createError } from './registry';

export const fetchAdapter: Adapter = async <T = any>(
  config: AdapterRequest
): Promise<AdapterResponse<T>> => {
  const fetchFn =
    typeof window !== 'undefined' && typeof window.fetch === 'function'
      ? window.fetch
      : typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
        ? globalThis.fetch
        : typeof fetch === 'function'
          ? fetch
          : undefined;

  if (!fetchFn) {
    throw createError('Fetch API is not available in this environment', 'ERR_NO_ADAPTER', config);
  }

  const method = (config.method || 'GET').toUpperCase();
  const headers: Record<string, string> = { ...config.headers };

  const hasAccept = Object.keys(headers).some(k => k.toLowerCase() === 'accept');
  if (!hasAccept) {
    headers['Accept'] = 'application/json';
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  let timedOut = false;
  let timeoutId: any;

  if (config.timeout && config.timeout > 0 && controller) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, config.timeout);
  }

  const onExternalAbort = () => {
    if (controller) {
      controller.abort();
    }
  };

  if (config.signal) {
    if (config.signal.aborted) {
      if (timeoutId) clearTimeout(timeoutId);
      throw createError('Request aborted', 'ERR_CANCELED', config);
    }
    config.signal.addEventListener('abort', onExternalAbort);
  }

  const cleanup = () => {
    if (timeoutId) clearTimeout(timeoutId);
    if (config.signal) {
      config.signal.removeEventListener('abort', onExternalAbort);
    }
  };

  try {
    const isGetOrHead = method === 'GET' || method === 'HEAD';
    const body = isGetOrHead ? undefined : (config.data ?? undefined);

    const res = await fetchFn(config.url, {
      method,
      headers,
      body,
      signal: controller ? controller.signal : config.signal,
    });

    cleanup();

    const responseHeaders: Record<string, string> = {};
    if (res.headers && typeof res.headers.forEach === 'function') {
      res.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });
    }

    let responseData: any;
    const responseType = config.responseType || 'json';

    if (config.onDownloadProgress && res.body && typeof res.body.getReader === 'function') {
      const contentLengthHeader = res.headers ? res.headers.get('content-length') : null;
      const total = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
      let loaded = 0;
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loaded += value.length;
          config.onDownloadProgress({
            loaded,
            total,
            lengthComputable: total > 0,
          });
        }
      }

      const fullBuffer = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        fullBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      if (responseType === 'arraybuffer') {
        responseData = fullBuffer.buffer;
      } else if (responseType === 'blob') {
        responseData = typeof Blob !== 'undefined' ? new Blob([fullBuffer]) : fullBuffer;
      } else {
        const decoder = new TextDecoder();
        const text = decoder.decode(fullBuffer);
        if (responseType === 'json') {
          try {
            responseData = text ? JSON.parse(text) : null;
          } catch {
            responseData = text;
          }
        } else {
          responseData = text;
        }
      }
    } else {
      if (res.status === 204 || method === 'HEAD') {
        responseData = null;
      } else if (responseType === 'arraybuffer') {
        responseData = await res.arrayBuffer();
      } else if (responseType === 'blob') {
        responseData = await res.blob();
      } else if (responseType === 'text') {
        responseData = await res.text();
      } else {
        const text = await res.text();
        try {
          responseData = text ? JSON.parse(text) : null;
        } catch {
          responseData = text;
        }
      }
    }

    return {
      data: responseData,
      status: res.status,
      statusText: res.statusText || '',
      headers: responseHeaders,
      request: config,
    };
  } catch (err: any) {
    cleanup();

    if (timedOut) {
      throw createError(`Request timeout after ${config.timeout}ms`, 'ETIMEDOUT', config);
    }
    if (config.signal?.aborted || err?.name === 'AbortError') {
      throw createError('Request aborted', 'ERR_CANCELED', config);
    }
    if (err?.isGrabError) {
      throw err;
    }
    throw createError(err?.message || 'Network error occurred', 'ERR_NETWORK', config);
  }
};

export default fetchAdapter;
