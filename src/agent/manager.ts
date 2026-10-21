/**
 * Agent Instance Manager — the orchestrator.
 *
 * Enforces policy at the final dispatch step, provides manual redirect
 * validation with cross-host auth stripping, safe retries on idempotent
 * methods, secret redaction by value, and JSONL audit logging.
 */

import { GrabInstance } from '../core';
import { createError } from '../adapters/registry';
import {
  GrabAgentConfig,
  InstanceConfig,
  InstanceInfo,
  ShapeOptions,
} from './types';
import {
  checkAllowlist,
  checkRedirectHop,
  resolveAndValidatePath,
} from './allowlist';
import {
  resolveAuth,
  resolveStaticHeaders,
  redactHeaders,
  redactError,
  scrubSecrets,
} from './secrets';
import { shapeResponse } from './response';
import {
  withRetry,
  RateLimiter,
  buildDryRunResult,
  RetryOptions,
} from './resilience';
import { logAudit } from './audit';
import { Response, RequestConfig } from '../types';

/** Cache of rate limiters, keyed by instance name. */
const rateLimiters = new Map<string, RateLimiter>();

/** Sensitive auth header names to strip on cross-host hops. */
const SENSITIVE_AUTH_HEADERS = [
  'authorization',
  'x-api-key',
  'cookie',
  'proxy-authorization',
];

/**
 * Get or create a rate limiter for a named instance.
 */
function getRateLimiter(name: string, maxPerMin: number): RateLimiter {
  let limiter = rateLimiters.get(name);
  if (!limiter) {
    limiter = new RateLimiter(maxPerMin);
    rateLimiters.set(name, limiter);
  }
  return limiter;
}

/**
 * Return safe metadata about all configured instances.
 * Never includes secrets or auth details. Explicitly includes allowed paths
 * so the agent does not have to guess.
 */
export function listInstances(config: GrabAgentConfig): InstanceInfo[] {
  return Object.entries(config.instances).map(([name, inst]) => {
    const defaultMethods = inst.readOnly ? ['GET', 'HEAD', 'OPTIONS'] : ['*'];
    return {
      name,
      baseURL: inst.baseURL,
      methods: inst.allow?.methods ?? defaultMethods,
      paths: inst.allow?.paths ?? ['*'],
      readOnly: Boolean(inst.readOnly),
    };
  });
}

/** Options for agentRequest. */
export interface AgentRequestOptions extends ShapeOptions {
  /** If true, validate the request but don't send it. */
  dryRun?: boolean;
  /** Custom retry options. */
  retry?: RetryOptions;
  /** Optional custom adapter (useful for testing or custom transports). */
  adapter?: any;
}

/**
 * High-level request function for agent use.
 *
 * 1. Validates the instance name exists
 * 2. Resolves static headers ({ env }) and auth from env vars
 * 3. Normalizes and validates path against traversal, //evil.com, and origin tricks
 * 4. Checks allowlist (method + path + readOnly)
 * 5. Applies rate limiting
 * 6. Executes request with manual redirect validation on each hop
 * 7. Strips auth headers on cross-host hops
 * 8. Executes retries safely on idempotent methods only (POST opt-in)
 * 9. Shapes response and scrubs secret values from headers, data, and errors
 * 10. Logs redacted audit entry to JSONL
 */
