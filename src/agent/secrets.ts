import { InstanceAuth } from './types';
import { createError } from '../adapters/registry';

/** Headers considered sensitive and always redacted in output. */
const SENSITIVE_HEADERS = [
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'proxy-authorization',
];

/** Registered secret values collected during runtime/config resolution. */
const registeredSecrets = new Set<string>();

/**
 * Register a secret value to be scrubbed by value across headers,
 * response bodies, and error messages.
 *
 * Automatically also registers the base64-encoded and URL-encoded forms
 * of the secret so encoded variants are caught in API responses, error
 * messages, query strings, and logs.
 */
export function registerSecret(value: string): void {
  if (value && typeof value === 'string' && value.trim().length >= 2) {
    const trimmed = value.trim();
    registeredSecrets.add(trimmed);

    // Also register base64-encoded form (covers Basic auth, encoded payloads)
    const b64 = Buffer.from(trimmed).toString('base64');
    if (b64.length >= 4) {
      registeredSecrets.add(b64);
    }

    // Also register URL-encoded form (covers query strings, form bodies)
    const urlEncoded = encodeURIComponent(trimmed);
    if (urlEncoded !== trimmed && urlEncoded.length >= 4) {
      registeredSecrets.add(urlEncoded);
    }
  }
}

/** Clear registered secrets (for testing). */
export function clearRegisteredSecrets(): void {
  registeredSecrets.clear();
}

/** Get registered secrets. */
export function getRegisteredSecrets(): Set<string> {
  return new Set(registeredSecrets);
}

/**
 * Resolve an InstanceAuth config into request headers.
 * Reads the secret from the named environment variable — never from
 * a stored value. Throws ERR_AUTH if the env var is not set.
 * Automatically registers the secret value for redaction.
 */
export function resolveAuth(auth: InstanceAuth): Record<string, string> {
  const value = process.env[auth.env];
  if (!value) {
    throw createError(
      `Environment variable "${auth.env}" is not set. ` +
      `Set it before making requests with this instance.`,
      'ERR_AUTH'
    );
  }

  registerSecret(value);

  switch (auth.type) {
    case 'bearer':
      return { Authorization: `Bearer ${value}` };

    case 'basic': {
      // Value should be "user:pass" — we base64-encode it
      const encoded = Buffer.from(value).toString('base64');
      registerSecret(encoded);
      return { Authorization: `Basic ${encoded}` };
    }

    case 'header': {
      const headerName = auth.headerName || 'X-API-Key';
      return { [headerName]: value };
    }

    default:
      throw createError(`Unknown auth type: ${(auth as any).type}`, 'ERR_AUTH');
  }
}

/**
 * Resolve static headers, expanding any `{ env: 'VAR_NAME' }` values
 * from the environment and registering them as secrets to redact.
 */
export function resolveStaticHeaders(
  headers?: Record<string, string | { env: string }>
): Record<string, string> {
  if (!headers) return {};

  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'object' && value !== null && 'env' in value) {
      const envName = (value as { env: string }).env;
      const secret = process.env[envName];
      if (!secret) {
        throw createError(
          `Environment variable "${envName}" for header "${key}" is not set.`,
          'ERR_AUTH'
        );
      }
      registerSecret(secret);
      resolved[key] = secret;
    } else if (typeof value === 'string') {
      resolved[key] = value;
    } else {
      resolved[key] = String(value);
    }
  }
  return resolved;
}

/**
 * Return a copy of headers with sensitive values replaced by [REDACTED].
 * Redacts by header name AND by matching secret values.
 * The original headers object is never mutated.
 */
export function redactHeaders(
  headers: Record<string, string>,
  extraSecrets?: Iterable<string>
): Record<string, string> {
  if (!headers) return {};

  const secrets = new Set<string>(registeredSecrets);
  if (extraSecrets) {
    for (const s of extraSecrets) {
      if (s) secrets.add(s);
    }
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
      result[key] = '[REDACTED]';
      continue;
    }

    let isSecret = false;
    for (const secret of secrets) {
      if (secret && typeof value === 'string' && value.includes(secret)) {
        isSecret = true;
        break;
      }
    }

    if (isSecret) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Scrub known secret values from an arbitrary string.
 */
export function redactString(msg: string, extraSecrets?: Iterable<string>): string {
  if (!msg || typeof msg !== 'string') return msg;

  let text = msg;

  // Scrub known registered secret values
  const secrets = new Set<string>(registeredSecrets);
  if (extraSecrets) {
    for (const s of extraSecrets) {
      if (s) secrets.add(s);
    }
  }

  for (const secret of secrets) {
    if (secret) {
      text = text.split(secret).join('[REDACTED]');
    }
  }

  // Generic scrubbing for tokens echoed in standard formats
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/Basic\s+\S+/gi, 'Basic [REDACTED]')
    .replace(/token[=:]\s*\S+/gi, 'token=[REDACTED]')
    .replace(/key[=:]\s*\S+/gi, 'key=[REDACTED]');
}

/**
 * Recursively scrub secret values from an object, array, or primitive.
 * Safe for JSON objects, strings, numbers, etc.
 */
export function scrubSecrets(data: any, extraSecrets?: Iterable<string>): any {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    return redactString(data, extraSecrets);
  }

  if (Array.isArray(data)) {
    return data.map(item => scrubSecrets(item, extraSecrets));
  }

  if (typeof data === 'object') {
    // Buffers or Blobs: do not attempt to traverse
    if (Buffer.isBuffer(data) || (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer)) {
      return data;
    }

    const cleaned: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
        cleaned[key] = '[REDACTED]';
      } else {
        cleaned[key] = scrubSecrets(val, extraSecrets);
      }
    }
    return cleaned;
  }

  return data;
}

/**
 * Redact sensitive data from an error before returning it to the agent.
 * Strips auth headers from config.headers, scrubs response body and headers,
 * and scrubs error messages.
 */
export function redactError(error: any, extraSecrets?: Iterable<string>): any {
  if (!error) return error;

  // Clone the error to avoid mutating the original
  const clean: any = new Error(redactString(error.message || '', extraSecrets));
  clean.name = error.name || 'GrabError';
  clean.code = error.code;
  clean.status = error.status;
  clean.isGrabError = error.isGrabError;

  if (error.stack) {
    clean.stack = redactString(error.stack, extraSecrets);
  }

  if (error.config) {
    clean.config = {
      ...error.config,
      headers: error.config.headers ? redactHeaders(error.config.headers, extraSecrets) : {},
      data: scrubSecrets(error.config.data ?? error.config.body, extraSecrets),
    };
  }

  if (error.response) {
    clean.response = {
      ...error.response,
      headers: error.response.headers ? redactHeaders(error.response.headers, extraSecrets) : {},
      data: scrubSecrets(error.response.data, extraSecrets),
      config: error.response.config
        ? {
            ...error.response.config,
            headers: error.response.config.headers
              ? redactHeaders(error.response.config.headers, extraSecrets)
              : {},
            data: scrubSecrets(
              error.response.config.data ?? error.response.config.body,
              extraSecrets
            ),
          }
        : undefined,
    };
  }

  return clean;
}
