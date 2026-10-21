import { Adapter, AdapterName, GrabError, RequestConfig, Response } from '../types';

const registry = new Map<AdapterName, Adapter>();

export function registerAdapter(name: AdapterName, adapter: Adapter): void {
  registry.set(name, adapter);
}

export function getRegisteredAdapter(name: AdapterName): Adapter | undefined {
  return registry.get(name);
}

export function clearRegistry(): void {
  registry.clear();
}

export function createError(
  message: string,
  code?: string,
  config?: RequestConfig,
  request?: any,
  response?: Response
): GrabError {
  const error = new Error(message) as GrabError;
  error.name = 'GrabError';
  if (code) error.code = code;
  if (config) error.config = config;
  if (request !== undefined) error.request = request;
  if (response !== undefined) {
    error.response = response;
    error.status = response.status;
  }
  error.isGrabError = true;
  error.isAxiosError = true;
  return error;
}

export function isAdapterAvailable(name: AdapterName): boolean {
  if (!registry.has(name)) return false;
  if (name === 'xhr') {
    return typeof XMLHttpRequest !== 'undefined';
  }
  if (name === 'fetch') {
    return (
      (typeof window !== 'undefined' && typeof window.fetch === 'function') ||
      (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') ||
      (typeof fetch === 'function')
    );
  }
  if (name === 'http') {
    return (
      typeof process !== 'undefined' &&
      process.versions != null &&
      process.versions.node != null
    );
  }
  return true;
}

export function resolveAdapter(
  configOrAdapter?: RequestConfig | Adapter | AdapterName | (Adapter | AdapterName)[],
  maybeConfig?: RequestConfig
): Adapter {
  if (typeof configOrAdapter === 'function') {
    return configOrAdapter;
  }

  let adapterOption: Adapter | AdapterName | (Adapter | AdapterName)[] | undefined;
  let config: RequestConfig | undefined;

  if (typeof configOrAdapter === 'string' || Array.isArray(configOrAdapter)) {
    adapterOption = configOrAdapter;
    config = maybeConfig;
  } else if (configOrAdapter && typeof configOrAdapter === 'object') {
    config = configOrAdapter;
    adapterOption = config.adapter;
  }

  if (typeof adapterOption === 'function') {
    return adapterOption;
  }

  if (typeof adapterOption === 'string') {
    const adapter = registry.get(adapterOption);
    if (!adapter) {
      throw createError(`Adapter "${adapterOption}" is not registered`, 'ERR_NO_ADAPTER', config);
    }
    return adapter;
  }

  if (Array.isArray(adapterOption)) {
    for (const item of adapterOption) {
      if (typeof item === 'function') {
        return item;
      }
      if (typeof item === 'string' && isAdapterAvailable(item)) {
        return registry.get(item)!;
      }
    }
    throw createError('None of the requested adapters are available', 'ERR_NO_ADAPTER', config);
  }

  // Default resolution
  // Fallback to XHR if upload progress tracking is requested and XHR is available
  if (config?.onUploadProgress && isAdapterAvailable('xhr')) {
    return registry.get('xhr')!;
  }

  // In Node environment, use http adapter if registered and available
  const isNode =
    typeof window === 'undefined' &&
    typeof process !== 'undefined' &&
    process.versions != null &&
    process.versions.node != null;

  if (isNode && isAdapterAvailable('http')) {
    return registry.get('http')!;
  }

  // Primary transport: fetch
  if (isAdapterAvailable('fetch')) {
    return registry.get('fetch')!;
  }

  // Fallback: xhr
  if (isAdapterAvailable('xhr')) {
    return registry.get('xhr')!;
  }

  // Fallback: http if registered
  if (registry.has('http')) {
    return registry.get('http')!;
  }

  // Fallback: fetch if registered
  if (registry.has('fetch')) {
    return registry.get('fetch')!;
  }

  throw createError('No adapter available for this environment', 'ERR_NO_ADAPTER', config);
}
