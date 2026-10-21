import { HttpMethods } from '../types';

/**
 * Authentication configuration. References an environment variable name,
 * never the raw secret value. This makes the config file safe to commit.
 */
export interface InstanceAuth {
  /** Authentication scheme. */
  type: 'bearer' | 'basic' | 'header';
  /** Name of the environment variable holding the secret. */
  env: string;
  /** Custom header name for type: 'header' (e.g. 'X-API-Key'). */
  headerName?: string;
}

/**
 * Per-instance allowlist. Restricts which methods, paths and redirect
 * hosts are permitted, preventing an agent from reaching endpoints
 * it shouldn't.
 */
export interface AllowConfig {
  /** Allowed HTTP methods. If omitted, all methods are allowed. */
  methods?: HttpMethods[];
  /**
   * Allowed path patterns (glob-style).
   * `*` matches a single path segment, `**` matches any number.
   * Example: '/customers/*', '/v1/**'
   */
  paths?: string[];
  /**
   * Hosts that redirects may follow. If omitted, only redirects to
   * the same host as the original request are allowed.
   */
  hosts?: string[];
}

/** Configuration for a single named API instance. */
export interface InstanceConfig {
  /** Base URL for all requests on this instance. */
  baseURL: string;
  /** Authentication configuration. */
  auth?: InstanceAuth;
  /** Request allowlist (methods, path globs, redirect hosts). */
  allow?: AllowConfig;
  /** Default headers merged into every request. */
  headers?: Record<string, string>;
  /** Default request timeout in milliseconds. */
  timeout?: number;
  /** Max response body bytes before truncation (overrides global). */
  maxResponseBytes?: number;
  /** Max requests per minute (overrides global). */
  rateLimitPerMin?: number;
}

/** Global limits applied as defaults across all instances. */
export interface GlobalLimits {
  /** Max response body bytes before truncation. Default: 50000. */
  maxResponseBytes?: number;
  /** Max requests per minute per instance. Default: 60. */
  rateLimitPerMin?: number;
  /** Max automatic retries on 429/5xx/network errors. Default: 2. */
  maxRetries?: number;
}

/**
 * Top-level config shape. Loaded from ~/.config/grab-mcp/config.json
 * or the path in GRAB_MCP_CONFIG env var.
 */
export interface GrabAgentConfig {
  instances: Record<string, InstanceConfig>;
  limits?: GlobalLimits;
}

/** Safe instance info returned by listInstances (no secrets). */
export interface InstanceInfo {
  name: string;
  baseURL: string;
  methods?: HttpMethods[];
  paths?: string[];
}

/** Options for shaping agent responses. */
export interface ShapeOptions {
  /** Max response body bytes. */
  maxBytes?: number;
  /** Dot-notation field paths to extract from JSON responses. */
  fields?: string[];
}

/** Result of response shaping. */
export interface ShapedData {
  data: any;
  truncated: boolean;
  originalBytes: number;
}
