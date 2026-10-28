import { InstanceConfig } from './types';
import { createError } from '../adapters/registry';

/**
 * Match a URL path against a glob pattern.
 *
 * Supported wildcards:
 * - `*`  matches exactly one path segment (no slashes)
 * - `**` matches zero or more path segments
 *
 * Both pattern and path are normalized: leading slash ensured,
 * trailing slash stripped, query string removed.
 */
export function matchPath(pattern: string, urlPath: string): boolean {
  // Normalize: strip query/fragment, ensure leading slash, strip trailing slash
  const normPath = normalize(urlPath);
  const normPattern = normalize(pattern);

  const patternParts = normPattern.split('/').filter(Boolean);
  const pathParts = normPath.split('/').filter(Boolean);

  return matchSegments(patternParts, 0, pathParts, 0);
}

function normalize(s: string): string {
  // Remove query string and fragment
  let clean = s.split('?')[0].split('#')[0];
  // Ensure leading slash
  if (!clean.startsWith('/')) clean = '/' + clean;
  // Strip trailing slash (but keep root '/')
  if (clean.length > 1 && clean.endsWith('/')) clean = clean.slice(0, -1);
  return clean;
}

function matchSegments(
  pattern: string[],
  pi: number,
  path: string[],
  si: number
): boolean {
  // Both exhausted → match
  if (pi === pattern.length && si === path.length) return true;

  // Pattern exhausted but path remains → no match
  if (pi === pattern.length) return false;

  const seg = pattern[pi];

  if (seg === '**') {
    // ** can match zero or more segments
    // Try matching ** against 0, 1, 2, ... remaining path segments
    for (let skip = 0; skip <= path.length - si; skip++) {
      if (matchSegments(pattern, pi + 1, path, si + skip)) return true;
    }
    return false;
  }

  // Path exhausted but pattern has more non-** segments → no match
  if (si === path.length) return false;

  if (seg === '*') {
    // * matches exactly one segment
    return matchSegments(pattern, pi + 1, path, si + 1);
  }

  // Literal match (case-insensitive)
  if (seg.toLowerCase() === path[si].toLowerCase()) {
    return matchSegments(pattern, pi + 1, path, si + 1);
  }

  return false;
}

export interface ResolvedPathInfo {
  resolvedURL: string;
  resolvedPath: string;
  search: string;
}

/**
 * Normalize and resolve a path against a baseURL, defending against path traversal,
 * protocol-relative attacks, user@host tricks, and origin mismatches.
 */
export function resolveAndValidatePath(
  urlOrPath: string,
  baseURL: string,
  instanceName: string = 'instance',
  allowedHosts?: string[]
): ResolvedPathInfo {
  if (!urlOrPath && urlOrPath !== '') {
    throw createError(`Invalid path on ${instanceName}`, 'ERR_FORBIDDEN');
  }

  // Decode %2e (.), %2f (/), and %5c (\) case-insensitively before resolving
  let decoded = urlOrPath
    .replace(/%2e/gi, '.')
    .replace(/%2f/gi, '/')
    .replace(/%5c/gi, '/');

  // Block protocol-relative URLs (e.g. //evil.com)
  if (/^\s*\/\//.test(decoded)) {
    throw createError(
      `Protocol-relative URL "${urlOrPath}" is not allowed on ${instanceName}.`,
      'ERR_FORBIDDEN'
    );
  }

  // Block user@host tricks in authority
  const preQuery = decoded.split('?')[0].split('#')[0];
  if (/@/.test(preQuery)) {
    throw createError(
      `User credentials or authority tricks (@) in URL "${urlOrPath}" are not allowed on ${instanceName}.`,
      'ERR_FORBIDDEN'
    );
  }

  let baseObj: URL;
  try {
    baseObj = new URL(baseURL);
  } catch {
    throw createError(`Invalid baseURL "${baseURL}" for instance "${instanceName}"`, 'ERR_FORBIDDEN');
  }

  let resolved: URL;
  try {
    resolved = new URL(decoded, baseURL);
  } catch {
    throw createError(`Invalid URL "${urlOrPath}" on ${instanceName}`, 'ERR_FORBIDDEN');
  }

  // Reject anything whose origin differs from base (unless hostname is in allowedHosts)
  if (resolved.origin.toLowerCase() !== baseObj.origin.toLowerCase()) {
    const isAllowedHost =
      allowedHosts &&
      allowedHosts.some(h => h.toLowerCase() === resolved.hostname.toLowerCase());

    if (!isAllowedHost) {
      throw createError(
        `URL "${urlOrPath}" resolves to origin "${resolved.origin}", which differs from base origin "${baseObj.origin}" on ${instanceName}.`,
        'ERR_FORBIDDEN'
      );
    }
  }

  // Reject userinfo
  if (resolved.username || resolved.password) {
    throw createError(
      `User credentials in URL are not allowed on ${instanceName}.`,
      'ERR_FORBIDDEN'
    );
  }

  return {
    resolvedURL: resolved.toString(),
    resolvedPath: resolved.pathname,
    search: resolved.search,
  };
}

