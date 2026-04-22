/**
 * Severity utilities.
 * Centralises all severity comparisons, rankings, queue routing, and alert mapping.
 */

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

const SEVERITY_RANK: Record<SeverityLevel, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** Maps Semgrep severity strings to internal severity levels. */
export const SEVERITY_MAP: Record<string, SeverityLevel> = {
  ERROR: 'high',
  WARNING: 'medium',
  INFO: 'low',
  EXPERIMENT: 'info',
};

/**
 * Normalise a raw severity string to an internal SeverityLevel.
 */
export function parseSeverity(raw: string): SeverityLevel {
  const key = raw.toUpperCase();
  return SEVERITY_MAP[key] ?? (raw.toLowerCase() as SeverityLevel) ?? 'medium';
}

/**
 * Numeric rank of a severity (higher = more severe).
 */
export function severityRank(severity: SeverityLevel): number {
  return SEVERITY_RANK[severity] ?? 0;
}

/**
 * True if `severity` is at least as severe as `minSeverity`.
 */
export function isAtLeast(severity: SeverityLevel, minSeverity: SeverityLevel): boolean {
  return severityRank(severity) >= severityRank(minSeverity);
}

/**
 * True for critical or high severity.
 */
export function isPriority(severity: SeverityLevel): boolean {
  return severity === 'critical' || severity === 'high';
}

/**
 * Queue name to use for AI validation based on severity.
 */
export function aiQueueName(severity: SeverityLevel): 'ai-validation-priority' | 'ai-validation' {
  return isPriority(severity) ? 'ai-validation-priority' : 'ai-validation';
}

/**
 * Map a severity level to an alert payload level.
 */
export function toAlertLevel(severity: SeverityLevel): 'critical' | 'error' | 'warning' | 'info' {
  switch (severity) {
    case 'critical': return 'critical';
    case 'high': return 'error';
    case 'medium': return 'warning';
    default: return 'info';
  }
}
