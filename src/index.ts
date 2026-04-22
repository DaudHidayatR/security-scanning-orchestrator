/**
 * Orchestrator Worker Entry Point
 *
 * Thin delegation layer that routes fetch/scheduled/queue events
 * to the appropriate handler modules.
 */

import type { Env } from './types';
import { log } from './utils/logger';
import { handleWebhook } from './handlers/webhook';
import { routeQueueBatch } from './handlers/queue-router';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/health') {
        return Response.json({ status: 'ok', version: '0.1.0', phase: 1 });
      }

      if (url.pathname === '/webhook' && request.method === 'POST') {
        return handleWebhook(request, env, ctx);
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      log('error', 'orchestrator', 'unhandled_exception', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      return new Response('Internal Server Error', { status: 500 });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 0 * * *') {
      await env.CACHE.put('neurons:today', '0');
      log('info', 'orchestrator', 'neuron_counter_reset', {
        timestamp: new Date().toISOString(),
      });
    }
  },

  async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext): Promise<void> {
    await routeQueueBatch(batch, env, ctx);
  },
};
