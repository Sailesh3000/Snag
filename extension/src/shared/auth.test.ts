import { describe, expect, it, beforeEach } from "vitest";

// auth.ts touches chrome.* inside functions (not at module scope), but the
// dynamic import below still needs a stub in place first.
function makeChromeStub(launchWebAuthFlow: (url: string) => Promise<string>) {
  const local = new Map<string, unknown>();
  const sessionStore = new Map<string, unknown>();
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
          get: (key: string) =>
            Promise.resolve(Object.fromEntries([...sessionStore].filter(([k]) => k === key))),
          set: (obj: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(obj)) sessionStore.set(k, v);
            return Promise.resolve();
          },
          remove: (key: string) => {
            sessionStore.delete(key);
            return Promise.resolve();
          },
        },
      },
      identity: { launchWebAuthFlow: ({ url }: { url: string }) => launchWebAuthFlow(url) },
    },
  };
}

function fakeJwt(claims: object): string {
  const b64 = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64(JSON.stringify(claims))}.sig`;
}

const CONFIG = {
  apiBaseUrl: "https://api.test",
  cognitoDomain: "https://auth.test",
  clientId: "client123",
};

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[];
let tokenResponse: { status: number; body: object };

function installFetch() {
  calls = [];
  tokenResponse = { status: 200, body: {} };
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(tokenResponse.body), { status: tokenResponse.status });
  };
}

let auth: typeof import("./auth.js");
let chromeStub: ReturnType<typeof makeChromeStub>;

beforeEach(async () => {
  chromeStub = makeChromeStub(async () => {
    throw new Error("launchWebAuthFlow not stubbed in this test");
  });
  (globalThis as any).chrome = chromeStub.chrome;
  installFetch();
  auth = await import("./auth.js");
});

describe("decodeJwtPayload", () => {
  it("round-trips a base64url payload", () => {
    const jwt = fakeJwt({ sub: "u1", email: "a@b.c" });
    expect(auth.decodeJwtPayload(jwt)).toEqual({ sub: "u1", email: "a@b.c" });
  });

  it("throws on a token without a payload segment", () => {
    expect(() => auth.decodeJwtPayload("nosegments")).toThrow();
  });
});

describe("isFresh", () => {
  const session = {
    idToken: "",
    accessToken: "at",
    refreshToken: "rt",
    expiresAt: 0,
    sub: "u",
    email: "e",
  };

  it("fresh while >60s remain", () => {
    expect(auth.isFresh({ ...session, expiresAt: Date.now() + 120_000 })).toBe(true);
  });

  it("stale within 60s of expiry", () => {
    expect(auth.isFresh({ ...session, expiresAt: Date.now() + 30_000 })).toBe(false);
    expect(auth.isFresh({ ...session, expiresAt: Date.now() - 1000 })).toBe(false);
  });
});

describe("buildAuthorizeUrl", () => {
  it("carries every parameter Cognito requires for PKCE auth-code", () => {
    const url = auth.buildAuthorizeUrl(CONFIG, {
      codeChallenge: "challenge123",
      state: "state456",
      nonce: "nonce789",
      redirectUri: "https://devtools-window.chromiumapp.org/oauth-callback.html",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://auth.test/oauth2/authorize");
    const p = u.searchParams;
    expect(p.get("client_id")).toBe("client123");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe("openid email profile");
    expect(p.get("state")).toBe("state456");
    expect(p.get("nonce")).toBe("nonce789");
    expect(p.get("code_challenge")).toBe("challenge123");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("redirect_uri")).toBe("https://devtools-window.chromiumapp.org/oauth-callback.html");
  });
});

describe("startSignIn", () => {
  it("exchanges the code with the pending verifier and stores the session", async () => {
    let seenAuthorizeUrl = "";
    chromeStub.chrome.identity.launchWebAuthFlow = ({ url }: { url: string }) => {
      seenAuthorizeUrl = url;
      const state = new URL(url).searchParams.get("state")!;
      return Promise.resolve(`https://devtools-window.chromiumapp.org/oauth-callback.html?code=abc123&state=${state}`);
    };
    tokenResponse = {
      status: 200,
      body: {
        access_token: "at1",
        id_token: fakeJwt({ sub: "user-1", email: "a@b.c" }),
        refresh_token: "rt1",
        expires_in: 3600,
      },
    };

    const session = await auth.startSignIn(CONFIG);

    expect(session.sub).toBe("user-1");
    expect(session.email).toBe("a@b.c");
    expect(session.accessToken).toBe("at1");
    expect(session.refreshToken).toBe("rt1");
    expect(session.expiresAt).toBeGreaterThan(Date.now() + 3500_000);

    // The token exchange went straight to Cognito, with the verifier that
    // matches the challenge in the authorize URL.
    const tokenCall = calls.find((c) => c.url.endsWith("/oauth2/token"));
    expect(tokenCall).toBeDefined();
    const form = new URLSearchParams(tokenCall!.init!.body as string);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("abc123");
    const challenge = new URL(seenAuthorizeUrl).searchParams.get("code_challenge")!;
    const { codeChallengeFor } = await import("./pkce.js");
    expect(await codeChallengeFor(form.get("code_verifier")!)).toBe(challenge);

    const stored = await auth.getSession();
    expect(stored?.accessToken).toBe("at1");
  });

  it("rejects a state mismatch and never calls the token endpoint", async () => {
    chromeStub.chrome.identity.launchWebAuthFlow = ({ url }: { url: string }) => {
      const state = new URL(url).searchParams.get("state")!;
      return Promise.resolve(`https://devtools-window.chromiumapp.org/oauth-callback.html?code=abc&state=WRONG_${state}`);
    };

    await expect(auth.startSignIn(CONFIG)).rejects.toThrow("state mismatch");
    expect(calls.filter((c) => c.url.endsWith("/oauth2/token"))).toHaveLength(0);
  });

  it("surfaces the OAuth error parameter", async () => {
    chromeStub.chrome.identity.launchWebAuthFlow = () =>
      Promise.resolve("https://devtools-window.chromiumapp.org/oauth-callback.html?error=access_denied");

    await expect(auth.startSignIn(CONFIG)).rejects.toThrow("access_denied");
  });

  it("fails when the redirect carries no code", async () => {
    chromeStub.chrome.identity.launchWebAuthFlow = ({ url }: { url: string }) => {
      const state = new URL(url).searchParams.get("state")!;
      return Promise.resolve(`https://devtools-window.chromiumapp.org/oauth-callback.html?state=${state}`);
    };

    await expect(auth.startSignIn(CONFIG)).rejects.toThrow("no authorization code");
  });
});

