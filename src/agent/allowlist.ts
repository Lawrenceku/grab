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

/**
 * Check that a request is allowed by the instance's allowlist.
 * Throws a GrabError with code ERR_FORBIDDEN if the request is blocked.
 */
export function checkAllowlist(
  instanceConfig: InstanceConfig,
  method: string,
  url: string,
  instanceName: string
): void {
  const allow = instanceConfig.allow;
  if (!allow) return; // no allowlist = everything permitted

  const upperMethod = method.toUpperCase();

  // Check method allowlist
  if (allow.methods && allow.methods.length > 0) {
    const allowed = allow.methods.map(m => m.toUpperCase());
    if (!allowed.includes(upperMethod)) {
      throw createError(
        `Method ${upperMethod} is not allowed on instance "${instanceName}". Allowed: ${allowed.join(', ')}`,
        'ERR_FORBIDDEN'
      );
    }
  }

  // Check path allowlist
  if (allow.paths && allow.paths.length > 0) {
    // Extract path from full URL or relative path
    let pathToCheck: string;
    try {
      const parsed = new URL(url);
      pathToCheck = parsed.pathname;
    } catch {
      // It's a relative path (e.g. '/customers/123')
      pathToCheck = url.split('?')[0].split('#')[0];
    }

    const matched = allow.paths.some(pattern => matchPath(pattern, pathToCheck));
    if (!matched) {
      throw createError(
        `Path "${pathToCheck}" is not allowed on instance "${instanceName}". Allowed patterns: ${allow.paths.join(', ')}`,
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
