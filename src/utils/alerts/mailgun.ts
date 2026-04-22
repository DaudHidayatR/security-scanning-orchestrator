/**
 * Mailgun email alert provider.
 */

import type { AlertEnv } from '../../types';
import type { AlertPayload } from '../alerts';

function buildPlainTextBody(payload: AlertPayload): string {
  const lines: string[] = [
    `Level: ${payload.level.toUpperCase()}`,
    `Title: ${payload.title}`,
    '',
    payload.message,
  ];

  if (payload.repo) lines.push(`Repo: ${payload.repo}`);
  if (payload.prNumber) lines.push(`PR: #${payload.prNumber}`);
  if (payload.findingCount !== undefined) lines.push(`Findings: ${payload.findingCount}`);
  if (payload.details) {
    lines.push('');
    lines.push('Details:');
    for (const [key, value] of Object.entries(payload.details)) {
      lines.push(`  ${key}: ${value}`);
    }
  }

  return lines.join('\n');
}

export async function sendMailgunAlert(
  payload: AlertPayload,
  env: AlertEnv
): Promise<void> {
  const apiKey = env.MAILGUN_API_KEY;
  const domain = env.MAILGUN_DOMAIN;
  const fromEmail = env.EMAIL_FROM;
  const toEmail = env.EMAIL_TO;

  if (!apiKey || !domain || !fromEmail || !toEmail) {
    throw new Error('Mailgun config incomplete');
  }

  const subject = `[${payload.level.toUpperCase()}] ${payload.title}`;
  const body = buildPlainTextBody(payload);

  const formData = new URLSearchParams();
  formData.append('from', fromEmail);
  formData.append('to', toEmail);
  formData.append('subject', subject);
  formData.append('text', body);

  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`api:${apiKey}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mailgun API error: ${res.status} ${err}`);
  }
}