describe("refreshSession", () => {
  const stale = {
    idToken: fakeJwt({ sub: "user-1", email: "a@b.c" }),
    accessToken: "at-old",
    refreshToken: "rt1",
    expiresAt: Date.now() - 1000,
    sub: "user-1",
    email: "a@b.c",
  };

  it("refreshes with the stored token and keeps the refresh token when the response omits one", async () => {
    await chromeStub.chrome.storage.local.set({ session: stale });
    tokenResponse = { status: 200, body: { access_token: "at-new", expires_in: 3600 } };

    const next = await auth.refreshSession(CONFIG);

    expect(next?.accessToken).toBe("at-new");
    expect(next?.refreshToken).toBe("rt1");
    expect(next?.sub).toBe("user-1"); // carried over from previous id_token claims
    const form = new URLSearchParams(calls[0].init!.body as string);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("rt1");
    expect((await auth.getSession())?.accessToken).toBe("at-new");
  });

  it("clears the session when Cognito rejects the grant (4xx)", async () => {
    await chromeStub.chrome.storage.local.set({ session: stale });
    tokenResponse = { status: 400, body: { error: "invalid_grant" } };

    await expect(auth.refreshSession(CONFIG)).resolves.toBeNull();
    await expect(auth.getSession()).resolves.toBeNull();
  });

  it("keeps the session on a network failure", async () => {
    await chromeStub.chrome.storage.local.set({ session: stale });
    (globalThis as any).fetch = async () => {
      throw new TypeError("failed to fetch");
    };

    await expect(auth.refreshSession(CONFIG)).resolves.toBeNull();
    expect((await auth.getSession())?.accessToken).toBe("at-old");
  });

  it("returns null without fetching when there is no refresh token", async () => {
    await chromeStub.chrome.storage.local.set({ session: { ...stale, refreshToken: "" } });

    await expect(auth.refreshSession(CONFIG)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("signOut", () => {
  it("revokes best-effort and clears local state", async () => {
    await chromeStub.chrome.storage.local.set({
      session: {
        idToken: "",
        accessToken: "at",
        refreshToken: "rt",
        expiresAt: Date.now() + 3600_000,
        sub: "u",
        email: "e",
      },
    });
    tokenResponse = { status: 400, body: { error: "invalid_request" } }; // revocation fails — still must clear

    await auth.signOut(CONFIG);

    await expect(auth.getSession()).resolves.toBeNull();
  });
});
