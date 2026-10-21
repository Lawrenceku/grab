import * as http from 'node:http';
import * as https from 'node:https';
import * as zlib from 'node:zlib';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { Adapter, AdapterRequest, AdapterResponse } from '../types';
import { createError } from './registry';

function executeHttpRequest<T = any>(
  config: AdapterRequest,
  redirectCount: number = 0
): Promise<AdapterResponse<T>> {
  return new Promise<AdapterResponse<T>>((resolve, reject) => {
    let urlObj: URL;
    try {
      urlObj = new URL(config.url);
    } catch {
      return reject(createError(`Invalid URL: ${config.url}`, 'ERR_NETWORK', config));
    }

    const isHttps = urlObj.protocol === 'https:';
    const requestFn = isHttps ? https.request : http.request;

    const headers: Record<string, string> = { ...config.headers };

    const hasAcceptEncoding = Object.keys(headers).some(
      k => k.toLowerCase() === 'accept-encoding'
    );
    if (!hasAcceptEncoding) {
      headers['Accept-Encoding'] = 'gzip, deflate';
    }

    const hasAccept = Object.keys(headers).some(k => k.toLowerCase() === 'accept');
    if (!hasAccept) {
      headers['Accept'] = 'application/json';
    }

    const method = (config.method || 'GET').toUpperCase();

    const options: http.RequestOptions = {
      method,
      headers,
    };

    let settled = false;
    let timeoutId: any;

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
      req.destroy();
      reject(createError('Request aborted', 'ERR_CANCELED', config, req));
    };

    if (config.signal) {
      if (config.signal.aborted) {
        return reject(createError('Request aborted', 'ERR_CANCELED', config));
      }
      config.signal.addEventListener('abort', onAbort);
    }

    const req = requestFn(urlObj, options, (res: http.IncomingMessage) => {
      // Redirect handling
      const statusCode = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
        if (redirectCount >= 5) {
          settled = true;
          cleanup();
          req.destroy();
          return reject(
            createError('Too many redirects', 'ERR_TOO_MANY_REDIRECTS', config, req)
          );
        }

        settled = true;
        cleanup();
        req.destroy();

        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http:') && !redirectUrl.startsWith('https:')) {
          redirectUrl = new URL(redirectUrl, config.url).toString();
        }

        const nextMethod =
          [301, 302, 303].includes(statusCode) && method !== 'GET' && method !== 'HEAD'
            ? 'GET'
            : method;
        const nextData = nextMethod === 'GET' ? undefined : config.data;

        const redirectedConfig: AdapterRequest = {
          ...config,
          url: redirectUrl,
          method: nextMethod as any,
          data: nextData,
        };

        resolve(executeHttpRequest(redirectedConfig, redirectCount + 1));
        return;
      }

      let stream: any = res;
      const encoding = res.headers['content-encoding'];
      if (encoding === 'gzip' || encoding === 'deflate') {
        const unzip = zlib.createUnzip();
        unzip.on('error', (err: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          req.destroy();
          reject(
            createError(`Decompression error: ${err.message}`, 'ERR_BAD_RESPONSE', config, req)
          );
        });
        stream = res.pipe(unzip);
      }

      const chunks: Buffer[] = [];
      let loaded = 0;
      const totalHeader = res.headers['content-length'];
      const total = totalHeader ? parseInt(totalHeader, 10) : 0;

      stream.on('data', (chunk: any) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(buffer);
        loaded += buffer.length;
        if (config.onDownloadProgress) {
          config.onDownloadProgress({
            loaded,
            total,
            lengthComputable: total > 0,
          });
        }
      });

      stream.on('end', () => {
        if (settled) return;
        settled = true;
        cleanup();

        const buffer = Buffer.concat(chunks);
        const responseType = config.responseType || 'json';
        let responseData: any;

        if (responseType === 'arraybuffer') {
          const ab = new ArrayBuffer(buffer.byteLength);
          const view = new Uint8Array(ab);
          view.set(buffer);
          responseData = ab;
        } else if (responseType === 'blob') {
          responseData = typeof Blob !== 'undefined' ? new Blob([buffer]) : buffer;
        } else if (responseType === 'text') {
          responseData = buffer.toString('utf8');
        } else {
          const text = buffer.toString('utf8');
          try {
            responseData = text ? JSON.parse(text) : null;
          } catch {
            responseData = text;
          }
        }

        const normalizedHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(res.headers)) {
          if (val !== undefined) {
            normalizedHeaders[key.toLowerCase()] = Array.isArray(val) ? val.join(', ') : val;
          }
        }

        resolve({
          data: responseData,
          status: res.statusCode || 0,
          statusText: res.statusMessage || '',
          headers: normalizedHeaders,
          request: req,
        });
      });
    });

    req.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        createError(`Network error occurred: ${err.message}`, 'ERR_NETWORK', config, req)
      );
    });

    if (config.timeout && config.timeout > 0) {
      req.setTimeout(config.timeout, () => {
        if (settled) return;
        settled = true;
        cleanup();
        req.destroy();
        reject(
          createError(`Request timeout after ${config.timeout}ms`, 'ETIMEDOUT', config, req)
        );
      });

      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        req.destroy();
        reject(
          createError(`Request timeout after ${config.timeout}ms`, 'ETIMEDOUT', config, req)
        );
      }, config.timeout);
    }

    if (config.data) {
      if (Buffer.isBuffer(config.data)) {
        req.write(config.data);
      } else if (typeof config.data === 'string') {
        req.write(config.data);
      } else if (typeof config.data.pipe === 'function') {
        config.data.pipe(req);
        return;
      } else {
        req.write(String(config.data));
      }
    }

    req.end();
  });
}

export const httpAdapter: Adapter = <T = any>(
  config: AdapterRequest
): Promise<AdapterResponse<T>> => {
  return executeHttpRequest<T>(config, 0);
};

export default httpAdapter;
