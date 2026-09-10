/**
 * Cognito sign-in + session lifecycle for the extension (migration plan B2).
 *
 * Flow: chrome.identity.launchWebAuthFlow opens Cognito's Hosted UI in a
 * popup, the code is exchanged DIRECTLY against Cognito's token endpoint
 * (the backend never touches login — it only verifies the JWT at the API
 * Gateway authorizer), and the resulting tokens live in
 * chrome.storage.local["session"], a separate key from the "settings" blob.
 *
 * The mechanics run in the background service worker; UI pages (Sidebar,
 * Options "Account & Billing") only send auth:* messages.
 */
import { authConfig, getRedirectUri, OAUTH_SCOPES, type AuthConfig } from "./authConfig.js";
import { generatePkcePair, randomString } from "./pkce.js";

export interface Session {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  /** Access-token expiry, epoch ms. */
  expiresAt: number;
  sub: string;
  email: string;
}

const SESSION_KEY = "session";
// chrome.storage.session: in-memory, wiped when the browser closes, and
// readable from the service worker — right durability for a PKCE verifier
// that must survive the popup round-trip but never touch disk.
const PENDING_KEY = "pendingAuth";

/** Refresh proactively this long before the access token actually dies
 *  (plan B2: proactive refresh at <60s remaining). */
export const REFRESH_SKEW_MS = 60_000;

export async function getSession(): Promise<Session | null> {
  const data = await chrome.storage.local.get(SESSION_KEY);
  return (data[SESSION_KEY] as Session) ?? null;
}

async function saveSession(session: Session): Promise<void> {
  await chrome.storage.local.set({ [SESSION_KEY]: session });
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove(SESSION_KEY);
  await chrome.storage.session.remove(PENDING_KEY);
}

export function isFresh(session: Session, now: number = Date.now()): boolean {
  return session.expiresAt - now > REFRESH_SKEW_MS;
}

/**
 * Decode a JWT payload WITHOUT verifying the signature. Cognito is the
 * only verifier that matters (the API Gateway authorizer), so the
 * extension just reads claims out of the id_token.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const segment = token.split(".")[1];
  if (!segment) throw new Error("malformed JWT");
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

interface TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in: number;
}

function tokenEndpoint(config: AuthConfig): string {
  return `${config.cognitoDomain}/oauth2/token`;
}

/**
 * Build the Hosted UI authorize URL. Pure — takes every input as a
 * parameter so tests can assert the exact query string.
 */
export function buildAuthorizeUrl(
  config: AuthConfig,
  parts: { codeChallenge: string; state: string; nonce: string; redirectUri: string },
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: OAUTH_SCOPES,
    redirect_uri: parts.redirectUri,
    state: parts.state,
    nonce: parts.nonce,
    code_challenge: parts.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${config.cognitoDomain}/oauth2/authorize?${params.toString()}`;
}

/**
 * Convert a Cognito token response into a stored Session. Cognito does not
 * always return a new refresh_token (rotation is pool-configured), so keep
 * the previous one when the response omits it.
 */
export function sessionFromTokenResponse(r: TokenResponse, previous: Session | null = null): Session {
  let claims: Record<string, unknown> = {};
  try {
    if (r.id_token) claims = decodeJwtPayload(r.id_token);
  } catch {
    // No id_token (e.g. refresh response) — fall back to previous claims.
  }
  return {
    idToken: r.id_token ?? previous?.idToken ?? "",
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? previous?.refreshToken ?? "",
    expiresAt: Date.now() + r.expires_in * 1000,
    sub: typeof claims.sub === "string" ? claims.sub : previous?.sub ?? "",
    email: typeof claims.email === "string" ? claims.email : previous?.email ?? "",
  };
}

async function postToken(config: AuthConfig, form: Record<string, string>): Promise<TokenResponse> {
  const resp = await fetch(tokenEndpoint(config), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  if (!resp.ok) {
    let detail = `token endpoint returned ${resp.status}`;
    try {
      const j = (await resp.json()) as { error_description?: string; error?: string };
      if (j.error_description || j.error) detail = `${j.error} ${j.error_description ?? ""}`.trim();
    } catch {}
    const err = new Error(detail) as Error & { status: number };
    err.status = resp.status;
    throw err;
  }
  return (await resp.json()) as TokenResponse;
}

interface PendingAuth {
  codeVerifier: string;
  state: string;
  startedAt: number;
}

/**
 * Full interactive sign-in: open Hosted UI, exchange the returned code,
 * store the session, and return it. Throws on user cancel, OAuth errors,
 * or state mismatch.
 */
export async function startSignIn(config: AuthConfig = authConfig): Promise<Session> {
  const { codeVerifier, codeChallenge } = await generatePkcePair();
  const state = randomString(24);
  const nonce = randomString(24);
  await chrome.storage.session.set({ [PENDING_KEY]: { codeVerifier, state, startedAt: Date.now() } as PendingAuth });

  const authorizeUrl = buildAuthorizeUrl(config, {
    codeChallenge,
    state,
    nonce,
    redirectUri: getRedirectUri(),
  });

  const redirectUrl = await chrome.identity.launchWebAuthFlow({ url: authorizeUrl, interactive: true });
  if (!redirectUrl) throw new Error("sign-in failed: no redirect URL (user cancelled?)");

  const data = await chrome.storage.session.get(PENDING_KEY);
  await chrome.storage.session.remove(PENDING_KEY);
  const pending = data[PENDING_KEY] as PendingAuth | undefined;

  const url = new URL(redirectUrl);
  const oauthError = url.searchParams.get("error");
  if (oauthError) throw new Error(`sign-in failed: ${oauthError}`);
  if (url.searchParams.get("state") !== pending?.state) {
    throw new Error("sign-in failed: state mismatch");
  }
  const code = url.searchParams.get("code");
  if (!code) throw new Error("sign-in failed: no authorization code in redirect");
  if (!pending) throw new Error("sign-in failed: missing pending auth state");

  const tokens = await postToken(config, {
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: getRedirectUri(),
    code_verifier: pending.codeVerifier,
  });
  const session = sessionFromTokenResponse(tokens, await getSession());
  await saveSession(session);
  return session;
}

/**
 * Refresh the access token with the stored refresh token. Returns the new
 * session, or null when re-auth is required (no refresh token, or Cognito
 * rejected it). Network failures return null WITHOUT clearing the session
 * — the next call can retry.
 */
export async function refreshSession(config: AuthConfig = authConfig): Promise<Session | null> {
  const previous = await getSession();
  if (!previous?.refreshToken) return null;
  try {
    const tokens = await postToken(config, {
      grant_type: "refresh_token",
      client_id: config.clientId,
      refresh_token: previous.refreshToken,
      redirect_uri: getRedirectUri(),
    });
    const next = sessionFromTokenResponse(tokens, previous);
    await saveSession(next);
    return next;
  } catch (e) {
    // 4xx from the token endpoint means the grant is dead (revoked,
    // expired past the pool's refresh-token validity) — drop the session.
    // Transient network errors keep it.
    if (e instanceof Error && typeof (e as Error & { status?: number }).status === "number" && (e as Error & { status: number }).status < 500) {
      await clearSession();
    }
    return null;
  }
}

/** Best-effort revocation of the refresh token, then local cleanup. */
export async function signOut(config: AuthConfig = authConfig): Promise<void> {
  const session = await getSession();
  if (session?.refreshToken) {
    try {
      await postToken(config, {
        grant_type: "revocation",
        client_id: config.clientId,
        token: session.refreshToken,
      });
    } catch {
      // Revocation is best-effort; always clear locally.
    }
  }
  await clearSession();
}
