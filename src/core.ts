import {
  AdapterRequest,
  Interceptor,
  InterceptorManager,
  RequestConfig,
  Response,
} from './types';
import { createError, resolveAdapter } from './adapters/registry';

export function buildURL(url?: string, baseURL?: string, params?: Record<string, any>): string {
  let finalUrl = url || '';
  if (baseURL && url && !/^https?:\/\//i.test(url)) {
    finalUrl = baseURL.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '');
  } else if (baseURL && !url) {
    finalUrl = baseURL;
  }

  if (params) {
    const searchParams = new URLSearchParams();
    const buildParams = (obj: any, prefix?: string) => {
      if (obj === null || obj === undefined) return;
      if (typeof obj === 'object') {
        if (Array.isArray(obj)) {
          obj.forEach(v => buildParams(v, prefix ? `${prefix}[]` : ''));
        } else if (obj instanceof Date) {
          searchParams.append(prefix!, obj.toISOString());
        } else {
          Object.keys(obj).forEach(k =>
            buildParams(obj[k], prefix ? `${prefix}[${k}]` : k)
          );
        }
      } else {
        searchParams.append(prefix!, String(obj));
      }
    };
    buildParams(params);
    const query = searchParams.toString();
    if (query) {
      finalUrl += `${finalUrl.includes('?') ? '&' : '?'}${query}`;
    }
  }

  return finalUrl;
}

export function defaultTransformRequest(data: any, headers: Record<string, string>): any {
  if (typeof data === 'object' && data !== null) {
    if (
      (typeof FormData !== 'undefined' && data instanceof FormData) ||
      (typeof Blob !== 'undefined' && data instanceof Blob) ||
      (typeof ArrayBuffer !== 'undefined' &&
        (data instanceof ArrayBuffer || ArrayBuffer.isView(data))) ||
      (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) ||
      typeof (data as any).pipe === 'function'
    ) {
      return data;
    }
    const hasContentType = Object.keys(headers).some(
      k => k.toLowerCase() === 'content-type'
    );
    if (!hasContentType) {
      headers['Content-Type'] = 'application/json';
    }
    return JSON.stringify(data);
  }
  return data;
}

export function defaultTransformResponse(data: any): any {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
}

export class InterceptorManagerImpl<V> implements InterceptorManager<V> {
  private handlers: (Interceptor<V> | null)[] = [];

  use(fulfilled?: (value: V) => V | Promise<V>, rejected?: (error: any) => any): number {
    this.handlers.push({ fulfilled, rejected });
    return this.handlers.length - 1;
  }

  eject(id: number): void {
    if (this.handlers[id]) {
      this.handlers[id] = null;
    }
  }

  forEach(fn: (interceptor: Interceptor<V>) => void): void {
    this.handlers.forEach(handler => {
      if (handler !== null && (handler.fulfilled || handler.rejected)) {
        fn(handler);
      }
    });
  }

  getHandlers(): Interceptor<V>[] {
    return this.handlers.filter((h): h is Interceptor<V> => h !== null);
  }
}

export function isCancel(value: any): boolean {
  return Boolean(value && (value.code === 'ERR_CANCELED' || value.code === 'ABORTED'));
}

