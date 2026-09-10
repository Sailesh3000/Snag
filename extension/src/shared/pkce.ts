/**
 * PKCE (RFC 7636) helpers for the Cognito authorization-code flow.
 *
 * A Cognito user-pool client with `GenerateSecret = false` (public client)
 * MUST use PKCE for the authorization-code grant. These helpers produce
 * the code verifier / S256 challenge pair. `crypto.subtle` and
 * `crypto.getRandomValues` are available in the MV3 service worker and in
 * the Node environment used by vitest, so no browser-only shim is needed.
 */

const UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** base64url (RFC 4648 §5) without padding. */
export function base64urlEncode(data: Uint8Array): string {
  let bin = "";
  for (const byte of data) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Random string over the RFC 7636 unreserved charset, uniform per char. */
export function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += UNRESERVED[b % UNRESERVED.length];
  return out;
}

/**
 * Code verifier: 64 chars of unreserved random data. We derive it from
 * 48 random bytes encoded base64url (which yields exactly 64 chars from a
 * 64-symbol alphabet, i.e. uniform without modulo bias) — comfortably
 * inside the 43–128 length range.
 */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

/** S256 code challenge: BASE64URL(SHA-256(ASCII(verifier))). */
export async function codeChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64urlEncode(new Uint8Array(digest));
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export async function generatePkcePair(): Promise<PkcePair> {
  const codeVerifier = generateCodeVerifier();
  return { codeVerifier, codeChallenge: await codeChallengeFor(codeVerifier) };
}
