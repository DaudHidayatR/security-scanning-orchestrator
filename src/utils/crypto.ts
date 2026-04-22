/**
 * Cryptographic utilities using Web Crypto API.
 * All operations are safe for Cloudflare Workers V8 isolates.
 */

/**
 * Verify GitHub webhook signature using HMAC-SHA256.
 *
 * @param payload - Raw request body as string
 * @param signature - Value of X-Hub-Signature-256 header (e.g. "sha256=abc123...")
 * @param secret - GITHUB_WEBHOOK_SECRET
 * @returns true if signature is valid
 */
export async function verifyGitHubWebhook(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const expectedSig = signature.startsWith('sha256=') ? signature.slice(7) : signature;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(payload);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const actualSig = arrayBufferToHex(signatureBuffer);

  // Constant-time comparison to prevent timing attacks
  return timingSafeEqual(actualSig, expectedSig);
}

/**
 * Sign a JWT with RS256 using a PEM private key.
 * Used for GitHub App authentication.
 */
export async function signJWT(
  payload: Record<string, unknown>,
  privateKeyPem: string
): Promise<string> {
  const encoder = new TextEncoder();

  // Clean PEM formatting
  const cleanPem = privateKeyPem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
    .replace(/-----END RSA PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');

  const keyBuffer = base64ToArrayBuffer(cleanPem);

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const header = { alg: 'RS256', typ: 'JWT' };
  const body = { ...payload, iat: Math.floor(Date.now() / 1000) };

  const encodedHeader = btoa(JSON.stringify(header)).replace(/=+$/, '');
  const encodedPayload = btoa(JSON.stringify(body)).replace(/=+$/, '');
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    encoder.encode(signingInput)
  );

  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=+$/, '');

  return `${signingInput}.${encodedSignature}`;
}

/**
 * Sign a simple HMAC JWT for sandbox authentication.
 */
export async function signSandboxJWT(
  payload: { action: string; repo: string; exp: number },
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=+$/, '');
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/=+$/, '');
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(signingInput));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=+$/, '');

  return `${signingInput}.${encodedSignature}`;
}

/**
 * Compute SHA-256 hash of a string.
 */
export async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return arrayBufferToHex(hashBuffer);
}

// --- Helpers ---

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
