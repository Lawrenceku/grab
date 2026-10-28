export type HttpMethods =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'PATCH'
  | 'OPTIONS'
  | 'HEAD'
  | 'CONNECT'
  | 'TRACE';

export type ResponseType = 'json' | 'text' | 'arraybuffer' | 'blob';

export type AdapterName = 'fetch' | 'xhr' | 'http';

export interface AdapterRequest extends RequestConfig {
  url: string;
  headers: Record<string, string>;
  data?: any;
}

export interface AdapterResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  request?: any;
}

export type Adapter = (config: AdapterRequest) => Promise<AdapterResponse>;

export interface RequestConfig {
  url?: string;
  method?: HttpMethods;
  baseURL?: string;
  params?: Record<string, any>;
  data?: any;
  body?: any; // Alias for data
  headers?: Record<string, string>;
  timeout?: number;
  responseType?: ResponseType;
  signal?: AbortSignal;
  onUploadProgress?: (progressEvent: any) => void;
  onDownloadProgress?: (progressEvent: any) => void;
  validateStatus?: (status: number) => boolean;
  transformRequest?: ((data: any, headers: Record<string, string>) => any)[];
  transformResponse?: ((data: any) => any)[];
  adapter?: Adapter | AdapterName | (Adapter | AdapterName)[];
  fetch?: any;
  redirect?: 'follow' | 'manual' | 'error';
  maxRedirects?: number;
}

export interface Response<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  config: RequestConfig;
  request?: any;
}

export interface GrabError extends Error {
  config?: RequestConfig;
  code?: string;
  request?: any;
  response?: Response;
  status?: number;
  isGrabError?: boolean;
  isAxiosError?: boolean;
}

export interface Interceptor<V> {
  fulfilled?: (value: V) => V | Promise<V>;
  rejected?: (error: any) => any;
}

export interface InterceptorManager<V> {
  use(fulfilled?: (value: V) => V | Promise<V>, rejected?: (error: any) => any): number;
  eject(id: number): void;
  forEach(fn: (interceptor: Interceptor<V>) => void): void;
}
