/**
 * Queue consumer router.
 * Dispatches batches to the appropriate worker module via a registry Map.
 */

import type {
  Env,
  ScannerJobMessage,
  AIValidationMessage,
  FixValidationMessage,
  RuleTestingMessage,
} from '../types';
import { log } from '../utils/logger';

import ScannerJobsWorker from '../workers/scanner-jobs';
import AIValidationWorker from '../workers/ai-validation';
import FixValidationWorker from '../workers/fix-validation';
import RuleTestingWorker from '../workers/rule-testing';

type QueueConsumer<T> = (batch: MessageBatch<T>, env: Env, ctx: ExecutionContext) => Promise<void>;

const registry = new Map<string, QueueConsumer<unknown>>([
  ['scanner-jobs', ScannerJobsWorker.queue as QueueConsumer<unknown>],
  ['ai-validation', AIValidationWorker.queue as QueueConsumer<unknown>],
  ['ai-validation-priority', AIValidationWorker.queue as QueueConsumer<unknown>],
  ['fix-validation', FixValidationWorker.queue as QueueConsumer<unknown>],
  ['rule-testing', RuleTestingWorker.queue as QueueConsumer<unknown>],
]);

/**
 * Register an additional queue consumer at runtime.
 */
export function registerQueue(name: string, consumer: QueueConsumer<unknown>): void {
  registry.set(name, consumer);
}

export async function routeQueueBatch(
  batch: MessageBatch<unknown>,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  log('info', 'orchestrator', 'queue_batch_received', {
    queue: batch.queue,
    message_count: batch.messages.length,
  });

  const consumer = registry.get(batch.queue);

  if (consumer) {
    await consumer(batch, env, ctx);
    return;
  }

  log('warn', 'orchestrator', 'unknown_queue', { queue: batch.queue });

  for (const msg of batch.messages) {
    msg.ack();
  }
}
