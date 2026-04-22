/**
 * Telegram Bot alert provider.
 */

import type { AlertEnv } from '../../types';
import { log } from '../logger';
import type { AlertPayload } from '../alerts';

function alertEmoji(level: string): string {
  switch (level) {
    case 'critical': return '\u274c';
    case 'error': return '\u26a0\ufe0f';
    case 'warning': return '\ud83d\udd14';
    case 'info': return '\u2139\ufe0f';
    default: return '\ud83d\udce2';
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildTelegramMessage(payload: AlertPayload, emoji: string): string {
  const lines: string[] = [
    `<b>${emoji} ${escapeHtml(payload.title)}</b>`,
    '',
    escapeHtml(payload.message),
  ];

  if (payload.repo) {
    lines.push(`<code>Repo:</code> ${escapeHtml(payload.repo)}`);
  }
  if (payload.prNumber) {
    lines.push(`<code>PR:</code> #${payload.prNumber}`);
  }
  if (payload.findingCount !== undefined) {
    lines.push(`<code>Findings:</code> ${payload.findingCount}`);
  }
  if (payload.details) {
    lines.push('');
    lines.push('<b>Details:</b>');
    for (const [key, value] of Object.entries(payload.details)) {
      lines.push(`<code>${escapeHtml(key)}:</code> ${escapeHtml(String(value))}`);
    }
  }

  return lines.join('\n');
}

export async function sendTelegramAlert(
  payload: AlertPayload,
  env: AlertEnv
): Promise<void> {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    log('warn', 'alerts', 'telegram_not_configured');
    return;
  }

  const emoji = alertEmoji(payload.level);
  const text = buildTelegramMessage(payload, emoji);

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API error: ${res.status} ${err}`);
  }
}
