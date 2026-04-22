/**
 * Finding factory.
 * Creates a Finding with all nullable fields pre-initialised to safe defaults.
 */

import type { Finding } from '../types';

export interface FindingContext {
  repo: string;
  pr_number: number;
  commit_sha: string;
}

/**
 * Create a Finding from scanner output, pre-filling all nullable defaults.
 */
export function createFinding(
  ctx: FindingContext,
  file: string,
  line: number,
  tool: string,
  ruleId: string,
  severity: string,
  message: string
): Omit<Finding, 'id' | 'created_at' | 'updated_at'> {
  return {
    repo: ctx.repo,
    pr_number: ctx.pr_number,
    commit_sha: ctx.commit_sha,
    file,
    line,
    tool,
    rule_id: ruleId,
    severity,
    message,
    status: 'open',
  };
}
