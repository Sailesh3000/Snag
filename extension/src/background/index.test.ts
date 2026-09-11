import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach, vi } from "vitest";

// BYOK generation (revised plan): the LLM call itself never touches the
// backend, so it's mocked here rather than driven through the fetch stub
// below (which still covers /api/me and /api/embed, both real backend
// calls). `vi.hoisted` is required because `vi.mock` factories are hoisted
// above this file's own top-level declarations.
const llmState = vi.hoisted(() => ({
  chunks: ["Hello ", "there. I am Ada."] as string[],
  error: null as string | null,
  calls: [] as Array<{ system: string; prompt: string }>,
}));

vi.mock("../llm/client.js", () => ({
  llmGenerateStream: async (
    system: string,
    prompt: string,
    _settings: unknown,
    cb: { onChunk: (c: string) => void; onDone: () => void; onError: (e: string) => void },
  ) => {
    llmState.calls.push({ system, prompt });
    if (llmState.error) {
      cb.onError(llmState.error);
      return;
    }
    for (const c of llmState.chunks) cb.onChunk(c);
    cb.onDone();
  },
  llmGenerate: async (system: string, prompt: string) => {
    llmState.calls.push({ system, prompt });
    return llmState.chunks.join("");
  },
}));

// ---------------------------------------------------------------------------
// Chrome stub — background/index.ts registers chrome.* listeners at module
// scope (it's a service worker), so the stub must exist BEFORE the dynamic
// import. Storage is promise-based (auth.ts uses the modern API).
// ---------------------------------------------------------------------------

const tabMessages: Array<{ tabId: number; type: string; payload?: Record<string, unknown> }> = [];
const createdTabs: Array<{ url: string }> = [];

function makeStore(): { map: Map<string, unknown>; get: any; set: any; remove: any } {
  const map = new Map<string, unknown>();
  return {
    map,
    get: async (key: string | string[] | null) => {
      if (key === null || key === undefined) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of map) out[k] = v;
        return out;
      }
      const keys = Array.isArray(key) ? key : [key];
      const out: Record<string, unknown> = {};
      for (const k of keys) if (map.has(k)) out[k] = map.get(k);
      return out;
    },
    set: async (obj: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(obj)) map.set(k, v);
    },
    remove: async (key: string) => {
      map.delete(key);
    },
  };
}

const localStore = makeStore();
const sessionStore = makeStore();

(globalThis as any).chrome = {
  alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
  runtime: {
    onMessage: { addListener: () => {} },
    getURL: (path: string) => `https://devtools-window.chromiumapp.org/${path}`,
  },
  tabs: {
    onRemoved: { addListener: () => {} },
    sendMessage: (tabId: number, msg: { type: string; payload?: Record<string, unknown> }) => {
      tabMessages.push({ tabId, type: msg.type, payload: msg.payload });
      return Promise.resolve({});
    },
    create: async (opts: { url: string }) => {
      createdTabs.push(opts);
      return { id: 999 };
    },
  },
  action: { onClicked: { addListener: () => {} } },
  scripting: { executeScript: async () => {}, insertCSS: async () => {} },
  storage: { local: localStore, session: sessionStore },
  identity: {
    // Read the PKCE state back out of the pending-auth record so the
    // simulated redirect passes startSignIn's state check.
    launchWebAuthFlow: async () => {
      const pending = sessionStore.map.get("pendingAuth") as { state: string };
      return `https://devtools-window.chromiumapp.org/oauth-callback.html?code=fake_code&state=${encodeURIComponent(pending.state)}`;
    },
  },
};

// ---------------------------------------------------------------------------
// Fetch stub — one handler that reads a mutable config per test.
// ---------------------------------------------------------------------------

const api = {
  meStatus: "active",
  embed: [0.5, 0.5, 0.707] as number[],
  embedStatus: 200 as 200 | 429,
  embedCalls: 0,
};

