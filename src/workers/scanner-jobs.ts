/**
 * Scanner Jobs Queue Consumer
 *
 * Phase 1: Accepts Semgrep CLI JSON output and stores findings in D1.
 *          Also runs a lightweight regex-based scan on patch content
 *          for tools not yet integrated (GitLeaks-style secret detection).
 *
 * Input: ScannerJobMessage with optional semgrep_json field.
 *        If semgrep_json is present, it is parsed directly.
 *        Otherwise, a lightweight patch scan runs as fallback.
 */

import type { Env, ScannerJobMessage, Finding, AIValidationMessage } from '../types';
import { parseSemgrepOutput } from '../utils/semgrep';
import { sendSeverityAlert } from '../utils/alerts';
import { log } from '../utils/logger';
import { createFinding } from '../utils/finding';
import { isPriority, parseSeverity } from '../utils/severity';

export default {
  async queue(batch: MessageBatch<ScannerJobMessage>, env: Env, ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      const job = message.body;

      log('info', 'scanner-jobs', 'job_received', {
        repo: job.repo,
        pr_number: job.pr_number,
        commit_sha: job.commit_sha,
        file_count: job.files.length,
        has_semgrep_json: !!job.semgrep_json,
      });

      try {
        let findings: Omit<Finding, 'id' | 'created_at' | 'updated_at'>[] = [];

        // Primary: Parse Semgrep CLI JSON if provided (e.g. from GitHub Action)
        if (job.semgrep_json) {
          findings = parseSemgrepOutput(job.semgrep_json, job.repo, job.pr_number, job.commit_sha);
          log('info', 'scanner-jobs', 'semgrep_parsed', {
            repo: job.repo,
            findings: findings.length,
          });
        }

        // Fallback: Lightweight regex scan on patch content
        const patchFindings = await runPatchScan(job);
        findings = findings.concat(patchFindings);

        // Store all findings and enqueue AI validation by severity
        const aiPriorityJobs: AIValidationMessage[] = [];
        const aiNormalJobs: AIValidationMessage[] = [];

        for (const finding of findings) {
          const findingId = await storeFinding(env, finding);
          const aiJob = buildAIValidationMessage(findingId, finding, job);

          if (isPriority(parseSeverity(finding.severity || 'medium'))) {
            aiPriorityJobs.push(aiJob);
          } else {
            aiNormalJobs.push(aiJob);
          }
        }

        // Enqueue priority AI validations (critical/high)
        if (aiPriorityJobs.length > 0) {
          await env.aiValidationPriority.sendBatch(
            aiPriorityJobs.map(j => ({ body: j }))
          );
        }

        // Enqueue normal AI validations (medium/low)
        if (aiNormalJobs.length > 0) {
          await env.aiValidation.sendBatch(
            aiNormalJobs.map(j => ({ body: j }))
          );
        }

        // Send severity-aware alert
        const criticalCount = findings.filter(f => f.severity === 'critical').length;
        const highCount = findings.filter(f => f.severity === 'high').length;

        if (criticalCount > 0 || highCount > 0) {
          ctx.waitUntil(
            sendSeverityAlert({
              level: criticalCount > 0 ? 'critical' : 'error',
              title: `Security findings in ${job.repo}`,
              message: `Found ${criticalCount} critical and ${highCount} high severity issues in ${job.files.length} files.`,
              repo: job.repo,
              prNumber: job.pr_number > 0 ? job.pr_number : undefined,
              findingCount: findings.length,
              details: {
                commit: job.commit_sha.slice(0, 7),
                files: job.files.length,
                critical: criticalCount,
                high: highCount,
              },
            }, env)
          );
        }

        log('info', 'scanner-jobs', 'job_completed', {
          repo: job.repo,
          pr_number: job.pr_number,
          findings: findings.length,
          critical: criticalCount,
          high: highCount,
        });

        message.ack();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log('error', 'scanner-jobs', 'job_failed', {
          repo: job.repo,
          pr_number: job.pr_number,
          error: errorMsg,
        });

        message.retry({ delaySeconds: 60 });
      }
    }
  },
};

