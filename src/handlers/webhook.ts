/**
 * Webhook handler.
 * Verifies GitHub signatures, parses payloads, and enqueues scanner jobs.
 */

import type {
  Env,
  GitHubPullRequestPayload,
  GitHubPushPayload,
  ScannerJobMessage,
  ChangedFile,
} from '../types';

import { verifyGitHubWebhook, sha256 } from '../utils/crypto';
import { getInstallationToken, getPullRequestFiles, detectLanguage } from '../utils/github';
import { isScannableFile } from '../utils/path-filter';
import { log } from '../utils/logger';
import { logWebhookDelivery } from '../utils/webhook-log';

export async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const eventType = request.headers.get('X-GitHub-Event') || 'unknown';
  const deliveryId = request.headers.get('X-GitHub-Delivery') || null;
  const signature = request.headers.get('X-Hub-Signature-256') || '';

  const rawBody = await request.text();

  const signatureValid = await verifyGitHubWebhook(
    rawBody,
    signature,
    env.GITHUB_WEBHOOK_SECRET
  );

  if (!signatureValid) {
    await logWebhookDelivery(env, {
      delivery_id: deliveryId,
      event: eventType,
      action: null,
      repo: 'unknown',
      pr_number: null,
      payload_hash: await sha256(rawBody),
      status: 'failed',
      error_message: 'Invalid webhook signature',
    });

    return new Response('Invalid signature', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON payload', { status: 400 });
  }

  if (eventType === 'pull_request') {
    const prPayload = payload as GitHubPullRequestPayload;
    return handlePullRequestWebhook(prPayload, deliveryId, rawBody, env, ctx);
  }

  if (eventType === 'push') {
    const pushPayload = payload as GitHubPushPayload;
    return handlePushWebhook(pushPayload, deliveryId, rawBody, env, ctx);
  }

  const unknownPayload = payload as Record<string, unknown>;
  const repoName =
    typeof unknownPayload?.repository === 'object' &&
    unknownPayload.repository !== null &&
    'full_name' in unknownPayload.repository
      ? String((unknownPayload.repository as Record<string, unknown>).full_name)
      : 'unknown';

  await logWebhookDelivery(env, {
    delivery_id: deliveryId,
    event: eventType,
    action: null,
    repo: repoName,
    pr_number: null,
    payload_hash: await sha256(rawBody),
    status: 'completed',
    error_message: null,
  });

  return new Response('Event ignored', { status: 200 });
}

