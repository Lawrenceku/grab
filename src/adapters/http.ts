import * as http from 'node:http';
import * as https from 'node:https';
import * as zlib from 'node:zlib';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { Adapter, AdapterRequest, AdapterResponse, GrabError } from '../types';
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
      headers['Accept'] = 'application/json, text/plain, */*';
    }

    const method = (config.method || 'GET').toUpperCase();

    const options: http.RequestOptions = {
      method,
      headers,
    };

    let settled = false;
    let timeoutId: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      if (config.signal) {
        config.signal.removeEventListener('abort', onAbort);
      }
    };

    const fail = (error: GrabError) => {
      if (settled) return;
      settled = true;
      cleanup();
      req.destroy();
      reject(error);
    };

    const finish = (response: AdapterResponse<T>) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(response);
    };

    const onAbort = () => {
      fail(createError('Request aborted', 'ERR_CANCELED', config, req));
    };

    if (config.signal) {
      if (config.signal.aborted) {
        return reject(createError('Request aborted', 'ERR_CANCELED', config));
      }
      config.signal.addEventListener('abort', onAbort);
    }

    const req = requestFn(urlObj, options, (res: http.IncomingMessage) => {
      const statusCode = res.statusCode || 0;

      // Redirect handling (301, 302, 303, 307, 308)
      if (
        config.redirect !== 'manual' &&
        config.maxRedirects !== 0 &&
        [301, 302, 303, 307, 308].includes(statusCode) &&
        res.headers.location
      ) {
        res.resume(); // drain response stream
        const maxRedirs = config.maxRedirects !== undefined ? config.maxRedirects : 5;
        if (redirectCount >= maxRedirs) {
          return fail(
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

        let nextMethod = method;
        let nextData = config.data;

        // Switch to GET and drop the body on 303, and on 301/302 when the method was POST
        if (statusCode === 303 || ((statusCode === 301 || statusCode === 302) && method === 'POST')) {
          nextMethod = 'GET';
          nextData = undefined;
        }

        const redirectedConfig: AdapterRequest = {
          ...config,
          url: redirectUrl,
          method: nextMethod as any,
          data: nextData,
        };

        resolve(executeHttpRequest(redirectedConfig, redirectCount + 1));
        return;
      }

      let stream: NodeJS.ReadableStream = res;
      const encoding = res.headers['content-encoding'];
      if (encoding === 'gzip' || encoding === 'deflate') {
        const unzip = zlib.createUnzip();
        unzip.on('error', (err: Error) => {
          fail(createError(`Decompression error: ${err.message}`, 'ERR_BAD_RESPONSE', config, req));
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
        const buffer = Buffer.concat(chunks);
        const responseType = config.responseType || 'json';
        let responseData: any;

        if (responseType === 'arraybuffer') {
          responseData = buffer;
        } else if (responseType === 'blob') {
          responseData = typeof Blob !== 'undefined' ? new Blob([buffer]) : buffer;
        } else {
          responseData = buffer.toString('utf8');
        }

        const normalizedHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(res.headers)) {
          if (val !== undefined) {
            normalizedHeaders[key.toLowerCase()] = Array.isArray(val) ? val.join(', ') : val;
          }
        }

        finish({
          data: responseData,
          status: res.statusCode || 0,
          statusText: res.statusMessage || '',
          headers: normalizedHeaders,
          request: req,
        });
      });
    });

    req.on('error', (err: Error) => {
      fail(createError(`Network error occurred: ${err.message}`, 'ERR_NETWORK', config, req));
    });

    // Total timeout via setTimeout (not idle socket timeout)
    if (config.timeout && config.timeout > 0) {
      timeoutId = setTimeout(() => {
        fail(createError(`Request timeout after ${config.timeout}ms`, 'ETIMEDOUT', config, req));
      }, config.timeout);
    }

    // Request body: if data has .pipe, pipe it to the request; otherwise req.end(data).
    // req.end() only accepts string | Buffer | Uint8Array — primitives like 0 or false must be
    // converted to string first; empty string is deliberately allowed (sends empty body).
    if (
      config.data !== undefined &&
      config.data !== null &&
      typeof (config.data as any).pipe === 'function'
    ) {
      (config.data as any).pipe(req);
    } else if (config.data !== undefined && config.data !== null) {
      const body =
        typeof config.data === 'string' ||
        Buffer.isBuffer(config.data) ||
        config.data instanceof Uint8Array
          ? config.data
          : String(config.data);
      req.end(body);
    } else {
      req.end();
    }
  });
}

export const httpAdapter: Adapter = <T = any>(
  config: AdapterRequest
): Promise<AdapterResponse<T>> => {
  return executeHttpRequest<T>(config, 0);
};

export default httpAdapter;
