import { Adapter, AdapterRequest, AdapterResponse } from '../types';
import { createError } from './registry';

export function parseHeaders(headersString: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!headersString) return headers;
  const pairs = headersString.trim().split(/[\r\n]+/);
  pairs.forEach(pair => {
    const index = pair.indexOf(':');
    if (index > -1) {
      const key = pair.substring(0, index).trim().toLowerCase();
      const value = pair.substring(index + 1).trim();
      if (key) {
        headers[key] = value;
      }
    }
  });
  return headers;
}

export const xhrAdapter: Adapter = <T = any>(
  config: AdapterRequest
): Promise<AdapterResponse<T>> => {
  return new Promise<AdapterResponse<T>>((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') {
      return reject(
        createError('XMLHttpRequest is not available in this environment', 'ERR_NO_ADAPTER', config)
      );
    }

    const xhr = new XMLHttpRequest();
    const method = (config.method || 'GET').toUpperCase();
    xhr.open(method, config.url, true);

    const responseType = config.responseType || 'json';
    if (responseType === 'json' || responseType === 'text' || responseType === 'arraybuffer' || responseType === 'blob') {
      try {
        xhr.responseType = responseType as any;
      } catch {
        // Some older engines or jsdom might fail for certain responseTypes
      }
    }

    const headers = { ...config.headers };
    const hasAccept = Object.keys(headers).some(k => k.toLowerCase() === 'accept');
    if (!hasAccept) {
      xhr.setRequestHeader('Accept', 'application/json');
    }

    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    if (config.onUploadProgress && xhr.upload) {
      xhr.upload.onprogress = config.onUploadProgress;
    }
    if (config.onDownloadProgress) {
      xhr.onprogress = config.onDownloadProgress;
    }

    let timeoutId: any;
    let settled = false;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (config.signal) {
        config.signal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      xhr.abort();
      reject(createError('Request aborted', 'ERR_CANCELED', config, xhr));
    };

    if (config.signal) {
      if (config.signal.aborted) {
        return reject(createError('Request aborted', 'ERR_CANCELED', config, xhr));
      }
      config.signal.addEventListener('abort', onAbort);
    }

    xhr.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();

      let responseData: any = xhr.response !== undefined ? xhr.response : xhr.responseText;
      if (responseType === 'json' && typeof responseData === 'string') {
        try {
          responseData = responseData ? JSON.parse(responseData) : null;
        } catch {
          // Keep raw string if JSON parsing fails
        }
      }

      resolve({
        data: responseData,
        status: xhr.status,
        statusText: xhr.statusText || '',
        headers: parseHeaders(xhr.getAllResponseHeaders()),
        request: xhr,
      });
    };

    xhr.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(createError('Network error occurred', 'ERR_NETWORK', config, xhr));
    };

    xhr.ontimeout = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(createError(`Request timeout after ${config.timeout}ms`, 'ETIMEDOUT', config, xhr));
    };

    if (config.timeout && config.timeout > 0) {
      xhr.timeout = config.timeout;
      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        xhr.abort();
        reject(createError(`Request timeout after ${config.timeout}ms`, 'ETIMEDOUT', config, xhr));
      }, config.timeout);
    }

    try {
      xhr.send(config.data ?? null);
    } catch (err: any) {
      cleanup();
      reject(createError(err?.message || 'Network error occurred', 'ERR_NETWORK', config, xhr));
    }
  });
};

export default xhrAdapter;
