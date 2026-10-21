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
  AuditLogEntry,
} from './types';

// Config
export { loadConfig, validateConfig, resolveConfigPath, validateStartupEnv } from './config';

// Allowlist
export {
  matchPath,
  checkAllowlist,
  checkRedirectHost,
  checkRedirectHop,
  resolveAndValidatePath,
} from './allowlist';
export type { ResolvedPathInfo } from './allowlist';

// Secrets
export {
  resolveAuth,
  resolveStaticHeaders,
  redactHeaders,
  redactError,
  scrubSecrets,
  registerSecret,
  clearRegisteredSecrets,
  getRegisteredSecrets,
} from './secrets';

// Response shaping
export { truncateResponse, selectFields, shapeResponse } from './response';

// Resilience
export {
  isRetryable,
  withRetry,
  RateLimiter,
  buildDryRunResult,
  parseRetryAfter,
} from './resilience';
export type { RetryOptions, DryRunResult } from './resilience';

// Audit logging
export {
  logAudit,
  getAuditLogs,
  clearAuditLogs,
  setAuditLogPath,
  getAuditLogPath,
} from './audit';

// Manager (orchestrator)
export {
  listInstances,
  agentRequest,
  createAgentInstance,
  resetRateLimiters,
} from './manager';
export type { AgentRequestOptions } from './manager';
