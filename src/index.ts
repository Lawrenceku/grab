import { registerAdapter } from './adapters/registry';
import { fetchAdapter } from './adapters/fetch';
import { xhrAdapter } from './adapters/xhr';
import {
  grab,
  GrabInstance,
  isCancel,
  buildURL,
  dispatchRequest,
  defaultTransformRequest,
  defaultTransformResponse,
  InterceptorManagerImpl,
} from './core';

// Register browser/worker/edge transports
registerAdapter('fetch', fetchAdapter);
registerAdapter('xhr', xhrAdapter);

// Re-export types
export * from './types';

// Re-export adapters registry and browser-safe adapters
export {
  registerAdapter,
  resolveAdapter,
  createError,
  isAdapterAvailable,
  getRegisteredAdapter,
  clearRegistry,
} from './adapters/registry';
export { fetchAdapter } from './adapters/fetch';
export { xhrAdapter } from './adapters/xhr';

// Re-export core utilities and classes
export {
  grab,
  GrabInstance,
  isCancel,
  buildURL,
  dispatchRequest,
  defaultTransformRequest,
  defaultTransformResponse,
  InterceptorManagerImpl,
};

export default grab;