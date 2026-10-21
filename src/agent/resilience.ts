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
export function isRetryable(error: any): boolean {
  // Network errors
  if (error?.code === 'ERR_NETWORK' || error?.code === 'ECONNRESET') return true;

  // HTTP 429 or 5xx
  const status = error?.status || error?.response?.status;
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
}

/**
 * Execute fn with automatic retries on retryable failures.
 * Uses exponential backoff with jitter.
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

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;

      if (attempt >= maxRetries || !isRetryable(err)) {
        throw err;
      }

      // Calculate delay with exponential backoff + jitter
      let delay = Math.min(initialDelay * Math.pow(multiplier, attempt), maxDelay);

      // Respect Retry-After header if present
      if (respectRetryAfter && err?.response?.headers) {
        const retryAfter = err.response.headers['retry-after'];
        if (retryAfter) {
          const retryAfterMs = parseRetryAfter(retryAfter);
          if (retryAfterMs > 0) {
            delay = Math.min(retryAfterMs, maxDelay);
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
function parseRetryAfter(value: string): number {
  const seconds = parseInt(value, 10);
  if (!isNaN(seconds)) return seconds * 1000;

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
 * Useful for agents to preview what would be sent.
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
