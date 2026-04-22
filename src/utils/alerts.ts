/**
 * Alert Notification Utilities
 *
 * Supports Telegram Bot API and email (SendGrid / Mailgun).
 * Uses a provider registry so new channels can be added without
 * modifying the dispatch logic.
 */

import type { AlertEnv } from '../types';
import { log } from './logger';
import { isAtLeast, parseSeverity, type SeverityLevel } from './severity';
import { sendTelegramAlert } from './alerts/telegram';
import { sendSendGridAlert } from './alerts/sendgrid';
import { sendMailgunAlert } from './alerts/mailgun';

export interface AlertPayload {
  level: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  repo?: string;
  prNumber?: number;
  findingCount?: number;
  details?: Record<string, unknown>;
}

// --- Email Provider Registry ---

export type EmailProviderFn = (payload: AlertPayload, env: AlertEnv) => Promise<void>;

const emailProviders: Record<string, EmailProviderFn> = {
  sendgrid: sendSendGridAlert,
  mailgun: sendMailgunAlert,
};

/**
 * Register a new email provider at runtime.
 */
export function registerEmailProvider(name: string, fn: EmailProviderFn): void {
  emailProviders[name.toLowerCase()] = fn;
}

// --- Dispatch ---

export async function sendEmailAlert(
  payload: AlertPayload,
  env: AlertEnv
): Promise<void> {
  const emailProvider = env.EMAIL_PROVIDER;

  if (!emailProvider) {
    log('warn', 'alerts', 'email_not_configured');
    return;
  }

  const provider = emailProviders[emailProvider.toLowerCase()];
  if (!provider) {
    log('warn', 'alerts', 'unknown_email_provider', { provider: emailProvider });
    return;
  }

  await provider(payload, env);
}

/**
 * Send alert through all configured channels.
 */
export async function sendAlert(
  payload: AlertPayload,
  env: AlertEnv
): Promise<void> {
  const errors: string[] = [];

  try {
    await sendTelegramAlert(payload, env);
  } catch (err) {
    errors.push(`Telegram: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await sendEmailAlert(payload, env);
  } catch (err) {
    errors.push(`Email: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (errors.length > 0) {
    log('error', 'alerts', 'alert_delivery_failed', { errors, payload });
  }
}

// --- Severity-Based Alert Filtering ---

/**
 * Check if a finding severity meets the configured alert threshold.
 */
export function shouldAlertForSeverity(
  findingSeverity: SeverityLevel,
  minSeverity: SeverityLevel = 'medium'
): boolean {
  return isAtLeast(findingSeverity, minSeverity);
}

/**
 * Map alert payload level to internal severity level.
 */
export function alertLevelToSeverity(
  level: AlertPayload['level']
): SeverityLevel {
  switch (level) {
    case 'critical': return 'critical';
    case 'error': return 'high';
    case 'warning': return 'medium';
    default: return 'low';
  }
}

/**
 * Send alert only if the finding severity meets the threshold.
 */
export async function sendSeverityAlert(
  payload: AlertPayload,
  env: AlertEnv
): Promise<void> {
  const minSeverity = parseSeverity(env.ALERT_MIN_SEVERITY || 'medium');
  const findingSeverity = alertLevelToSeverity(payload.level);

  if (!shouldAlertForSeverity(findingSeverity, minSeverity)) {
    log('info', 'alerts', 'alert_suppressed', {
      reason: 'below_threshold',
      findingSeverity,
      minSeverity,
    });
    return;
  }

  await sendAlert(payload, env);
}
