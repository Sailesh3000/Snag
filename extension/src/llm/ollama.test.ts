import { describe, expect, it, vi, afterEach } from "vitest";
import { ollamaGenerateStream } from "./ollama.js";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

function fakeResponse(body: ReadableStream<Uint8Array>, ok = true): Response {
  return { ok, body, text: async () => "" } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ollamaGenerateStream", () => {
  it("calls onDone exactly once when the server sends done:true", async () => {
    const chunks = [
      JSON.stringify({ response: "Hello " }) + "\n",
      JSON.stringify({ response: "world", done: true }) + "\n",
    ];
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(streamFromChunks(chunks))));

    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await ollamaGenerateStream("sys", "prompt", { baseUrl: "http://x", model: "m" }, { onChunk, onDone, onError });

    expect(onChunk).toHaveBeenCalledWith("Hello ");
    expect(onChunk).toHaveBeenCalledWith("world");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("still calls onDone if the stream ends without done:true (truncated response)", async () => {
    // Regression test: this used to hang forever because onDone was only
    // ever called from inside `if (obj.done)`.
    const chunks = [JSON.stringify({ response: "Hello" }) + "\n"];
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(streamFromChunks(chunks))));

    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await ollamaGenerateStream("sys", "prompt", { baseUrl: "http://x", model: "m" }, { onChunk, onDone, onError });

    expect(onChunk).toHaveBeenCalledWith("Hello");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("propagates a timeout abort (before any response) so the caller's fallback/retry can run — never hangs silently", async () => {
    // A timeout that fires before fetch() even resolves throws from the
    // `await fetch(...)` call itself, same as openai.ts/anthropic.ts — the
    // caller (background/index.ts) catches this and falls back to the
    // non-streaming path, which has its own timeout. Either way this must
    // reject/finish, never hang.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted", "TimeoutError");
      }),
    );

    const onDone = vi.fn();
    const onError = vi.fn();

    await expect(
      ollamaGenerateStream("sys", "prompt", { baseUrl: "http://x", model: "m" }, { onChunk: vi.fn(), onDone, onError }),
    ).rejects.toThrow(/aborted/i);

    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a clear timeout error (via onError) when the timeout fires mid-stream", async () => {
    // Once the body reader is open, an abort surfaces through reader.read()
    // rejecting — this IS caught by the streaming loop's try/catch.
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new DOMException("The operation was aborted", "TimeoutError");
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(body)));

    const onDone = vi.fn();
    const onError = vi.fn();

    await ollamaGenerateStream("sys", "prompt", { baseUrl: "http://x", model: "m" }, { onChunk: vi.fn(), onDone, onError });

    expect(onDone).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/timed out/i);
  });

  it("reports the HTTP error body when the server responds non-OK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" }) as unknown as Response),
    );

    const onDone = vi.fn();
    const onError = vi.fn();

    await ollamaGenerateStream("sys", "prompt", { baseUrl: "http://x", model: "m" }, { onChunk: vi.fn(), onDone, onError });

    expect(onDone).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("500"));
  });
});
