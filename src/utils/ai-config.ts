/**
 * AI Model Configuration Utility
 *
 * Reads model names from env vars (wrangler.toml [vars] or secrets)
 * and selects the appropriate model per task type and severity.
 */

import type { AIEnv } from '../types';
import { isPriority, type SeverityLevel } from './severity';

export type AITask = 'validate' | 'fix' | 'rule';

export interface AITierConfig {
  model: string;
  timeoutMs: number;
  parallel: boolean;
  maxRetries: number;
}

/**
 * Select the best AI model for a given task and severity.
 *
 * Priority:
 *  1. Premium model for critical findings (AI_MODEL_PREMIUM)
 *  2. Default model (AI_MODEL_DEFAULT)
 */
export function selectModel(
  _task: AITask,
  severity: SeverityLevel,
  env: AIEnv
): string {
  // 1. Premium model for critical / high severity
  if (isPriority(severity) && env.AI_MODEL_PREMIUM) {
    return env.AI_MODEL_PREMIUM;
  }

  // 2. Fallback to default
  return env.AI_MODEL_DEFAULT;
}

/**
 * Select tier configuration based on severity.
 * Critical/high get faster, more aggressive processing.
 */
export function selectTierConfig(severity: SeverityLevel, env: AIEnv): AITierConfig {
  const priority = isPriority(severity);

  return {
    model: priority
      ? (env.AI_MODEL_PREMIUM || env.AI_MODEL_DEFAULT)
      : env.AI_MODEL_DEFAULT,
    timeoutMs: priority ? 5000 : 30000,
    parallel: true,
    maxRetries: priority ? 2 : 1,
  };
}

/**
 * Build the Cloudflare Workers AI REST API URL for a given model.
 */
export function buildAIUrl(model: string, env: AIEnv): string {
  return `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${model}`;
}

/**
 * Call Workers AI with the configured model.
 */
export async function callAI(
  task: AITask,
  severity: SeverityLevel,
  prompt: string,
  env: AIEnv
): Promise<Response> {
  const model = selectModel(task, severity, env);
  const url = buildAIUrl(model, env);

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.CF_AI_API_TOKEN}`,
    },
    body: JSON.stringify({ prompt }),
  });
}
