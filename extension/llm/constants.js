// Shared across all providers so "Generating answer..." can never hang
// forever — see llm/client.ts (retry) and each provider's generate/stream
// functions (AbortSignal.timeout). Default for normal per-field answer
// generation, where a quick failure (dead network, crashed local model)
// should surface fast rather than leave the UI spinning.
export const LLM_TIMEOUT_MS = 90000;
// Resume extraction is a heavier one-shot call (the full resume text as
// input, a large structured JSON object as output) — genuinely slower on
// local CPU-only Ollama than a short answer, and the user explicitly
// triggered it, so a longer wait before giving up is the right tradeoff
// here specifically (see llm/client.ts's optional `opts` param).
export const RESUME_EXTRACTION_TIMEOUT_MS = 240000;
// AbortSignal.timeout()'s abort reason is a "TimeoutError" DOMException, and
// that's what the top-level fetch() promise rejects with — but Chrome's
// ReadableStream reader.read() (used while consuming a streaming response
// body) rejects with a plain "AbortError" ("BodyStreamBuffer was aborted")
// instead of propagating that reason, for the exact same abort. Since the
// only abort source in this codebase is the timeout (no user-cancel button),
// treat both names as "this was a timeout" — otherwise the mid-stream case
// falls through to a raw, unhelpful error message instead of a clear one.
export function isTimeoutAbort(e) {
    return e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
}
