import { describe, expect, it, beforeEach } from "vitest";

const FRESH_SESSION = {
  idToken: "",
  accessToken: "at",
  refreshToken: "rt",
  expiresAt: Date.now() + 3600_000,
  sub: "user-1",
  email: "a@b.c",
};

// Minimal chrome stub: api.ts (via auth.ts) only uses storage.local here.
function makeChromeStub(initial: Record<string, unknown>) {
  const local = new Map<string, unknown>(Object.entries(initial));
  return {
    local,
    chrome: {
      runtime: { getURL: (p: string) => `chrome-extension://test-id/${p}` },
      storage: {
        local: {
          get: (key: string) =>
            Promise.resolve(Object.fromEntries([...local].filter(([k]) => k === key))),
          set: (obj: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(obj)) local.set(k, v);
            return Promise.resolve();
          },
          remove: (key: string) => {
            local.delete(key);
            return Promise.resolve();
          },
        },
        session: {
          get: () => Promise.resolve({}),
          set: () => Promise.resolve(),
          remove: () => Promise.resolve(),
        },
      },
      identity: { launchWebAuthFlow: () => Promise.reject(new Error("not used in api tests")) },
    },
  };
}

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[];
// Each test installs a responder that routes by URL.
let responder: (url: string, init?: RequestInit) => Response | Promise<Response>;

function installFetch() {
  calls = [];
  responder = () => new Response("{}", { status: 200 });
  (globalThis as any).fetch = (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return responder(String(url), init);
  };
}

let api: typeof import("./api.js");
let chromeStub: ReturnType<typeof makeChromeStub>;

function installChrome(initial: Record<string, unknown> = { session: FRESH_SESSION }) {
  chromeStub = makeChromeStub(initial);
  (globalThis as any).chrome = chromeStub.chrome;
}

beforeEach(async () => {
  installChrome();
  installFetch();
  api = await import("./api.js");
});

