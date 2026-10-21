import * as fs from 'node:fs';
import * as path from 'node:path';
import { AuditLogEntry } from './types';
import { redactHeaders, scrubSecrets } from './secrets';

let configuredAuditLogPath: string | undefined = process.env.GRAB_AUDIT_LOG;
const inMemoryLogs: AuditLogEntry[] = [];

/** Set or clear the audit log file path. */
export function setAuditLogPath(logPath?: string): void {
  configuredAuditLogPath = logPath;
}

/** Get the current audit log path. */
export function getAuditLogPath(): string | undefined {
  return configuredAuditLogPath || process.env.GRAB_AUDIT_LOG;
}

/** Get in-memory audit logs (useful for inspections and testing). */
export function getAuditLogs(): AuditLogEntry[] {
  return [...inMemoryLogs];
}

/** Clear in-memory audit logs. */
export function clearAuditLogs(): void {
  inMemoryLogs.length = 0;
}

/**
 * Log a request entry to the JSONL audit log.
 * Guarantees that headers, body, and error messages are redacted.
 */
export function logAudit(
  entry: Omit<AuditLogEntry, 'timestamp'> & { timestamp?: string },
  customPath?: string
): void {
  const timestamp = entry.timestamp || new Date().toISOString();

  const safeEntry: AuditLogEntry = {
    timestamp,
    instance: entry.instance,
    method: entry.method.toUpperCase(),
    url: entry.url,
    headers: redactHeaders(entry.headers || {}),
    ...(entry.body !== undefined ? { body: scrubSecrets(entry.body) } : {}),
    ...(entry.status !== undefined ? { status: entry.status } : {}),
    durationMs: Math.max(0, Math.round(entry.durationMs)),
    ...(entry.truncated !== undefined ? { truncated: entry.truncated } : {}),
    ...(entry.bytes !== undefined ? { bytes: entry.bytes } : {}),
    ...(entry.error ? { error: scrubSecrets(entry.error) } : {}),
  };

  inMemoryLogs.push(safeEntry);

  const targetPath = customPath || getAuditLogPath();
  if (targetPath) {
    try {
      const dir = path.dirname(path.resolve(targetPath));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(path.resolve(targetPath), JSON.stringify(safeEntry) + '\n', 'utf-8');
    } catch {
      // Non-blocking: audit logging should not break caller execution
    }
  }
}
