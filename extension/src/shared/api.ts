/**
 * The extension's ONLY backend client. Every network call to Snag's
 * server goes through here — the revised plan confines the surface to
 * exactly two endpoints (LLM generation is BYOK, never touches the
 * backend — see llm/client.ts):
 *
 *   GET  /api/me      license check: session + subscription status
 *   POST /api/embed   Bedrock Titan embedding, still subscription-gated
 *
 * Auth: Bearer access token with proactive refresh (<60s remaining), a
 * single retry after a 401, then "sign in again". 402 and 429 are mapped
 * to distinct error types so the UI can show "subscribe" vs "rate
 * limited" (plan B4).
 */
import { authConfig } from "./authConfig.js";
import { clearSession, getSession, isFresh, refreshSession } from "./auth.js";

export class AuthError extends Error {}
/** 402 — no active subscription. */
export class SubscriptionRequiredError extends AuthError {}
/** 429 — server-side abuse ceiling for the month. */
export class RateLimitedError extends AuthError {}
/** Any other non-2xx API response. */
export class ApiError extends AuthError {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function fetchWithAuth(path: string, init: RequestInit, retried = false): Promise<Response> {
  let session = await getSession();
  if (!session) throw new AuthError("not signed in");
  if (!isFresh(session)) {
    const refreshed = await refreshSession();
    if (!refreshed) throw new AuthError("session expired — sign in again");
    session = refreshed;
  }

  const resp = await fetch(`${authConfig.apiBaseUrl}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${session.accessToken}` },
  });

  if (resp.status === 401 && !retried) {
    const refreshed = await refreshSession();
    if (refreshed) return fetchWithAuth(path, init, true);
    await clearSession();
    throw new AuthError("session expired — sign in again");
  }
  if (resp.status === 402) throw new SubscriptionRequiredError("subscription required");
  if (resp.status === 429) throw new RateLimitedError("monthly usage limit reached");
  if (!resp.ok) throw new ApiError(`API error ${resp.status}`, resp.status);
  return resp;
}

export interface Me {
  sub: string;
  email: string;
  subscriptionStatus: string;
  currentPeriodEnd: string | null;
}

export async function apiMe(): Promise<Me> {
  const resp = await fetchWithAuth("/api/me", { method: "GET" });
  return (await resp.json()) as Me;
}

export async function apiEmbed(text: string): Promise<number[]> {
  const resp = await fetchWithAuth("/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = (await resp.json()) as { embedding?: unknown };
  if (!Array.isArray(body.embedding) || body.embedding.some((n) => typeof n !== "number")) {
    throw new ApiError("malformed /api/embed response", 200);
  }
  return body.embedding as number[];
}

