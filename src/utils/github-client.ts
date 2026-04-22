/**
 * GitHub API client helpers.
 * Injects standard headers and handles common request patterns.
 */

const GITHUB_API_VERSION = '2022-11-28';

/**
 * Build standard GitHub API request headers.
 */
export function githubHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    ...extra,
  };
}

/**
 * Perform a GitHub API request with standard headers.
 *
 * @param url     - Full URL to fetch
 * @param token   - GitHub access token
 * @param options - Standard fetch options (method, body, etc.)
 */
export async function githubRequest(
  url: string,
  token: string,
  options?: RequestInit
): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      ...githubHeaders(token, options?.headers as Record<string, string> | undefined),
    },
  });
}
