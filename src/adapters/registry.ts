import { Adapter, GrabError, RequestConfig, Response } from '../types';

const registry = new Map<string, Adapter>();

export function registerAdapter(name: string, adapter: Adapter): void {
  registry.set(name, adapter);
}

export function getRegisteredAdapter(name: string): Adapter | undefined {
  return registry.get(name);
}

export function clearRegistry(): void {
  registry.clear();
}

export function isAdapterAvailable(name: string): boolean {
  return registry.has(name);
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

export function resolveAdapter(
  input: Adapter | string | (Adapter | string)[] | RequestConfig = ['http', 'fetch', 'xhr'],
  config?: RequestConfig
): Adapter {
  if (typeof input === 'function') {
    return input;
  }

  let effectiveConfig = config;
  let targets: (Adapter | string)[];

  if (input && typeof input === 'object' && !Array.isArray(input)) {
    effectiveConfig = input as RequestConfig;
    if (typeof effectiveConfig.adapter === 'function') {
      return effectiveConfig.adapter;
    }
    if (effectiveConfig.adapter) {
      targets = Array.isArray(effectiveConfig.adapter)
        ? effectiveConfig.adapter
        : [effectiveConfig.adapter];
    } else {
      if (effectiveConfig.onUploadProgress && registry.has('xhr')) {
        return registry.get('xhr')!;
      }
      targets = ['http', 'fetch', 'xhr'];
    }
  } else {
    if (
      effectiveConfig?.onUploadProgress &&
      (input === undefined ||
        (Array.isArray(input) &&
          input.length === 3 &&
          input[0] === 'http' &&
          input[1] === 'fetch' &&
          input[2] === 'xhr')) &&
      registry.has('xhr')
    ) {
      return registry.get('xhr')!;
    }
    targets = Array.isArray(input) ? input : [input as Adapter | string];
  }

  for (const item of targets) {
    if (typeof item === 'function') {
      return item;
    }
    if (typeof item === 'string' && registry.has(item)) {
      return registry.get(item)!;
    }
  }

  throw createError('No supported adapter available', 'ERR_NO_ADAPTER', effectiveConfig);
}
