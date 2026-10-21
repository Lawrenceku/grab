/**
 * Agent module barrel export.
 * All agent-safety features in one import.
 */

// Types
export type {
  InstanceAuth,
  AllowConfig,
  InstanceConfig,
  GlobalLimits,
  GrabAgentConfig,
  InstanceInfo,
  ShapeOptions,
  ShapedData,
} from './types';

// Config
export { loadConfig, validateConfig, resolveConfigPath } from './config';

// Allowlist
export { matchPath, checkAllowlist, checkRedirectHost } from './allowlist';

// Secrets
export { resolveAuth, redactHeaders, redactError } from './secrets';

// Response shaping
export { truncateResponse, selectFields, shapeResponse } from './response';

// Resilience
export {
  isRetryable,
  withRetry,
  RateLimiter,
  buildDryRunResult,
} from './resilience';
export type { RetryOptions, DryRunResult } from './resilience';

// Manager (orchestrator)
export {
  listInstances,
  agentRequest,
  createAgentInstance,
  resetRateLimiters,
} from './manager';
export type { AgentRequestOptions } from './manager';
