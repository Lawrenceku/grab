import { InstanceAuth } from './types';
import { createError } from '../adapters/registry';

/** Headers considered sensitive and always redacted in output. */
const SENSITIVE_HEADERS = ['authorization', 'x-api-key', 'cookie', 'set-cookie', 'proxy-authorization'];

/**
 * Resolve an InstanceAuth config into request headers.
 * Reads the secret from the named environment variable — never from
 * a stored value. Throws ERR_AUTH if the env var is not set.
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

  switch (auth.type) {
    case 'bearer':
      return { Authorization: `Bearer ${value}` };

    case 'basic':
      // Value should be "user:pass" — we base64-encode it
      return { Authorization: `Basic ${Buffer.from(value).toString('base64')}` };

    case 'header': {
      const headerName = auth.headerName || 'X-API-Key';
      return { [headerName]: value };
    }

    default:
      throw createError(`Unknown auth type: ${(auth as any).type}`, 'ERR_AUTH');
  }
}

/**
 * Return a copy of headers with sensitive values replaced by [REDACTED].
 * The original headers object is never mutated.
 */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Redact sensitive data from an error before returning it to the agent.
 * Strips auth headers from config.headers and cleans the error message.
 */
export function redactError(error: any): any {
  if (!error) return error;

  // Clone the error to avoid mutating the original
  const clean: any = new Error(redactString(error.message || ''));
  clean.name = error.name || 'GrabError';
  clean.code = error.code;
  clean.status = error.status;
  clean.isGrabError = error.isGrabError;

  if (error.config) {
    clean.config = {
      ...error.config,
      headers: error.config.headers ? redactHeaders(error.config.headers) : {},
    };
  }

  if (error.response) {
    clean.response = {
      ...error.response,
      headers: error.response.headers ? redactHeaders(error.response.headers) : {},
      config: error.response.config
        ? {
            ...error.response.config,
            headers: error.response.config.headers
              ? redactHeaders(error.response.config.headers)
              : {},
          }
        : undefined,
    };
  }

  return clean;
}

/**
 * Scrub potential secrets from an error message string.
 * Catches common patterns like 'Bearer xxx' or 'Basic xxx'.
 */
function redactString(msg: string): string {
  return msg
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/Basic\s+\S+/gi, 'Basic [REDACTED]')
    .replace(/token[=:]\s*\S+/gi, 'token=[REDACTED]')
    .replace(/key[=:]\s*\S+/gi, 'key=[REDACTED]');
}
