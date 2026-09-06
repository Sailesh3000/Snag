import { LLM_TIMEOUT_MS } from "./constants.js";
export async function ollamaGenerate(system, prompt, opts) {
    const r = await fetch(`${opts.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        body: JSON.stringify({
            model: opts.model,
            system,
            prompt: `/no_think\n${prompt}`,
            stream: false,
            options: {
                num_predict: opts.numPredict ?? 1024,
                temperature: opts.temperature ?? 0.7,
                top_p: opts.topP ?? 0.9,
            },
        }),
    });
    if (!r.ok)
        throw new Error(`Ollama ${r.status}: ${await r.text()}`);
    const data = await r.json();
    let text = (data.response ?? "").trim();
    if (!text && data.thinking)
        text = data.thinking.trim();
    return text;
}
export async function ollamaGenerateStream(system, prompt, opts, callbacks) {
    const r = await fetch(`${opts.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        body: JSON.stringify({
            model: opts.model,
            system,
            prompt: `/no_think\n${prompt}`,
            stream: true,
            options: {
                num_predict: opts.numPredict ?? 1024,
                temperature: opts.temperature ?? 0.7,
                top_p: opts.topP ?? 0.9,
            },
        }),
    });
    if (!r.ok) {
        callbacks.onError(`Ollama ${r.status}: ${await r.text()}`);
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
                if (!line.trim())
                    continue;
                try {
                    const obj = JSON.parse(line);
                    if (obj.response)
                        callbacks.onChunk(obj.response);
                    if (obj.done) {
                        callbacks.onDone();
                        return;
                    }
                }
                catch { }
            }
        }
        if (buffer.trim()) {
            try {
                const obj = JSON.parse(buffer);
                if (obj.response)
                    callbacks.onChunk(obj.response);
            }
            catch { }
        }
        // Stream ended (network EOF) without ever seeing "done": true — still
        // resolve the UI instead of leaving it spinning forever.
        callbacks.onDone();
    }
    catch (e) {
        const timedOut = e instanceof DOMException && e.name === "TimeoutError";
        callbacks.onError(timedOut ? `Ollama request timed out after ${LLM_TIMEOUT_MS / 1000}s` : String(e));
    }
}
