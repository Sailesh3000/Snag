import { LLM_TIMEOUT_MS, isTimeoutAbort } from "./constants.js";
export async function openaiGenerate(system, prompt, opts) {
    try {
        const r = await fetch(`${opts.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${opts.apiKey}`,
            },
            signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
            body: JSON.stringify({
                model: opts.model,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: prompt },
                ],
                stream: false,
                temperature: opts.temperature ?? 0.7,
                top_p: opts.topP ?? 0.9,
                max_tokens: opts.maxTokens ?? 1024,
            }),
        });
        if (!r.ok)
            throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
        const data = await r.json();
        return (data.choices?.[0]?.message?.content ?? "").trim();
    }
    catch (e) {
        if (isTimeoutAbort(e))
            throw new Error(`OpenAI request timed out after ${LLM_TIMEOUT_MS / 1000}s`);
        throw e;
    }
}
export async function openaiGenerateStream(system, prompt, opts, callbacks) {
    const r = await fetch(`${opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${opts.apiKey}`,
        },
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        body: JSON.stringify({
            model: opts.model,
            messages: [
                { role: "system", content: system },
                { role: "user", content: prompt },
            ],
            stream: true,
            temperature: opts.temperature ?? 0.7,
            top_p: opts.topP ?? 0.9,
            max_tokens: opts.maxTokens ?? 1024,
        }),
    });
    if (!r.ok) {
        callbacks.onError(`OpenAI ${r.status}: ${await r.text()}`);
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
                const data = trimmed.slice(6);
                if (data === "[DONE]") {
                    callbacks.onDone();
                    return;
                }
                try {
                    const obj = JSON.parse(data);
                    const delta = obj.choices?.[0]?.delta?.content;
                    if (delta)
                        callbacks.onChunk(delta);
                }
                catch { }
            }
        }
        callbacks.onDone();
    }
    catch (e) {
        callbacks.onError(isTimeoutAbort(e) ? `OpenAI request timed out after ${LLM_TIMEOUT_MS / 1000}s` : String(e));
    }
}
