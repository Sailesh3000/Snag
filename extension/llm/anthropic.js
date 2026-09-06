import { LLM_TIMEOUT_MS } from "./constants.js";
const ANTHROPIC_API = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
export async function anthropicGenerate(system, prompt, opts) {
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
        }),
    });
    if (!r.ok)
        throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
    const data = await r.json();
    const textBlock = data.content?.find((b) => b.type === "text");
    return (textBlock?.text ?? "").trim();
}
export async function anthropicGenerateStream(system, prompt, opts, callbacks) {
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
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data: "))
                    continue;
                try {
                    const obj = JSON.parse(trimmed.slice(6));
                    if (obj.type === "content_block_delta" && obj.delta?.text) {
                        callbacks.onChunk(obj.delta.text);
                    }
                    if (obj.type === "message_stop") {
                        callbacks.onDone();
                        return;
                    }
                }
                catch { }
            }
        }
        callbacks.onDone();
    }
    catch (e) {
        const timedOut = e instanceof DOMException && e.name === "TimeoutError";
        callbacks.onError(timedOut ? `Anthropic request timed out after ${LLM_TIMEOUT_MS / 1000}s` : String(e));
    }
}
