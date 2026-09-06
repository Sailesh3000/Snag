// Shared across all providers so "Generating answer..." can never hang
// forever — see llm/client.ts (retry) and each provider's generate/stream
// functions (AbortSignal.timeout).
export const LLM_TIMEOUT_MS = 45000;
