import { LLM_TIMEOUT_MS, isTimeoutAbort } from "./constants.js";

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Overrides LLM_TIMEOUT_MS for this call (e.g. resume extraction, a
   *  heavier one-shot call that can legitimately take longer). */
  timeoutMs?: number;
}

export interface AnthropicStreamCallbacks {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

const ANTHROPIC_API = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

export async function anthropicGenerate(
  system: string,
  prompt: string,
  opts: AnthropicOptions,
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS;
  try {
    const r = await fetch(`${ANTHROPIC_API}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: opts.model,
        system,
        messages: [{ role: "user", content: prompt }],
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
      }),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
    const data = await r.json();
    const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
    return (textBlock?.text ?? "").trim();
  } catch (e) {
    if (isTimeoutAbort(e)) throw new Error(`Anthropic request timed out after ${timeoutMs / 1000}s`);
    throw e;
  }
}

export async function anthropicGenerateStream(
  system: string,
  prompt: string,
  opts: AnthropicOptions,
  callbacks: AnthropicStreamCallbacks,
): Promise<void> {
  const r = await fetch(`${ANTHROPIC_API}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    body: JSON.stringify({
      model: opts.model,
      system,
      messages: [{ role: "user", content: prompt }],
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
      stream: true,
    }),
  });
  if (!r.ok) {
    callbacks.onError(`Anthropic ${r.status}: ${await r.text()}`);
    return;
  }
  if (!r.body) {
    callbacks.onError("No response body");
    return;
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        try {
          const obj = JSON.parse(trimmed.slice(6));
          if (obj.type === "content_block_delta" && obj.delta?.text) {
            callbacks.onChunk(obj.delta.text);
          }
          if (obj.type === "message_stop") {
            callbacks.onDone();
            return;
          }
        } catch {}
      }
    }
    callbacks.onDone();
  } catch (e) {
    callbacks.onError(isTimeoutAbort(e) ? `Anthropic request timed out after ${LLM_TIMEOUT_MS / 1000}s` : String(e));
  }
}