/**
 * Lightweight regex-based scan on patch content.
 * Catches patterns that Semgrep might miss or when Semgrep JSON is not provided.
 */
async function runPatchScan(
  job: ScannerJobMessage
): Promise<Omit<Finding, 'id' | 'created_at' | 'updated_at'>[]> {
  const findings: Omit<Finding, 'id' | 'created_at' | 'updated_at'>[] = [];

  for (const file of job.files) {
    if (!file.language || !file.patch) continue;

    const lines = file.patch.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect eval() usage
      if (/^\+.*\beval\s*\(/.test(line)) {
        findings.push(createFinding(job, file.filename, i + 1, 'semgrep',
          'javascript.lang.security.audit.eval-usage',
          'high',
          'Use of eval() can lead to remote code execution. Use safer alternatives like JSON.parse().'));
      }

      // Detect hardcoded secrets (GitLeaks-style)
      if (/^\+.*\b(api[_-]?key|password|secret|token)\s*[:=]\s*['"][^'"]{8,}['"]/i.test(line)) {
        findings.push(createFinding(job, file.filename, i + 1, 'gitleaks',
          'generic-api-key',
          'critical',
          'Potential hardcoded secret detected. Use environment variables or a secret manager.'));
      }

      // Detect SQL injection patterns
      if (/^\+.*\b(query|exec)\s*\(.*\+/ .test(line) || /^\+.*\bSELECT\b.*\+/.test(line)) {
        findings.push(createFinding(job, file.filename, i + 1, 'semgrep',
          'javascript.lang.security.audit.sqli',
          'high',
          'Possible SQL injection. Use parameterized queries or an ORM.'));
      }

      // Detect insecure crypto (MD5, SHA1)
      if (/^\+.*\bcreateHash\s*\(\s*['"](md5|sha1)['"]/.test(line)) {
        findings.push(createFinding(job, file.filename, i + 1, 'semgrep',
          'javascript.lang.security.audit.insecure-crypto',
          'medium',
          'Insecure hashing algorithm detected. Use SHA-256 or bcrypt instead.'));
      }

      // Detect unsafe deserialization
      if (/^\+.*\bJSON\.parse\s*\(.*\b(req\.body|req\.query)/.test(line)) {
        findings.push(createFinding(job, file.filename, i + 1, 'semgrep',
          'javascript.lang.security.audit.unsafe-deserialization',
          'medium',
          'Parsing user input without validation can lead to prototype pollution.'));
      }
    }
  }

  return findings;
}

function buildAIValidationMessage(
  findingId: number,
  finding: Omit<Finding, 'id' | 'created_at' | 'updated_at'>,
  job: ScannerJobMessage
): AIValidationMessage {
  return {
    finding_id: findingId,
    repo: job.repo,
    owner: job.owner,
    pr_number: job.pr_number,
    tool: finding.tool,
    rule_id: finding.rule_id,
    severity: finding.severity || 'medium',
    message: finding.message || '',
    file: finding.file,
    line: finding.line || 0,
    code_context: '', // Populated in Phase 3 when fetching file content
    language: 'typescript', // Detected properly in Phase 3
    priority: (finding.severity as 'critical' | 'high' | 'medium' | 'low') || 'medium',
  };
}

async function storeFinding(
  env: Env,
  finding: Omit<Finding, 'id' | 'created_at' | 'updated_at'>
): Promise<number> {
  const result = await env.DB.prepare(
    `INSERT INTO findings
     (repo, pr_number, commit_sha, file, line, tool, rule_id, severity, message, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`
  )
    .bind(
      finding.repo,
      finding.pr_number,
      finding.commit_sha,
      finding.file,
      finding.line,
      finding.tool,
      finding.rule_id,
      finding.severity,
      finding.message,
      finding.status
    )
    .first<{ id: number }>();

  return result?.id ?? 0;
}
