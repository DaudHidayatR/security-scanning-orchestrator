/**
 * SendGrid email alert provider.
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

export async function sendSendGridAlert(
  payload: AlertPayload,
  env: AlertEnv
): Promise<void> {
  const apiKey = env.SENDGRID_API_KEY;
  const fromEmail = env.EMAIL_FROM;
  const toEmail = env.EMAIL_TO;

  if (!apiKey || !fromEmail || !toEmail) {
    throw new Error('SendGrid config incomplete: SENDGRID_API_KEY, EMAIL_FROM, EMAIL_TO required');
  }

  const subject = `[${payload.level.toUpperCase()}] ${payload.title}`;
  const body = buildPlainTextBody(payload);

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: fromEmail },
      subject,
      content: [{ type: 'text/plain', value: body }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`SendGrid API error: ${res.status} ${err}`);
  }
}
