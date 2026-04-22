/**
 * Structured JSON logger for Cloudflare Workers.
 * All log output is a single JSON line per call for easy parsing.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogData extends Record<string, unknown> {
  level: LogLevel;
  worker: string;
  event: string;
}

/**
 * Emit a structured JSON log line.
 *
 * @param level   - Log severity
 * @param worker  - Worker/module name (e.g. 'orchestrator', 'scanner-jobs')
 * @param event   - Event name (e.g. 'job_received', 'enqueue_failed')
 * @param data    - Additional key/value fields
 */
export function log(
  level: LogLevel,
  worker: string,
  event: string,
  data?: Record<string, unknown>
): void {
  const entry: LogData = {
    level,
    worker,
    event,
    ...data,
  };

  const line = JSON.stringify(entry);

  switch (level) {
    case 'debug':
      console.debug(line);
      break;
    case 'info':
      console.log(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'error':
      console.error(line);
      break;
  }
}
