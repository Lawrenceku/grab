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

if (typeof globalThis.fetch !== 'undefined') {
  if (typeof window !== 'undefined' && typeof window.fetch === 'undefined') {
    window.fetch = globalThis.fetch;
  }
  if (typeof global !== 'undefined' && typeof global.fetch === 'undefined') {
    global.fetch = globalThis.fetch;
  }
}
if (typeof globalThis.Headers !== 'undefined') {
  if (typeof window !== 'undefined' && typeof window.Headers === 'undefined') {
    window.Headers = globalThis.Headers;
  }
  if (typeof global !== 'undefined' && typeof global.Headers === 'undefined') {
    global.Headers = globalThis.Headers;
  }
}
if (typeof globalThis.Request !== 'undefined') {
  if (typeof window !== 'undefined' && typeof window.Request === 'undefined') {
    window.Request = globalThis.Request;
  }
  if (typeof global !== 'undefined' && typeof global.Request === 'undefined') {
    global.Request = globalThis.Request;
  }
}
if (typeof globalThis.Response !== 'undefined') {
  if (typeof window !== 'undefined' && typeof window.Response === 'undefined') {
    window.Response = globalThis.Response;
  }
  if (typeof global !== 'undefined' && typeof global.Response === 'undefined') {
    global.Response = globalThis.Response;
  }
}