/**
 * Check that a request is allowed by the instance's allowlist.
 * Throws a GrabError with code ERR_FORBIDDEN if the request is blocked.
 */
export function checkAllowlist(
  instanceConfig: InstanceConfig,
  method: string,
  urlOrPath: string,
  instanceName: string
): void {
  const upperMethod = method.toUpperCase();

  // Check read-only constraint
  if (instanceConfig.readOnly) {
    const readOnlyAllowed = ['GET', 'HEAD', 'OPTIONS'];
    if (!readOnlyAllowed.includes(upperMethod)) {
      throw createError(
        `Method ${upperMethod} not allowed on read-only instance "${instanceName}"; allowed: ${readOnlyAllowed.join(', ')}`,
        'ERR_FORBIDDEN'
      );
    }
  }

  const allow = instanceConfig.allow;

  // Check method allowlist
  if (allow?.methods && allow.methods.length > 0) {
    const allowed = allow.methods.map(m => m.toUpperCase());
    if (!allowed.includes(upperMethod)) {
      throw createError(
        `Method ${upperMethod} is not allowed on instance "${instanceName}"; allowed: ${allowed.join(', ')}`,
        'ERR_FORBIDDEN'
      );
    }
  }

  // Normalize path if baseURL is available
  let pathToCheck: string;
  if (instanceConfig.baseURL) {
    try {
      const resolved = resolveAndValidatePath(
        urlOrPath,
        instanceConfig.baseURL,
        instanceName,
        instanceConfig.allow?.hosts
      );
      pathToCheck = resolved.resolvedPath;
    } catch (err: any) {
      if (err?.code === 'ERR_FORBIDDEN') throw err;
      pathToCheck = urlOrPath.split('?')[0].split('#')[0];
    }
  } else {
    try {
      const parsed = new URL(urlOrPath);
      pathToCheck = parsed.pathname;
    } catch {
      pathToCheck = urlOrPath.split('?')[0].split('#')[0];
    }
  }

  // Check path allowlist
  if (allow?.paths && allow.paths.length > 0) {
    const matched = allow.paths.some(pattern => matchPath(pattern, pathToCheck));
    if (!matched) {
      throw createError(
        `Path "${pathToCheck}" is not allowed on instance "${instanceName}"; allowed paths: ${allow.paths.join(', ')}`,
        'ERR_FORBIDDEN'
      );
    }
  }
}

/**
 * Check that a redirect target host is allowed.
 * If no allow.hosts is set, only same-host redirects are permitted.
 */
export function checkRedirectHost(
  instanceConfig: InstanceConfig,
  originalUrl: string,
  redirectUrl: string,
  instanceName: string
): void {
  let originalHost: string;
  let redirectHost: string;

  try {
    originalHost = new URL(originalUrl).hostname.toLowerCase();
  } catch {
    return; // can't parse original, skip check
  }

  try {
    redirectHost = new URL(redirectUrl).hostname.toLowerCase();
  } catch {
    return; // can't parse redirect, skip check
  }

  // Same host is always allowed
  if (originalHost === redirectHost) return;

  const allowedHosts = instanceConfig.allow?.hosts;
  if (allowedHosts && allowedHosts.length > 0) {
    const lower = allowedHosts.map(h => h.toLowerCase());
    if (lower.includes(redirectHost)) return;
  }

  throw createError(
    `Redirect to host "${redirectHost}" is not allowed on instance "${instanceName}". ` +
    `Original host: "${originalHost}". ` +
    (allowedHosts?.length
      ? `Allowed redirect hosts: ${allowedHosts.join(', ')}`
      : 'No cross-host redirects are permitted (add allow.hosts to config)'),
    'ERR_FORBIDDEN'
  );
}

/**
 * Check a redirect hop: verifies allowed host and re-runs the full allowlist check
 * (method + path) on the target hop. Returns true if this is a cross-host hop.
 */
export function checkRedirectHop(
  instanceConfig: InstanceConfig,
  nextMethod: string,
  originalUrl: string,
  redirectUrl: string,
  instanceName: string
): { isCrossHost: boolean } {
  // 1. Check host
  checkRedirectHost(instanceConfig, originalUrl, redirectUrl, instanceName);

  // 2. Full allowlist check on target
  checkAllowlist(instanceConfig, nextMethod, redirectUrl, instanceName);

  const origHost = new URL(originalUrl).hostname.toLowerCase();
  const redirHost = new URL(redirectUrl).hostname.toLowerCase();

  return { isCrossHost: origHost !== redirHost };
}
