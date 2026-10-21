import { Adapter, AdapterRequest, AdapterResponse } from '../types';
import { createError } from './registry';

/**
 * Fetch API transport adapter.
 *
 * Note: Upload progress is not supported by the Fetch API standard;
 * use the XHR adapter when upload progress tracking is needed.
 */
export const fetchAdapter: Adapter = async <T = any>(
  config: AdapterRequest
): Promise<AdapterResponse<T>> => {
  const fetchFn =
    config.fetch ||
    (typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch : undefined) ||
    (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function' ? globalThis.fetch : undefined) ||
    (typeof fetch === 'function' ? fetch : undefined);

  if (!fetchFn) {
    throw createError('Fetch API is not available in this environment', 'ERR_NO_ADAPTER', config);
  }

  const method = (config.method || 'GET').toUpperCase();
  const headers: Record<string, string> = { ...config.headers };

  const hasAccept = Object.keys(headers).some(k => k.toLowerCase() === 'accept');
  if (!hasAccept) {
    headers['Accept'] = 'application/json, text/plain, */*';
  }

  // Combine config.signal and AbortSignal.timeout(timeout) with AbortSignal.any().
  // Fall back to a manual AbortController if AbortSignal.any/timeout are unavailable.
  let signal: AbortSignal | undefined;
  let cleanup = () => {};
  let timedOut = false;

  const hasAbortSignalAny =
    typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).any === 'function';
  const hasAbortSignalTimeout =
    typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function';

  if (config.timeout && config.timeout > 0 && hasAbortSignalAny && hasAbortSignalTimeout) {
    const timeoutSignal = (AbortSignal as any).timeout(config.timeout);
    if (config.signal) {
      signal = (AbortSignal as any).any([config.signal, timeoutSignal]);
    } else {
      signal = timeoutSignal;
    }
  } else if (config.signal && !config.timeout) {
    signal = config.signal;
  } else if (config.timeout && config.timeout > 0) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    if (controller) {
      const timer = setTimeout(() => {
        timedOut = true;
        const timeoutError = new Error(`Request timeout after ${config.timeout}ms`);
        timeoutError.name = 'TimeoutError';
        try {
          (controller as any).abort(timeoutError);
        } catch {
          controller.abort();
        }
      }, config.timeout);

      const onExternalAbort = () => {
        controller.abort();
      };

      if (config.signal) {
        if (config.signal.aborted) {
          clearTimeout(timer);
          throw createError('Request aborted', 'ERR_CANCELED', config);
        }
        config.signal.addEventListener('abort', onExternalAbort);
      }

      cleanup = () => {
        clearTimeout(timer);
        if (config.signal) {
          config.signal.removeEventListener('abort', onExternalAbort);
        }
      };

      signal = controller.signal;
    }
  } else {
    signal = config.signal;
  }

  if (config.signal?.aborted) {
    cleanup();
    throw createError('Request aborted', 'ERR_CANCELED', config);
  }

  try {
    const isGetOrHead = method === 'GET' || method === 'HEAD';
    const body = isGetOrHead ? undefined : (config.data ?? undefined);

    const res = await fetchFn(config.url, {
      method,
      headers,
      body,
      signal,
      redirect: config.redirect || 'follow',
    });

    cleanup();

    let responseHeaders: Record<string, string> = {};
    if (res.headers) {
      if (typeof Object.fromEntries === 'function' && typeof (res.headers as any).entries === 'function') {
        const entries = Object.fromEntries((res.headers as any).entries());
        for (const [k, v] of Object.entries(entries)) {
          responseHeaders[k.toLowerCase()] = v as string;
        }
      } else if (typeof res.headers.forEach === 'function') {
        res.headers.forEach((value: string, key: string) => {
          responseHeaders[key.toLowerCase()] = value;
        });
      }
    }

    let responseData: any;
    const responseType = config.responseType || 'json';

    if (config.onDownloadProgress && res.body && typeof res.body.getReader === 'function') {
      const contentLengthHeader = res.headers ? (typeof res.headers.get === 'function' ? res.headers.get('content-length') : null) : null;
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
        responseData = decoder.decode(fullBuffer);
      }
    } else {
      if (res.status === 204 || method === 'HEAD') {
        responseData = null;
      } else if (responseType === 'arraybuffer') {
        responseData = await res.arrayBuffer();
      } else if (responseType === 'blob') {
        responseData = await res.blob();
      } else {
        // Read text and let core parse if json
        responseData = await res.text();
      }
    }

    return {
      data: responseData,
      status: res.status,
      statusText: res.statusText || '',
      headers: responseHeaders,
      request: res,
    };
  } catch (err: any) {
    cleanup();

    if (err?.isGrabError) {
      throw err;
    }

    const isTimeout =
      timedOut ||
      err?.name === 'TimeoutError' ||
      (signal?.reason as any)?.name === 'TimeoutError';

    if (isTimeout) {
      throw createError(`Request timeout after ${config.timeout}ms`, 'ETIMEDOUT', config);
    }

    const isAbort =
      err?.name === 'AbortError' ||
      config.signal?.aborted ||
      (signal?.aborted && !isTimeout);

    if (isAbort) {
      throw createError('Request aborted', 'ERR_CANCELED', config);
    }

    throw createError(err?.message || 'Network error occurred', 'ERR_NETWORK', config);
  }
};

export default fetchAdapter;
