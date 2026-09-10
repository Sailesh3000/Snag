/**
 * The extension's ONLY backend client. Every network call to Snag's
 * server goes through here — plan B3 confines the surface to exactly
 * three endpoints:
 *
 *   GET  /api/me               session + subscription status
 *   POST /api/answer/generate  SSE-streamed LLM completion
 *   POST /api/embed            OpenAI text-embedding-3-small
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

export interface GenerateOptions {
  systemPrompt: string;
  prompt: string;
  question: string;
  company?: string;
  role?: string;
  questionType?: string;
  onChunk?: (chunk: string) => void;
}

/**
 * Streaming answer generation.
 *
 * SSE contract (matched by the backend, Phase 2): each event is
 * `data: {"text": "..."}` and the stream ends with `data: [DONE]`. A
 * `{"error": "..."}` event aborts with an ApiError. If the response is
 * not text/event-stream (e.g. a plain-JSON error path), the whole body is
 * returned as a single chunk.
 */
export async function apiGenerateAnswer(opts: GenerateOptions): Promise<string> {
  const resp = await fetchWithAuth("/api/answer/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      systemPrompt: opts.systemPrompt,
      prompt: opts.prompt,
      question: opts.question,
      company: opts.company ?? "",
      role: opts.role ?? "",
      questionType: opts.questionType ?? "",
    }),
  });

  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const text = await resp.text();
    opts.onChunk?.(text);
    return text;
  }
  return readSseStream(resp, opts.onChunk);
}

async function readSseStream(resp: Response, onChunk?: (chunk: string) => void): Promise<string> {
  if (!resp.body) throw new ApiError("SSE response has no body", 200);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  const consumeEvent = (rawEvent: string): void => {
    // SSE allows multiple `data:` lines per event; join with newlines.
    const dataLines = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n").trim();
    if (data === "[DONE]") return;
    const parsed = JSON.parse(data) as { text?: unknown; error?: unknown };
    if (typeof parsed.error === "string" && parsed.error) {
      throw new ApiError(`stream error: ${parsed.error}`, 500);
    }
    const text = typeof parsed.text === "string" ? parsed.text : "";
    if (text) {
      full += text;
      onChunk?.(text);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      consumeEvent(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
  }
  if (buffer.trim()) consumeEvent(buffer);
  return full;
}