async function handlePullRequestWebhook(
  payload: GitHubPullRequestPayload,
  deliveryId: string | null,
  rawBody: string,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const action = payload.action;
  const repo = payload.repository.full_name;
  const owner = payload.repository.owner.login;
  const prNumber = payload.pull_request.number;
  const headSha = payload.pull_request.head.sha;
  const baseRef = payload.pull_request.base.ref;
  const headRef = payload.pull_request.head.ref;

  if (action !== 'opened' && action !== 'synchronize') {
    await logWebhookDelivery(env, {
      delivery_id: deliveryId,
      event: 'pull_request',
      action,
      repo,
      pr_number: prNumber,
      payload_hash: await sha256(rawBody),
      status: 'completed',
      error_message: `Ignored action: ${action}`,
    });
    return new Response('Action ignored', { status: 200 });
  }

  await logWebhookDelivery(env, {
    delivery_id: deliveryId,
    event: 'pull_request',
    action,
    repo,
    pr_number: prNumber,
    payload_hash: await sha256(rawBody),
    status: 'processing',
    error_message: null,
  });

  let files: ChangedFile[] = [];
  try {
    const token = await getInstallationToken(owner, payload.repository.name, env);
    const prFiles = await getPullRequestFiles(owner, payload.repository.name, prNumber, token);

    files = prFiles
      .filter(f => isScannableFile(f.filename))
      .map(f => ({
        filename: f.filename,
        status: f.status as ChangedFile['status'],
        patch: f.patch,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        previous_filename: f.previous_filename,
        language: detectLanguage(f.filename),
      }));
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log('error', 'orchestrator', 'fetch_pr_files_failed', {
      repo,
      pr_number: prNumber,
      error: errorMsg,
    });

    await logWebhookDelivery(env, {
      delivery_id: deliveryId,
      event: 'pull_request',
      action,
      repo,
      pr_number: prNumber,
      payload_hash: await sha256(rawBody),
      status: 'failed',
      error_message: `Failed to fetch PR files: ${errorMsg}`,
    });

    return new Response(`Failed to fetch PR files: ${errorMsg}`, { status: 500 });
  }

  if (files.length === 0) {
    await logWebhookDelivery(env, {
      delivery_id: deliveryId,
      event: 'pull_request',
      action,
      repo,
      pr_number: prNumber,
      payload_hash: await sha256(rawBody),
      status: 'completed',
      error_message: 'No scannable files in PR',
    });
    return new Response('No scannable files', { status: 200 });
  }

  const jobMessage: ScannerJobMessage = {
    repo,
    owner,
    pr_number: prNumber,
    commit_sha: headSha,
    base_ref: baseRef,
    head_ref: headRef,
    files,
    delivery_id: deliveryId || undefined,
  };

  try {
    await env.scannerJobs.send(jobMessage);
    log('info', 'orchestrator', 'scanner_job_enqueued', {
      repo,
      pr_number: prNumber,
      file_count: files.length,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log('error', 'orchestrator', 'enqueue_failed', {
      repo,
      pr_number: prNumber,
      error: errorMsg,
    });

    await logWebhookDelivery(env, {
      delivery_id: deliveryId,
      event: 'pull_request',
      action,
      repo,
      pr_number: prNumber,
      payload_hash: await sha256(rawBody),
      status: 'failed',
      error_message: `Failed to enqueue scan: ${errorMsg}`,
    });

    return new Response(`Failed to enqueue scan: ${errorMsg}`, { status: 500 });
  }

  await logWebhookDelivery(env, {
    delivery_id: deliveryId,
    event: 'pull_request',
    action,
    repo,
    pr_number: prNumber,
    payload_hash: await sha256(rawBody),
    status: 'completed',
    error_message: null,
  });

  return Response.json({
    status: 'ok',
    repo,
    pr_number: prNumber,
    files_scanned: files.length,
    queued: true,
  });
}

async function handlePushWebhook(
  payload: GitHubPushPayload,
  deliveryId: string | null,
  rawBody: string,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const repo = payload.repository.full_name;
  const owner = payload.repository.owner.login;
  const ref = payload.ref;

  if (!ref.endsWith('/main') && !ref.endsWith('/master')) {
    return new Response('Branch ignored', { status: 200 });
  }

  const allFiles = new Set<string>();
  for (const commit of payload.commits) {
    for (const f of commit.added) allFiles.add(f);
    for (const f of commit.modified) allFiles.add(f);
  }

  if (allFiles.size === 0) {
    return new Response('No files changed', { status: 200 });
  }

  const files: ChangedFile[] = Array.from(allFiles)
    .filter(isScannableFile)
    .map(f => ({
      filename: f,
      status: 'modified' as const,
      additions: 0,
      deletions: 0,
      changes: 0,
      language: detectLanguage(f),
    }));

  const jobMessage: ScannerJobMessage = {
    repo,
    owner,
    pr_number: 0,
    commit_sha: payload.after,
    base_ref: ref,
    head_ref: ref,
    files,
    delivery_id: deliveryId || undefined,
  };

  await env.scannerJobs.send(jobMessage);

  await logWebhookDelivery(env, {
    delivery_id: deliveryId,
    event: 'push',
    action: null,
    repo,
    pr_number: null,
    payload_hash: await sha256(rawBody),
    status: 'completed',
    error_message: null,
  });

  return Response.json({
    status: 'ok',
    repo,
    commit: payload.after,
    files_scanned: files.length,
    queued: true,
  });
}
