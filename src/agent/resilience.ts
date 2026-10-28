/**
 * Retry with exponential backoff, rate limiting, and dry-run mode.
 */

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Determine if an error or status code is retryable.
 * Retries on: 429 (rate limited), 5xx (server error), network errors.
 */
export function isRetryable(errorOrResponse: any): boolean {
  if (!errorOrResponse) return false;

  // Network errors
  if (errorOrResponse.code === 'ERR_NETWORK' || errorOrResponse.code === 'ECONNRESET') return true;

  // HTTP 429 or 5xx
  const status = errorOrResponse.status || errorOrResponse.response?.status;
  if (status === 429) return true;
  if (status && status >= 500 && status < 600) return true;

  return false;
}

/** Options for the retry wrapper. */
export interface RetryOptions {
  /** Max number of retries (0 = no retries). Default: 2. */
  maxRetries?: number;
  /** Initial backoff delay in ms. Default: 1000. */
  initialDelayMs?: number;
  /** Backoff multiplier. Default: 2. */
  multiplier?: number;
  /** Maximum delay cap in ms. Default: 30000. */
  maxDelayMs?: number;
  /** Respect Retry-After header from 429 responses. Default: true. */
  respectRetryAfter?: boolean;
  /** HTTP method being requested (used to enforce idempotency). Default: 'GET'. */
  method?: string;
  /** Opt-in flag to allow retrying non-idempotent POST requests. Default: false. */
  retryPost?: boolean;
  /** Custom list of HTTP methods that may be retried. Overrides defaults. */
  retryMethods?: string[];
}

/** Default methods considered safe / idempotent to retry automatically. */
const DEFAULT_IDEMPOTENT_METHODS = ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'];

/**
 * Execute fn with automatic retries on retryable failures.
 * Safe by default: only retries idempotent methods (GET, HEAD, PUT, DELETE) unless POST is opted in.
 * Honors Retry-After headers from 429 responses.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const initialDelay = options.initialDelayMs ?? 1000;
  const multiplier = options.multiplier ?? 2;
  const maxDelay = options.maxDelayMs ?? 30000;
  const respectRetryAfter = options.respectRetryAfter ?? true;

  const method = (options.method || 'GET').toUpperCase();
  const allowedMethods = options.retryMethods
    ? options.retryMethods.map(m => m.toUpperCase())
    : options.retryPost
      ? [...DEFAULT_IDEMPOTENT_METHODS, 'POST']
      : DEFAULT_IDEMPOTENT_METHODS;

  const methodIsRetryable = allowedMethods.includes(method);

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result: any = await fn();

      // If the function resolves with a 429 or 5xx response object (e.g. validateStatus: () => true)
      if (result && typeof result === 'object' && 'status' in result) {
        const status = result.status;
        const isRetriableStatus = status === 429 || (status >= 500 && status < 600);
        if (isRetriableStatus) {
          if (attempt >= maxRetries || !methodIsRetryable) {
            return result;
          }

          let delay = Math.min(initialDelay * Math.pow(multiplier, attempt), maxDelay);

          if (respectRetryAfter && result.headers) {
            const retryAfter = result.headers['retry-after'] || result.headers['Retry-After'];
            if (retryAfter) {
              const retryAfterMs = parseRetryAfter(retryAfter);
              if (retryAfterMs > 0) {
                delay = Math.min(retryAfterMs, maxDelay);
              }
            }
          }

          const jitter = delay * 0.25 * (Math.random() * 2 - 1);
          delay = Math.max(0, delay + jitter);
          await sleep(delay);
          continue;
        }
      }

      return result;
    } catch (err: any) {
      lastError = err;

      if (attempt >= maxRetries || !isRetryable(err) || !methodIsRetryable) {
        throw err;
      }

      // Calculate delay with exponential backoff + jitter
      let delay = Math.min(initialDelay * Math.pow(multiplier, attempt), maxDelay);

      // Respect Retry-After header if present
      if (respectRetryAfter) {
        const headers = err?.response?.headers || err?.headers;
        if (headers) {
          const retryAfter = headers['retry-after'] || headers['Retry-After'];
          if (retryAfter) {
            const retryAfterMs = parseRetryAfter(retryAfter);
            if (retryAfterMs > 0) {
              delay = Math.min(retryAfterMs, maxDelay);
            }
          }
        }
      }

      // Add jitter (±25%)
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      delay = Math.max(0, delay + jitter);

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Parse a Retry-After header value.
 * Supports seconds (integer) or HTTP-date format.
 */
export function parseRetryAfter(value: string): number {
  if (!value) return 0;
  const seconds = parseInt(value, 10);
  if (!isNaN(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(value);
  if (!isNaN(date)) return Math.max(0, date - Date.now());

  return 0;
}

/**
 * Simple sliding-window rate limiter.
 * Tracks timestamps of requests and blocks if the limit is exceeded.
 */
export class RateLimiter {
  private timestamps: number[] = [];
  private readonly maxPerMinute: number;

  constructor(maxPerMinute: number) {
    this.maxPerMinute = maxPerMinute;
  }

  /**
   * Check if a request is allowed. If not, throws with ERR_RATE_LIMITED.
   * Call this before each request.
   */
  acquire(): void {
    const now = Date.now();
    const windowStart = now - 60_000;

    // Prune timestamps outside the window
    this.timestamps = this.timestamps.filter(t => t > windowStart);

    if (this.timestamps.length >= this.maxPerMinute) {
      const oldestInWindow = this.timestamps[0];
      const retryAfterMs = oldestInWindow + 60_000 - now;
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);
      const err = new Error(
        `Rate limit exceeded: ${this.maxPerMinute} requests/min. Retry after ${retryAfterSec}s.`
      ) as any;
      err.code = 'ERR_RATE_LIMITED';
      err.isGrabError = true;
      err.name = 'GrabError';
      throw err;
    }

    this.timestamps.push(now);
  }

  /** Reset the rate limiter (for testing). */
  reset(): void {
    this.timestamps = [];
  }
}

/** Result of a dry-run request. */
export interface DryRunResult {
  dryRun: true;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: any;
  message: string;
}

/**
 * Build a dry-run result instead of sending a real request.
 * Returns what would actually be sent after allowlist and resolution pass.
 */
export function buildDryRunResult(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: any
): DryRunResult {
  return {
    dryRun: true,
    method,
    url,
    headers,
    body,
    message: `Dry run: ${method} ${url} — request was not sent.`,
  };
}
