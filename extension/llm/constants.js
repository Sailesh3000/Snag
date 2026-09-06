// Shared across all providers so "Generating answer..." can never hang
// forever — see llm/client.ts (retry) and each provider's generate/stream
// functions (AbortSignal.timeout). Local models (Ollama, no GPU) and
// larger prompts (e.g. resume field extraction) can legitimately take a
// while, so this is generous rather than tight.
export const LLM_TIMEOUT_MS = 90000;
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
