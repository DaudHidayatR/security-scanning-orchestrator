/**
 * AI Validation Queue Consumer (Phase 1 Stub with Tiered Escalation)
 *
 * Phase 3 will implement:
 *  - Workers AI REST API calls
 *  - Exploitability assessment
 *  - Fix patch generation
 *  - Enqueue fix-validation for generated fixes
 */

import type { Env, AIValidationMessage } from '../types';
import { selectModel, selectTierConfig } from '../utils/ai-config';
import { parseSeverity } from '../utils/severity';

export default {
  async queue(batch: MessageBatch<AIValidationMessage>, env: Env, ctx: ExecutionContext): Promise<void> {
    const isPriorityQueue = batch.queue === 'ai-validation-priority';

    console.log(JSON.stringify({
      level: 'info',
      worker: 'ai-validation',
      event: 'batch_received',
      queue: batch.queue,
      message_count: batch.messages.length,
      is_priority: isPriorityQueue,
    }));

    // Process all messages in parallel within the batch
    await Promise.all(batch.messages.map(async (message) => {
      const job = message.body;

      // Show which model would be selected (Phase 3 will actually call it)
      const severity = parseSeverity(job.severity || 'medium');
      const model = selectModel('validate', severity, env);
      const tier = selectTierConfig(severity, env);

      console.log(JSON.stringify({
        level: 'info',
        worker: 'ai-validation',
        event: 'job_received',
        finding_id: job.finding_id,
        repo: job.repo,
        tool: job.tool,
        rule_id: job.rule_id,
        severity: job.severity,
        priority: job.priority,
        selected_model: model,
        tier_timeout: tier.timeoutMs,
        tier_parallel: tier.parallel,
      }));

      // Phase 1: Log and acknowledge
      // Phase 3 implementation will:
      // 1. Call Workers AI via callAI('validate', severity, prompt, env)
      // 2. If exploitable, generate fix patch
      // 3. Update D1 with ai_valid, ai_confidence, fix_patch
      // 4. Enqueue fix-validation if patch generated

      message.ack();
    }));
  },
};
