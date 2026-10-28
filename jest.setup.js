const { TextEncoder, TextDecoder } = require('util');

if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder;
}
if (typeof window !== 'undefined' && typeof window.TextEncoder === 'undefined') {
  window.TextEncoder = TextEncoder;
}

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = TextDecoder;
}
if (typeof window !== 'undefined' && typeof window.TextDecoder === 'undefined') {
  window.TextDecoder = TextDecoder;
}

const vm = require('vm');
try {
  const nodeFetch = vm.runInThisContext('typeof fetch !== "undefined" ? fetch : undefined');
  const nodeHeaders = vm.runInThisContext('typeof Headers !== "undefined" ? Headers : undefined');
  const nodeRequest = vm.runInThisContext('typeof Request !== "undefined" ? Request : undefined');
  const nodeResponse = vm.runInThisContext('typeof Response !== "undefined" ? Response : undefined');

  const rootFetch = typeof globalThis.fetch !== 'undefined' ? globalThis.fetch : nodeFetch;
  if (rootFetch) {
    if (typeof globalThis.fetch === 'undefined') globalThis.fetch = rootFetch;
    if (typeof window !== 'undefined' && typeof window.fetch === 'undefined') window.fetch = rootFetch;
    if (typeof global !== 'undefined' && typeof global.fetch === 'undefined') global.fetch = rootFetch;
  }

  const rootHeaders = typeof globalThis.Headers !== 'undefined' ? globalThis.Headers : nodeHeaders;
  if (rootHeaders) {
    if (typeof globalThis.Headers === 'undefined') globalThis.Headers = rootHeaders;
    if (typeof window !== 'undefined' && typeof window.Headers === 'undefined') window.Headers = rootHeaders;
    if (typeof global !== 'undefined' && typeof global.Headers === 'undefined') global.Headers = rootHeaders;
  }

  const rootRequest = typeof globalThis.Request !== 'undefined' ? globalThis.Request : nodeRequest;
  if (rootRequest) {
    if (typeof globalThis.Request === 'undefined') globalThis.Request = rootRequest;
    if (typeof window !== 'undefined' && typeof window.Request === 'undefined') window.Request = rootRequest;
    if (typeof global !== 'undefined' && typeof global.Request === 'undefined') global.Request = rootRequest;
  }

  const rootResponse = typeof globalThis.Response !== 'undefined' ? globalThis.Response : nodeResponse;
  if (rootResponse) {
    if (typeof globalThis.Response === 'undefined') globalThis.Response = rootResponse;
    if (typeof window !== 'undefined' && typeof window.Response === 'undefined') window.Response = rootResponse;
    if (typeof global !== 'undefined' && typeof global.Response === 'undefined') global.Response = rootResponse;
  }
} catch {}