export async function dispatchRequest<T = any>(config: RequestConfig): Promise<Response<T>> {
  const { url, baseURL, params, data, body, headers = {}, transformRequest, transformResponse } = config;

  const finalUrl = buildURL(url, baseURL, params);
  const normalizedHeaders: Record<string, string> = { ...headers };

  const rawData = data ?? body;
  let transformedData = rawData;
  const reqTransforms = transformRequest || [defaultTransformRequest];
  for (const transform of reqTransforms) {
    transformedData = transform(transformedData, normalizedHeaders);
  }

  const adapter = resolveAdapter(config);
  const adapterRequest: AdapterRequest = {
    ...config,
    url: finalUrl,
    headers: normalizedHeaders,
    data: transformedData,
  };

  const adapterResponse = await adapter(adapterRequest);

  const response: Response<T> = {
    data: adapterResponse.data,
    status: adapterResponse.status,
    statusText: adapterResponse.statusText,
    headers: adapterResponse.headers,
    config,
    request: adapterResponse.request,
  };

  const validateStatus =
    config.validateStatus || ((status: number) => status >= 200 && status < 300);
  if (!validateStatus(response.status)) {
    throw createError(
      `Request failed with status: ${response.status}`,
      'ERR_BAD_RESPONSE',
      config,
      adapterResponse.request,
      response
    );
  }

  let responseData = response.data;
  const resTransforms = transformResponse || [defaultTransformResponse];
  for (const transform of resTransforms) {
    responseData = transform(responseData);
  }
  response.data = responseData;

  return response;
}

export class GrabInstance {
  public defaults: RequestConfig;
  private requestInterceptors: InterceptorManagerImpl<RequestConfig>;
  private responseInterceptors: InterceptorManagerImpl<Response>;

  constructor(config: RequestConfig = {}) {
    this.defaults = {
      timeout: 60000,
      responseType: 'json',
      validateStatus: (status: number) => status >= 200 && status < 300,
      transformRequest: [defaultTransformRequest],
      transformResponse: [defaultTransformResponse],
      ...config,
    };
    this.requestInterceptors = new InterceptorManagerImpl<RequestConfig>();
    this.responseInterceptors = new InterceptorManagerImpl<Response>();
  }

  private mergeConfig(config: RequestConfig): RequestConfig {
    return {
      ...this.defaults,
      ...config,
      headers: { ...this.defaults.headers, ...config.headers },
    };
  }

  async request<T = any>(config: RequestConfig): Promise<Response<T>> {
    const mergedConfig = this.mergeConfig(config);

    let promise: Promise<any> = Promise.resolve(mergedConfig);

    for (const handler of this.requestInterceptors.getHandlers()) {
      if (handler.fulfilled || handler.rejected) {
        promise = promise.then(handler.fulfilled, handler.rejected);
      }
    }

    promise = promise.then(cfg => dispatchRequest<T>(cfg));

    for (const handler of this.responseInterceptors.getHandlers()) {
      if (handler.fulfilled || handler.rejected) {
        promise = promise.then(handler.fulfilled, handler.rejected);
      }
    }

    return promise;
  }

  get<T = any>(url: string, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<Response<T>> {
    return this.request<T>({ ...config, url, method: 'GET' });
  }

  post<T = any>(
    url: string,
    data?: any,
    config?: Omit<RequestConfig, 'url' | 'method' | 'data'>
  ): Promise<Response<T>> {
    return this.request<T>({ ...config, url, method: 'POST', data });
  }

  put<T = any>(
    url: string,
    data?: any,
    config?: Omit<RequestConfig, 'url' | 'method' | 'data'>
  ): Promise<Response<T>> {
    return this.request<T>({ ...config, url, method: 'PUT', data });
  }

  delete<T = any>(url: string, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<Response<T>> {
    return this.request<T>({ ...config, url, method: 'DELETE' });
  }

  patch<T = any>(
    url: string,
    data?: any,
    config?: Omit<RequestConfig, 'url' | 'method' | 'data'>
  ): Promise<Response<T>> {
    return this.request<T>({ ...config, url, method: 'PATCH', data });
  }

  head<T = any>(url: string, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<Response<T>> {
    return this.request<T>({ ...config, url, method: 'HEAD' });
  }

  options<T = any>(url: string, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<Response<T>> {
    return this.request<T>({ ...config, url, method: 'OPTIONS' });
  }

  get interceptors() {
    return {
      request: this.requestInterceptors,
      response: this.responseInterceptors,
    };
  }

  static create(config?: RequestConfig): GrabInstance {
    return new GrabInstance(config);
  }

  static isCancel(value: any): boolean {
    return isCancel(value);
  }
}

export const grab = new GrabInstance();

export default grab;