export async function agentRequest(
  config: GrabAgentConfig,
  instanceName: string,
  method: string,
  path: string,
  body?: any,
  options: AgentRequestOptions = {}
): Promise<any> {
  const startTime = Date.now();

  // 1. Resolve instance
  const instConfig = config.instances[instanceName];
  if (!instConfig) {
    throw createError(
      `Unknown instance "${instanceName}". Available: ${Object.keys(config.instances).join(', ')}`,
      'ERR_INSTANCE_NOT_FOUND'
    );
  }

  // 2. Resolve auth and static headers
  const staticHeaders = resolveStaticHeaders(instConfig.headers);
  const authHeaders = instConfig.auth ? resolveAuth(instConfig.auth) : {};

  const headers: Record<string, string> = {
    ...staticHeaders,
    ...authHeaders,
  };

  // 3. Normalize and validate path
  const { resolvedURL, resolvedPath } = resolveAndValidatePath(
    path,
    instConfig.baseURL,
    instanceName
  );

  // 4. Check allowlist against resolved path and method
  checkAllowlist(instConfig, method, resolvedPath, instanceName);

  // 5. Dry-run mode: return what would actually be sent after allowlist passes
  if (options.dryRun) {
    return buildDryRunResult(
      method.toUpperCase(),
      resolvedURL,
      redactHeaders(headers),
      scrubSecrets(body)
    );
  }

  // 6. Rate limiting
  const rateLimit = instConfig.rateLimitPerMin ?? config.limits?.rateLimitPerMin;
  if (rateLimit) {
    const limiter = getRateLimiter(instanceName, rateLimit);
    limiter.acquire();
  }

  // 7. Setup request with manual redirect execution
  const maxRetries = options.retry?.maxRetries ?? config.limits?.maxRetries ?? 2;
  const retryOpts: RetryOptions = {
    maxRetries,
    method: method.toUpperCase(),
    ...options.retry,
  };

  const client = GrabInstance.create({
    baseURL: instConfig.baseURL,
    timeout: instConfig.timeout ?? 60000,
    validateStatus: () => true,
    redirect: 'manual',
    maxRedirects: 0,
    ...((options as any).adapter ? { adapter: (options as any).adapter } : {}),
  });

  const sendWithRedirectHops = async (): Promise<Response> => {
    let currentUrl = resolvedURL;
    let currentMethod = method.toUpperCase();
    let currentHeaders: Record<string, string> = { ...headers };
    let currentBody = body;
    const maxHops = 5;

    for (let hop = 0; hop <= maxHops; hop++) {
      // Re-run allowlist check at the final step before sending each hop
      checkAllowlist(instConfig, currentMethod, currentUrl, instanceName);

      const reqConfig: RequestConfig = {
        url: currentUrl,
        method: currentMethod as any,
        headers: currentHeaders,
        timeout: instConfig.timeout ?? 60000,
        redirect: 'manual',
        maxRedirects: 0,
        validateStatus: () => true,
        ...(currentBody !== undefined ? { data: currentBody } : {}),
      };

      const res = await client.request(reqConfig);

      // Check for redirect status
      const isRedirect = [301, 302, 303, 307, 308].includes(res.status);
      const location = res.headers['location'] || res.headers['Location'];

      if (isRedirect && location) {
        if (hop >= maxHops) {
          throw createError('Too many redirects', 'ERR_TOO_MANY_REDIRECTS');
        }

        const nextUrl = new URL(location, currentUrl).toString();

        // Validate redirect hop (host + allowlist)
        const { isCrossHost } = checkRedirectHop(
          instConfig,
          currentMethod,
          currentUrl,
          nextUrl,
          instanceName
        );

        // Strip auth headers on cross-host hops
        if (isCrossHost) {
          for (const key of Object.keys(currentHeaders)) {
            const lowerKey = key.toLowerCase();
            if (
              SENSITIVE_AUTH_HEADERS.includes(lowerKey) ||
              (instConfig.auth?.headerName &&
                lowerKey === instConfig.auth.headerName.toLowerCase())
            ) {
              delete currentHeaders[key];
            }
          }
        }

        // Method adjustments according to HTTP specs
        if (
          res.status === 303 ||
          ((res.status === 301 || res.status === 302) && currentMethod === 'POST')
        ) {
          currentMethod = 'GET';
          currentBody = undefined;
        }

        currentUrl = nextUrl;
        continue;
      }

      return res;
    }

    throw createError('Too many redirects', 'ERR_TOO_MANY_REDIRECTS');
  };

  let response: Response;
  try {
    response = await withRetry(sendWithRedirectHops, retryOpts);
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const cleanErr = redactError(err);

    logAudit(
      {
        instance: instanceName,
        method: method.toUpperCase(),
        url: resolvedURL,
        headers,
        body,
        durationMs,
        error: cleanErr.message,
      },
      config.auditLogPath
    );

    throw cleanErr;
  }

  const durationMs = Date.now() - startTime;

  // 8. Shape response (field selection + structural truncation)
  const maxBytes =
    options.maxBytes ?? instConfig.maxResponseBytes ?? config.limits?.maxResponseBytes;
  const shaped = shapeResponse(response.data, {
    maxBytes,
    fields: options.fields,
  });

  // 9. Scrub secrets by value from response body and headers
  const scrubbedData = scrubSecrets(shaped.data);
  const safeHeaders = redactHeaders(response.headers);

  // 10. Write JSONL audit log
  logAudit(
    {
      instance: instanceName,
      method: method.toUpperCase(),
      url: resolvedURL,
      headers,
      body,
      status: response.status,
      durationMs,
      truncated: shaped.truncated,
      bytes: shaped.originalBytes,
    },
    config.auditLogPath
  );

  return {
    data: scrubbedData,
    status: response.status,
    statusText: response.statusText,
    headers: safeHeaders,
    truncated: shaped.truncated,
    originalBytes: shaped.originalBytes,
    ...(shaped.hint ? { hint: shaped.hint } : {}),
  };
}

/**
 * Create an agent-safe client for a named instance.
 * Does not expose the internal interceptor list to prevent policy bypass.
 */
export function createAgentInstance(
  instanceName: string,
  config: GrabAgentConfig
): any {
  const instConfig = config.instances[instanceName];
  if (!instConfig) {
    throw createError(
      `Unknown instance "${instanceName}"`,
      'ERR_INSTANCE_NOT_FOUND'
    );
  }

  return {
    get(path: string, options?: AgentRequestOptions) {
      return agentRequest(config, instanceName, 'GET', path, undefined, options);
    },
    post(path: string, body?: any, options?: AgentRequestOptions) {
      return agentRequest(config, instanceName, 'POST', path, body, options);
    },
    put(path: string, body?: any, options?: AgentRequestOptions) {
      return agentRequest(config, instanceName, 'PUT', path, body, options);
    },
    delete(path: string, options?: AgentRequestOptions) {
      return agentRequest(config, instanceName, 'DELETE', path, undefined, options);
    },
    patch(path: string, body?: any, options?: AgentRequestOptions) {
      return agentRequest(config, instanceName, 'PATCH', path, body, options);
    },
    head(path: string, options?: AgentRequestOptions) {
      return agentRequest(config, instanceName, 'HEAD', path, undefined, options);
    },
    options(path: string, options?: AgentRequestOptions) {
      return agentRequest(config, instanceName, 'OPTIONS', path, undefined, options);
    },
    request(reqConfig: RequestConfig & AgentRequestOptions) {
      return agentRequest(
        config,
        instanceName,
        reqConfig.method || 'GET',
        reqConfig.url || '',
        reqConfig.data ?? reqConfig.body,
        reqConfig
      );
    },
    // Do not expose interceptor list to callers
    get interceptors() {
      throw new Error('Interceptors are disabled on agent instances to enforce security policy.');
    },
  };
}

/**
 * Reset all rate limiters (for testing).
 */
export function resetRateLimiters(): void {
  rateLimiters.clear();
}