function fakeJwt(sub: string, email: string): string {
  const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64url({ alg: "none" })}.${b64url({ sub, email })}.sig`;
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

(globalThis as any).fetch = (url: unknown, init?: RequestInit) => {
  const u = String(url);
  if (u.includes("/oauth2/token")) {
    return Promise.resolve(jsonResp({
      access_token: "at_new",
      id_token: fakeJwt("sub2", "new@user.dev"),
      refresh_token: "rt_new",
      expires_in: 3600,
    }));
  }
  if (u.includes("/api/me")) {
    return Promise.resolve(jsonResp({
      sub: "sub1",
      email: "a@b.com",
      subscriptionStatus: api.meStatus,
      currentPeriodEnd: "2026-10-01T00:00:00Z",
    }));
  }
  if (u.includes("/api/embed")) {
    api.embedCalls++;
    if (api.embedStatus === 429) {
      return Promise.resolve(jsonResp({ error: "rate_limited", resetsAt: "2026-09-11T00:00:00Z" }, 429));
    }
    return Promise.resolve(jsonResp({ embedding: api.embed }));
  }
  return Promise.resolve(jsonResp({ error: "not_found" }, 404));
};

const { handleRuntimeMessage } = await import("./index.js");
const { setProfileField, saveAnswer, getAnswers, openDB } = await import("../storage/db.js");

// ---------------------------------------------------------------------------

const DB_NAME = "snag";
const STORES = ["profile", "answers"] as const;

async function clearAll(): Promise<void> {
  await openDB();
  for (const store of STORES) {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onsuccess = () => {
        const t = req.result.transaction(store, "readwrite");
        t.objectStore(store).clear();
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      };
      req.onerror = () => reject(req.error);
    });
  }
}

async function seedSession(): Promise<void> {
  await localStore.set({
    session: {
      idToken: fakeJwt("sub1", "a@b.com"),
      accessToken: "at1",
      refreshToken: "rt1",
      expiresAt: Date.now() + 3600_000,
      sub: "sub1",
      email: "a@b.com",
    },
  });
}

async function clearSession(): Promise<void> {
  await localStore.remove("session");
}

async function waitFor(cond: () => boolean | Promise<boolean>, what: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const TAB = 1;
const dispatch = (message: { type: string; payload?: Record<string, unknown> }, tabId = TAB) =>
  handleRuntimeMessage(message, { tab: { id: tabId } });

const sentToTab = (tabId = TAB) => tabMessages.filter((m) => m.tabId === tabId);
const lastOf = (type: string) => [...sentToTab()].reverse().find((m) => m.type === type);

beforeEach(async () => {
  tabMessages.length = 0;
  createdTabs.length = 0;
  api.meStatus = "active";
  api.embed = [0.5, 0.5, 0.707];
  api.embedStatus = 200;
  api.embedCalls = 0;
  llmState.chunks = ["Hello ", "there. I am Ada."];
  llmState.error = null;
  llmState.calls.length = 0;
  await clearAll();
  await clearSession();
});

// ---------------------------------------------------------------------------

describe("page:update", () => {
  it("classifies fields, matches the profile, and auto-fills statics", async () => {
    await setProfileField("email", "a@b.com");
    dispatch({
      type: "page:update",
      payload: {
        url: "https://careers.example.com/apply/1",
        fields: [
          { fieldId: "f1", selector: "#email", label: "Email address", fieldType: "email" },
          { fieldId: "f2", selector: "#q1", label: "Tell us about your biggest professional accomplishment", fieldType: "textarea" },
        ],
        jobTitle: "Engineer",
        company: "Acme",
        jobDescription: "We build payments.",
      },
    });

    await waitFor(() => !!lastOf("status:update"), "status:update");
    await waitFor(() => !!lastOf("fields:classified"), "fields:classified");
    await waitFor(() => !!lastOf("profile:fills"), "profile:fills");

    expect(lastOf("status:update")!.payload).toMatchObject({ fieldCount: 2, staticMatchCount: 1 });
    const classifications = lastOf("fields:classified")!.payload.classifications as Array<{ fieldId: string; category: string }>;
    expect(classifications).toHaveLength(2);
    expect(classifications.find((c) => c.fieldId === "f1")!.category).toBe("static");
    expect(classifications.find((c) => c.fieldId === "f2")!.category).toBe("long_answer");

    const fills = lastOf("profile:fills")!.payload.fills as Array<{ fieldId: string; value: string }>;
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ fieldId: "f1", value: "a@b.com" });
  });
});

describe("answer:generate", () => {
  it("rejects with errorCode=auth when signed out", async () => {
    dispatch({ type: "answer:generate", payload: { fieldId: "q1", question: "Tell me about yourself", questionType: "introduction" } });
    await waitFor(() => !!lastOf("answer:draft"), "answer:draft");
    expect(lastOf("answer:draft")!.payload).toMatchObject({ errorCode: "auth", draft: "" });
  });

  it("streams BYOK chunks and completes with the full draft", async () => {
    await seedSession();
    await setProfileField("email", "a@b.com");
    dispatch({
      type: "page:update",
      payload: { url: "u", fields: [], jobTitle: "Engineer", company: "Acme", jobDescription: "We build payments." },
    });
    dispatch({ type: "answer:generate", payload: { fieldId: "q1", question: "Tell me about yourself", questionType: "introduction" } });

    await waitFor(() => !!lastOf("answer:draft") && !lastOf("answer:draft")!.payload.error, "answer:draft");

    const streams = sentToTab().filter((m) => m.type === "answer:stream");
    expect(streams.length).toBeGreaterThanOrEqual(2);
    expect(streams.at(-1)!.payload.partial).toBe("Hello there. I am Ada.");

    const draft = lastOf("answer:draft")!.payload;
    expect(draft).toMatchObject({
      fieldId: "q1",
      error: null,
      questionType: "introduction",
      company: "Acme",
      role: "Engineer",
      memoryCount: 0,
      profileUsed: ["email"],
    });
    expect(draft.draft).toBe("Hello there. I am Ada.");

    // The LLM call (BYOK, never touches the backend) must carry the
    // locally-built prompt.
    const call = llmState.calls.at(-1)!;
    expect(call.system).toMatch(/^You are Snag, an AI assistant/);
    expect(call.prompt).toContain("Question: Tell me about yourself");
    expect(call.prompt).toContain("Role: Engineer | Company: Acme");
    expect(call.prompt).toContain("Past answers (style guide): No past answers available.");
  });

  it("embeds the question and includes similar memories when answers exist", async () => {
    await seedSession();
    await saveAnswer({
      question: "Tell me about yourself",
      answer: "I am Ada, an engineer at Acme.",
      company: "Acme",
      role: "Engineer",
      embedding: [1, 0, 0],
    });
    api.embed = [0.9, 0.1, 0.0]; // cosine ~0.99 with the stored [1,0,0]
    dispatch({
      type: "page:update",
      payload: { url: "u", fields: [], jobTitle: "Engineer", company: "Acme", jobDescription: "" },
    });
    dispatch({ type: "answer:generate", payload: { fieldId: "q1", question: "Tell me about yourself", questionType: "introduction" } });

    await waitFor(() => !!lastOf("answer:draft") && !lastOf("answer:draft")!.payload.error, "answer:draft");
    expect(api.embedCalls).toBe(1);
    const call = llmState.calls.at(-1)!;
    expect(call.prompt).toContain("Past answers (style guide): [");
    expect(call.prompt).toContain("I am Ada, an engineer at Acme.");
    expect(lastOf("answer:draft")!.payload.memoryCount).toBe(1);
  });

  it("maps an inactive subscription to errorCode=subscription_required (license gate, before any LLM call)", async () => {
    await seedSession();
    api.meStatus = "none";
    dispatch({ type: "answer:generate", payload: { fieldId: "q1", question: "Tell me about yourself" } });
    await waitFor(() => !!lastOf("answer:draft"), "answer:draft");
    expect(lastOf("answer:draft")!.payload).toMatchObject({ errorCode: "subscription_required" });
    expect(lastOf("answer:draft")!.payload.error).toMatch(/subscription/i);
    expect(llmState.calls).toHaveLength(0); // never reached the BYOK call
  });

  it("maps a 429 from the (still backend-gated) embed call to errorCode=rate_limited", async () => {
    await seedSession();
    await saveAnswer({
      question: "Tell me about yourself",
      answer: "I am Ada, an engineer at Acme.",
      company: "Acme",
      role: "Engineer",
      embedding: [1, 0, 0],
    });
    api.embedStatus = 429;
    dispatch({ type: "answer:generate", payload: { fieldId: "q1", question: "Tell me about yourself" } });
    await waitFor(() => !!lastOf("answer:draft"), "answer:draft");
    expect(lastOf("answer:draft")!.payload).toMatchObject({ errorCode: "rate_limited" });
    expect(lastOf("answer:draft")!.payload.error).toMatch(/limit/i);
  });

  it("maps a missing BYOK API key to errorCode=no_api_key for a non-Ollama provider", async () => {
    await seedSession();
    await localStore.set({ settings: { provider: "anthropic", apiKey: "" } });
    dispatch({ type: "answer:generate", payload: { fieldId: "q1", question: "Tell me about yourself" } });
    await waitFor(() => !!lastOf("answer:draft"), "answer:draft");
    expect(lastOf("answer:draft")!.payload).toMatchObject({ errorCode: "no_api_key" });
    expect(llmState.calls).toHaveLength(0);
  });
});

describe("fills", () => {
  it("saves the answer to memory only after the content script confirms the fill", async () => {
    await seedSession();
    dispatch({
      type: "fill:approve",
      payload: {
        requestId: "req_1",
        value: "I am Ada, an engineer at Acme.",
        question: "Tell me about yourself",
        selector: "#q1",
        fieldId: "q1",
        company: "Acme",
        role: "Engineer",
      },
    });

    await waitFor(() => !!lastOf("fill:instruct"), "fill:instruct");
    expect(lastOf("fill:instruct")!.payload).toMatchObject({
      requestId: "req_1",
      selector: "#q1",
      value: "I am Ada, an engineer at Acme.",
      label: "Tell me about yourself",
      fieldId: "q1",
    });

    expect(await getAnswers()).toHaveLength(0); // not saved yet

    dispatch({ type: "fill:result", payload: { requestId: "req_1", fieldId: "q1", success: true } });
    await waitFor(async () => (await getAnswers()).length === 1, "answer persisted");

    const saved = (await getAnswers())[0];
    expect(saved.answer).toBe("I am Ada, an engineer at Acme.");
    expect(saved.company).toBe("Acme");
    expect(saved.role).toBe("Engineer");
    expect(saved.questionType).toBe("introduction");
    expect(lastOf("fill:executed")!.payload).toMatchObject({ fieldId: "q1", success: true });
  });

  it("does NOT save memory when the fill fails", async () => {
    await seedSession();
    dispatch({
      type: "fill:approve",
      payload: {
        requestId: "req_2",
        value: "draft text",
        question: "Tell me about yourself",
        selector: "#q1",
        fieldId: "q1",
      },
    });
    await waitFor(() => !!lastOf("fill:instruct"), "fill:instruct");
    dispatch({ type: "fill:result", payload: { requestId: "req_2", fieldId: "q1", success: false, reason: "not_found" } });
    await new Promise((r) => setTimeout(r, 50));
    expect(await getAnswers()).toHaveLength(0);
    expect(lastOf("fill:executed")!.payload).toMatchObject({ success: false, reason: "not_found" });
  });

  it("re-emits static auto-fill results as fill:executed for the sidebar", () => {
    dispatch({ type: "fill:execute", payload: { fieldId: "f1", value: "a@b.com", success: true } });
    expect(lastOf("fill:executed")!.payload).toMatchObject({ fieldId: "f1", success: true });
  });
});

describe("auth messages", () => {
  it("auth:status returns the public session plus live subscription status", async () => {
    await seedSession();
    dispatch({ type: "auth:status" });
    await waitFor(() => !!lastOf("auth:status"), "auth:status");
    expect(lastOf("auth:status")!.payload).toMatchObject({
      session: { sub: "sub1", email: "a@b.com" },
      subscription: { status: "active", currentPeriodEnd: "2026-10-01T00:00:00Z" },
    });
  });

  it("auth:checkout opens the Paddle checkout with the Cognito sub in custom_data", async () => {
    await seedSession();
    dispatch({ type: "auth:checkout" });
    await waitFor(() => createdTabs.length === 1, "checkout tab");
    expect(createdTabs[0].url).toContain("custom_data[cognitoSub]=sub1");
  });

  it("auth:signIn exchanges the code and pushes auth:updated with subscription", async () => {
    dispatch({ type: "auth:signIn" });
    await waitFor(() => !!lastOf("auth:updated"), "auth:updated");
    expect(lastOf("auth:updated")!.payload).toMatchObject({
      session: { sub: "sub2", email: "new@user.dev" },
      subscription: { status: "active" },
    });
    // The new session was persisted.
    const stored = localStore.map.get("session") as { sub: string };
    expect(stored.sub).toBe("sub2");
  });

  it("auth:signOut clears the session", async () => {
    await seedSession();
    dispatch({ type: "auth:signOut" });
    await waitFor(() => !!lastOf("auth:updated"), "auth:updated");
    expect(lastOf("auth:updated")!.payload.session).toBeNull();
    expect(lastOf("auth:updated")!.payload.subscription).toBeNull();
    expect(localStore.map.has("session")).toBe(false);
  });
});

describe("profile messages", () => {
  it("profile:set persists to IndexedDB and acks with profile:updated", async () => {
    dispatch({ type: "profile:set", payload: { key: "phone", value: "555-0100" } });
    await waitFor(() => !!lastOf("profile:updated"), "profile:updated");
    expect(lastOf("profile:updated")!.payload).toMatchObject({ key: "phone", value: "555-0100" });
    const { getProfile } = await import("../storage/db.js");
    expect(await getProfile()).toEqual({ phone: "555-0100" });
  });
});

describe("parked flows", () => {
  it("resume:extract replies with a parked error instead of calling an LLM", () => {
    dispatch({ type: "resume:extract", payload: { resumeText: "Ada Lovelace..." } });
    expect(lastOf("resume:extracted")!.payload).toMatchObject({ fields: null });
    expect(lastOf("resume:extracted")!.payload.error).toMatch(/isn't available/i);
  });
});
