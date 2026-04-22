/**
 * Webhook delivery logging utility.
 * Thin wrapper around the D1 webhook_deliveries table insert.
 */

import type { Env, WebhookDelivery } from '../types';
import { log } from './logger';

export interface WebhookLogFields {
  delivery_id: string | null;
  event: string;
  action: string | null;
  repo: string;
  pr_number: number | null;
  payload_hash: string | null;
  status: string;
  error_message: string | null;
}

/**
 * Log a webhook delivery to D1.
 * Failures are logged but never thrown so the webhook response is not interrupted.
 */
export async function logWebhookDelivery(
  env: Env,
  fields: WebhookLogFields
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO webhook_deliveries
       (delivery_id, event, action, repo, pr_number, payload_hash, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        fields.delivery_id,
        fields.event,
        fields.action,
        fields.repo,
        fields.pr_number,
        fields.payload_hash,
        fields.status,
        fields.error_message
      )
      .run();
  } catch (err) {
    log('error', 'orchestrator', 'webhook_log_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