function sseResponse(events: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(enc.encode(e));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("apiMe", () => {
  it("GETs /api/me with the access token and returns the body", async () => {
    responder = () =>
      new Response(
        JSON.stringify({ sub: "user-1", email: "a@b.c", subscriptionStatus: "active", currentPeriodEnd: null }),
        { status: 200 },
      );

    const me = await api.apiMe();

    expect(me.subscriptionStatus).toBe("active");
    expect(calls[0].url).toBe("https://REPLACE_WITH_CDK_API_URL/api/me");
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe("Bearer at");
  });

  it("throws AuthError before any fetch when not signed in", async () => {
    installChrome({});

    await expect(api.apiMe()).rejects.toThrow("not signed in");
    expect(calls).toHaveLength(0);
  });

  it("throws AuthError for a stale session with no refresh token", async () => {
    installChrome({ session: { ...FRESH_SESSION, expiresAt: Date.now() - 1000, refreshToken: "" } });

    await expect(api.apiMe()).rejects.toThrow("sign in again");
    expect(calls).toHaveLength(0);
  });

  it("refreshes on a 401, retries once, and succeeds", async () => {
    let meHits = 0;
    responder = (url) => {
      if (url.endsWith("/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "at2", expires_in: 3600 }), { status: 200 });
      }
      meHits++;
      if (meHits === 1) return new Response("{}", { status: 401 });
      return new Response(JSON.stringify({ sub: "user-1", email: "a@b.c", subscriptionStatus: "none", currentPeriodEnd: null }), { status: 200 });
    };

    const me = await api.apiMe();

    expect(me.subscriptionStatus).toBe("none");
    expect(calls.filter((c) => c.url.endsWith("/api/me"))).toHaveLength(2);
    // The retry used the refreshed token.
    expect((calls[2].init!.headers as Record<string, string>).Authorization).toBe("Bearer at2");
  });

  it("clears the session when the 401 retry cannot be refreshed", async () => {
    installChrome({ session: { ...FRESH_SESSION, expiresAt: Date.now() - 1000 } });
    responder = (url) => {
      if (url.endsWith("/oauth2/token")) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      }
      return new Response("{}", { status: 401 });
    };

    await expect(api.apiMe()).rejects.toThrow("sign in again");
    const { getSession } = await import("./auth.js");
    await expect(getSession()).resolves.toBeNull();
  });

  it("maps 402 to SubscriptionRequiredError", async () => {
    responder = () => new Response("{}", { status: 402 });
    await expect(api.apiMe()).rejects.toBeInstanceOf(api.SubscriptionRequiredError);
  });

  it("maps 429 to RateLimitedError", async () => {
    responder = () => new Response("{}", { status: 429 });
    await expect(api.apiMe()).rejects.toBeInstanceOf(api.RateLimitedError);
  });

  it("maps other errors to ApiError with the status", async () => {
    responder = () => new Response("{}", { status: 500 });
    await expect(api.apiMe()).rejects.toMatchObject({ status: 500 });
  });
});

describe("apiEmbed", () => {
  it("POSTs the text and returns the vector", async () => {
    responder = (url) => {
      if (url.endsWith("/api/embed")) {
        return new Response(JSON.stringify({ embedding: [0.1, -0.2, 0.3] }), { status: 200 });
      }
      throw new Error(`unexpected URL ${url}`);
    };

    await expect(api.apiEmbed("Tell me about yourself")).resolves.toEqual([0.1, -0.2, 0.3]);
    const call = calls[0];
    expect(call.init!.method).toBe("POST");
    expect(JSON.parse(call.init!.body as string)).toEqual({ text: "Tell me about yourself" });
  });

  it("rejects a malformed embedding payload", async () => {
    responder = () => new Response(JSON.stringify({ embedding: "nope" }), { status: 200 });
    await expect(api.apiEmbed("x")).rejects.toThrow("malformed");
  });
});

describe("apiGenerateAnswer", () => {
  const opts = {
    systemPrompt: "sys",
    prompt: "prompt",
    question: "Tell me about yourself",
    company: "Acme",
    role: "Engineer",
  };

  it("accumulates SSE text chunks and calls onChunk per chunk", async () => {
    responder = (url) => {
      if (!url.endsWith("/api/answer/generate")) throw new Error(`unexpected URL ${url}`);
      return sseResponse([
        'data: {"text":"Hel"}\n\nda', // deliberately split mid-event
        'ta: {"text":"lo"}\n\ndata: [DONE]\n\n',
      ]);
    };

    const chunks: string[] = [];
    const full = await api.apiGenerateAnswer({ ...opts, onChunk: (c) => chunks.push(c) });

    expect(full).toBe("Hello");
    expect(chunks).toEqual(["Hel", "lo"]);
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body).toMatchObject({ question: "Tell me about yourself", company: "Acme", role: "Engineer" });
    expect((calls[0].init!.headers as Record<string, string>).Accept).toBe("text/event-stream");
  });

  it("aborts with an error on a mid-stream error event", async () => {
    responder = () => sseResponse(['data: {"text":"ok"}\n\n', 'data: {"error":"boom"}\n\n']);

    await expect(api.apiGenerateAnswer(opts)).rejects.toThrow("stream error: boom");
  });

  it("falls back to a plain (non-SSE) body when the content type differs", async () => {
    responder = () => new Response("fallback answer", { status: 200, headers: { "content-type": "text/plain" } });

    const chunks: string[] = [];
    const full = await api.apiGenerateAnswer({ ...opts, onChunk: (c) => chunks.push(c) });

    expect(full).toBe("fallback answer");
    expect(chunks).toEqual(["fallback answer"]);
  });

  it("surfaces 402 from the generate call as SubscriptionRequiredError", async () => {
    responder = () => new Response("{}", { status: 402 });
    await expect(api.apiGenerateAnswer(opts)).rejects.toBeInstanceOf(api.SubscriptionRequiredError);
  });
});
