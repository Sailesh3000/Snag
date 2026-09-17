/**
 * The extension's ONLY backend client. Every network call to Snag's
 * server goes through here — the surface is exactly two endpoints (LLM
 * generation is BYOK, never touches the backend — see llm/client.ts):
 *
 *   GET  /api/me      identity check: confirms the token is valid
 *   POST /api/embed   Bedrock Titan embedding, gated on being signed in
 *                     plus a daily abuse ceiling (cost protection only —
 *                     the product is free, there's no paid tier)
 *
 * Auth: Bearer access token with proactive refresh (<60s remaining), a
 * single retry after a 401, then "sign in again".
 */
import { authConfig } from "./authConfig.js";
import { clearSession, getSession, isFresh, refreshSession } from "./auth.js";

export class AuthError extends Error {}
/** 429 — daily abuse ceiling on /api/embed (Bedrock cost protection). */
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
  if (resp.status === 429) throw new RateLimitedError("daily usage limit reached");
  if (!resp.ok) throw new ApiError(`API error ${resp.status}`, resp.status);
  return resp;
}

export interface Me {
  sub: string;
  email: string;
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

