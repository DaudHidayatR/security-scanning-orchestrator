/**
 * GitHub API utilities for the security scanning pipeline.
 */

import type { GitHubEnv, GitHubInstallationToken, GitHubPullRequestFile } from '../types';
import { signJWT } from './crypto';
import { githubHeaders, githubRequest } from './github-client';

/**
 * Get a GitHub App installation token for API calls.
 * Tokens are valid for 1 hour.
 */
export async function getInstallationToken(
  owner: string,
  repo: string,
  env: GitHubEnv
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJWT(
    {
      iss: env.GITHUB_APP_ID,
      iat: now,
      exp: now + 600,
    },
    env.GITHUB_PRIVATE_KEY
  );

  const installationId = env.GITHUB_APP_INSTALLATION_ID;

  const tokenRes = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: githubHeaders(jwt),
    }
  );

  if (!tokenRes.ok) {
    const error = await tokenRes.text();
    throw new Error(`GitHub token exchange failed: ${tokenRes.status} ${error}`);
  }

  const data = (await tokenRes.json()) as GitHubInstallationToken;
  return data.token;
}

/**
 * Fetch changed files for a pull request.
 */
export async function getPullRequestFiles(
  owner: string,
  repo: string,
  prNumber: number,
  token: string
): Promise<GitHubPullRequestFile[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`;

  const res = await githubRequest(url, token);

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to fetch PR files: ${res.status} ${error}`);
  }

  return (await res.json()) as GitHubPullRequestFile[];
}

/**
 * Post a comment on a pull request.
 */
export async function postPRComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  token: string
): Promise<void> {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;

  const res = await githubRequest(url, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to post PR comment: ${res.status} ${error}`);
  }
}

/**
 * Create a remediation PR with a security fix.
 * Uses the 6-step GitHub Git Data API.
 */
export async function createRemediationPR(
  owner: string,
  repo: string,
  baseBranch: string,
  baseCommitSha: string,
  filePath: string,
  newContent: string,
  title: string,
  body: string,
  token: string
): Promise<{ prNumber: number; branchName: string }> {
  const api = `https://api.github.com/repos/${owner}/${repo}`;

  const blobRes = await githubRequest(`${api}/git/blobs`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: btoa(newContent),
      encoding: 'base64',
    }),
  });
  const blob = (await blobRes.json()) as { sha: string };

  const baseTreeRes = await githubRequest(`${api}/git/trees/${baseCommitSha}`, token);
  const baseTree = (await baseTreeRes.json()) as { sha: string };

  const newTreeRes = await githubRequest(`${api}/git/trees`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_tree: baseTree.sha,
      tree: [
        {
          path: filePath,
          mode: '100644',
          type: 'blob',
          sha: blob.sha,
        },
      ],
    }),
  });
  const newTree = (await newTreeRes.json()) as { sha: string };

  const commitRes = await githubRequest(`${api}/git/commits`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: title,
      tree: newTree.sha,
      parents: [baseCommitSha],
    }),
  });
  const commit = (await commitRes.json()) as { sha: string };

  const branchName = `security-fix-${Date.now()}`;
  await githubRequest(`${api}/git/refs`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: commit.sha,
    }),
  });

  const prRes = await githubRequest(`${api}/pulls`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      body,
      head: branchName,
      base: baseBranch,
    }),
  });
  const pr = (await prRes.json()) as { number: number };

  return { prNumber: pr.number, branchName };
}

/**
 * Detect programming language from file extension.
 */
export function detectLanguage(filename: string): string | undefined {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    go: 'go',
    java: 'java',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    cs: 'csharp',
    cpp: 'cpp',
    c: 'c',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
  };
  return ext ? map[ext] : undefined;
}
