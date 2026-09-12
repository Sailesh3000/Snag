// Snag background service worker — local orchestration (plan B3, revised).
//
// The retired local FastAPI backend used to do four things for the
// extension: (1) classify detected form fields and match them against the
// profile, (2) assemble the answer-generation prompt context (profile +
// similar past answers), (3) instruct the content script to write an
// approved answer into the DOM, and (4) persist approved answers into
// memory. All of that now runs here against the local IndexedDB.
//
// LLM generation is BYOK (revised plan): the subscription funds Bedrock
// embeddings and gates using Snag at all, but the user's own Anthropic/
// OpenAI/Groq/Ollama key (llm/client.ts, configured in Settings) is what
// actually generates answers — the backend never sees the prompt or holds
// a provider key. The two network calls left are /api/me (license check)
// and /api/embed (Bedrock Titan, still subscription-gated).
//
// Message flow (unchanged from the pilot, new transport):
//   sidebar iframe --postMessage--> content script --runtime--> background
//   background     --tabs.sendMessage--> content script --forwardToSidebar--> sidebar
//
// The sidebar never sees tokens; it gets `publicSession` (sub/email only)
// plus subscription status from /api/me.

import { apiEmbed, apiMe, ApiError, AuthError, RateLimitedError, SubscriptionRequiredError } from "../shared/api.js";
import { getSession, isFresh, refreshSession, signOut, startSignIn, type Session } from "../shared/auth.js";
import { classifyFields, matchStaticFields, type FieldInfo } from "../classify.js";
import { ANSWER_SYSTEM, buildAnswerPrompt, detectQuestionType, type MemoryEntry } from "../shared/prompt.js";
import { buildCheckoutUrl } from "../shared/pricing.js";
import { findSimilar } from "../similarity.js";
import { deleteAnswer, getAnswers, getProfile, saveAnswer, setProfileField, updateAnswer } from "../storage/db.js";
import { getSettings } from "../shared/config.js";
import { llmGenerateStream } from "../llm/client.js";

interface RuntimeMessage {
  type: string;
  payload?: Record<string, unknown>;
}

interface PageContext {
  url: string;
  company: string;
  role: string;
  jobDescription: string;
}

interface PendingApproval {
  tabId: number;
  question: string;
  value: string;
  company: string;
  role: string;
  original?: string;
}

interface SubscriptionInfo {
  status: string;
  currentPeriodEnd: string | null;
}

const activeTabs = new Set<number>();
const pageContexts = new Map<number, PageContext>();
// fill:approve -> data needed to persist the answer once the content script
// confirms the DOM write actually succeeded (fill:result). Memory is only
// ever saved for fills that actually landed.
const pendingApprovals = new Map<string, PendingApproval>();

function sendToTab(tabId: number, message: RuntimeMessage): void {
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

// Tokens never leave the service worker; pages get a reduced view.
function publicSession(session: Session | null) {
  return session ? { sub: session.sub, email: session.email, expiresAt: session.expiresAt } : null;
}

// --- subscription status ----------------------------------------------------

async function fetchSubscription(): Promise<SubscriptionInfo | null> {
  try {
    const me = await apiMe();
    return { status: me.subscriptionStatus, currentPeriodEnd: me.currentPeriodEnd ?? null };
  } catch {
    return null;
  }
}

async function pushAuthUpdate(tabId?: number, error?: string): Promise<void> {
  const session = await getSession();
  const subscription = session ? await fetchSubscription() : null;
  const payload: Record<string, unknown> = { session: publicSession(session), subscription };
  if (error) payload.error = error;
  const message: RuntimeMessage = { type: "auth:updated", payload };
  if (tabId !== undefined) sendToTab(tabId, message);
  else for (const t of activeTabs) sendToTab(t, message);
}

// --- error mapping (plan B4: distinct 402 / 429 / auth UI states) -----------

type AnswerErrorCode = "auth" | "subscription_required" | "rate_limited" | "no_api_key" | "error";

function errorCodeFor(e: unknown): AnswerErrorCode {
  if (e instanceof SubscriptionRequiredError) return "subscription_required";
  if (e instanceof RateLimitedError) return "rate_limited";
  if (e instanceof ApiError) return "error";
  if (e instanceof AuthError) return "auth";
  return "error";
}

const ERROR_MESSAGES: Record<AnswerErrorCode, string> = {
  subscription_required: "Your subscription isn't active. Subscribe to generate answers.",
  rate_limited: "You've hit today's usage limit. Try again tomorrow.",
  no_api_key: "Add your AI provider's API key in Settings to generate answers.",
  auth: "You're signed out or your session expired. Sign in again to continue.",
  error: "Couldn't generate an answer. Check your connection and try again.",
};

/** License gate (revised plan): using Snag at all requires an active
 * subscription, independent of which LLM path generates the text — so this
 * is checked explicitly rather than piggybacked on the /api/embed call
 * (which is skipped entirely when there's no memory yet to search). */
async function hasActiveSubscription(): Promise<boolean> {
  const sub = await fetchSubscription();
  return sub?.status === "active";
}

// --- page scan ---------------------------------------------------------------

async function handlePageUpdate(tabId: number, payload: Record<string, unknown>): Promise<void> {
  const fields = (payload.fields || []) as FieldInfo[];
  pageContexts.set(tabId, {
    url: (payload.url as string) || "",
    company: (payload.company as string) || "",
    role: (payload.jobTitle as string) || "",
    jobDescription: (payload.jobDescription as string) || "",
  });

  const classifications = classifyFields(fields);
  const profile = await getProfile();
  const { autoFills, sensitiveSuggestions } = matchStaticFields(fields, profile);

  const categoryCounts: Record<string, number> = {};
  for (const c of classifications) categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;

  sendToTab(tabId, {
    type: "status:update",
    payload: { fieldCount: fields.length, staticMatchCount: autoFills.length, categoryCounts },
  });
  sendToTab(tabId, { type: "fields:classified", payload: { classifications } });
  if (sensitiveSuggestions.length > 0) {
    sendToTab(tabId, { type: "static:suggestions", payload: { suggestions: sensitiveSuggestions } });
  }
  // Non-sensitive static matches are auto-filled (the content script applies
  // them and reports back a fill:execute per field, which we re-emit as
  // fill:executed for the sidebar).
  if (autoFills.length > 0) {
    sendToTab(tabId, { type: "profile:fills", payload: { fills: autoFills } });
  }
}

// --- answer generation -------------------------------------------------------

function sendErrorDraft(
  tabId: number,
  base: { fieldId: string; question: string; company: string; role: string; questionType: string },
  errorCode: AnswerErrorCode,
): void {
  sendToTab(tabId, {
    type: "answer:draft",
    payload: {
      ...base,
      draft: "",
      error: ERROR_MESSAGES[errorCode],
      errorCode,
      confidence: 0,
      profileUsed: [],
      memoryCount: 0,
    },
  });
}

async function handleAnswerGenerate(tabId: number, payload: Record<string, unknown>): Promise<void> {
  const fieldId = (payload.fieldId as string) || "";
  const question = (payload.question as string) || "";
  const pageCtx = pageContexts.get(tabId) || { url: "", company: "", role: "", jobDescription: "" };
  const company = (payload.company as string) || pageCtx.company;
  const role = (payload.role as string) || pageCtx.role;
  const fallbackType = (payload.questionType as string) || "general";
  const base = { fieldId, question, company, role };

  const session = await getSession();
  if (!session) {
    sendErrorDraft(tabId, { ...base, questionType: fallbackType }, "auth");
    return;
  }

  // License gate first, before spending anything (an embed call, an LLM
  // call) — using Snag at all requires an active subscription.
  if (!(await hasActiveSubscription())) {
    sendErrorDraft(tabId, { ...base, questionType: fallbackType }, "subscription_required");
    return;
  }

  const settings = await getSettings();
  if (settings.provider !== "ollama" && !settings.apiKey.trim()) {
    sendErrorDraft(tabId, { ...base, questionType: fallbackType }, "no_api_key");
    return;
  }

  try {
    const profile = await getProfile();
    const answers = await getAnswers();

    // Semantic memory lookup needs a query embedding, which costs one gated
    // /api/embed call (Bedrock) — skip it entirely when there's nothing to
    // match yet.
    let memories: MemoryEntry[] = [];
    if (answers.some((a) => a.embedding && a.embedding.length > 0)) {
      const queryEmbedding = await apiEmbed(question);
      memories = findSimilar(queryEmbedding, answers, 3, 0.3, company, role).map((m) => ({
        id: m.id,
        score: m.score,
        payload: m.payload,
      }));
    }

    const { prompt, questionType } = buildAnswerPrompt({
      question,
      profile,
      memories,
      jobDescription: pageCtx.jobDescription,
      company,
      role,
    });

    // BYOK: the user's own provider key generates the answer — the backend
    // never sees this prompt.
    let fullText = "";
    await new Promise<void>((resolve, reject) => {
      llmGenerateStream(ANSWER_SYSTEM, prompt, settings, {
        onChunk: (chunk) => {
          fullText += chunk;
          sendToTab(tabId, { type: "answer:stream", payload: { fieldId, chunk, partial: fullText } });
        },
        onDone: () => resolve(),
        onError: (error) => reject(new Error(error)),
      }).catch(reject);
    });

    // The draft is NOT saved to memory here. It becomes memory only when the
    // user accepts it (fill:approve) and the content script confirms the DOM
    // write (fill:result) — see handleFillResult.
    sendToTab(tabId, {
      type: "answer:draft",
      payload: {
        ...base,
        draft: fullText,
        error: null,
        questionType,
        confidence: fullText.length > 20 ? 0.7 : 0.3,
        profileUsed: Object.keys(profile),
        memoryCount: memories.length,
      },
    });
  } catch (e) {
    console.error("[Snag] answer generation failed:", e);
    sendErrorDraft(tabId, { ...base, questionType: fallbackType }, errorCodeFor(e));
  }
}

// --- fills -------------------------------------------------------------------

async function persistApprovedAnswer(pending: PendingApproval): Promise<void> {
  // The embedding is best-effort: if the subscription lapses or the embed
  // quota is hit, the answer is still saved — just without a vector for
  // future semantic matching.
  let embedding: number[] | null = null;
  try {
    embedding = await apiEmbed(pending.question);
  } catch {
    embedding = null;
  }
  try {
    await saveAnswer({
      question: pending.question,
      answer: pending.value,
      company: pending.company,
      role: pending.role,
      questionType: detectQuestionType(pending.question),
      originalAnswer: pending.original,
      embedding,
    });
  } catch (e) {
    console.error("[Snag] failed to save answer memory:", e);
  }
}

async function handleFillApprove(tabId: number, payload: Record<string, unknown>): Promise<void> {
  const requestId = (payload.requestId as string) || "";
  const question = (payload.question as string) || "";
  const value = (payload.value as string) || "";
  const pageCtx = pageContexts.get(tabId);
  const company = (payload.company as string) || pageCtx?.company || "";
  const role = (payload.role as string) || pageCtx?.role || "";

  // Instruct the content script to write the value into the DOM; the result
  // comes back as fill:result, which is where the answer gets persisted.
  sendToTab(tabId, {
    type: "fill:instruct",
    payload: { requestId, selector: payload.selector, value, label: question, fieldId: payload.fieldId },
  });

  if (requestId) {
    pendingApprovals.set(requestId, { tabId, question, value, company, role, original: payload.original as string | undefined });
  }
}

async function handleFillResult(tabId: number, payload: Record<string, unknown>): Promise<void> {
  const requestId = (payload.requestId as string) || "";
  const fieldId = (payload.fieldId as string) || "";
  const success = !!payload.success;
  sendToTab(tabId, { type: "fill:executed", payload: { fieldId, success, reason: payload.reason } });

  if (success && requestId) {
    const pending = pendingApprovals.get(requestId);
    pendingApprovals.delete(requestId);
    if (pending) await persistApprovedAnswer(pending);
  }
}

// --- message dispatcher ------------------------------------------------------

export function handleRuntimeMessage(message: RuntimeMessage, sender: { tab?: { id?: number } }): void {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return; // options page etc. — nothing to orchestrate
  const payload = message.payload || {};

  // The content script handles activate/deactivate itself.
  if (message.type === "activate" || message.type === "deactivate") return;

  switch (message.type) {
    case "page:update":
      handlePageUpdate(tabId, payload).catch((e) => console.error("[Snag] page:update failed:", e));
      return;

    case "answer:generate":
      handleAnswerGenerate(tabId, payload).catch((e) => console.error("[Snag] answer:generate failed:", e));
      return;

    case "fill:approve":
      handleFillApprove(tabId, payload).catch((e) => console.error("[Snag] fill:approve failed:", e));
      return;

    case "fill:result":
      handleFillResult(tabId, payload).catch((e) => console.error("[Snag] fill:result failed:", e));
      return;

    case "fill:preview":
      sendToTab(tabId, message);
      return;

    case "fill:reject":
      sendToTab(tabId, { type: "fill:rejected", payload: { fieldId: payload.fieldId } });
      return;

    // Result of a static auto-fill (profile:fills) — re-emit for the sidebar.
    case "fill:execute":
      sendToTab(tabId, {
        type: "fill:executed",
        payload: { fieldId: payload.fieldId, success: payload.success, reason: payload.reason },
      });
      return;

    case "profile:get":
      getProfile()
        .then((profile) => sendToTab(tabId, { type: "profile:got", payload: { profile } }))
        .catch(() => sendToTab(tabId, { type: "profile:got", payload: { profile: {} } }));
      return;

    case "profile:set": {
      const key = payload.key as string;
      const value = payload.value as string;
      if (!key) return;
      setProfileField(key, value)
        .then(() => sendToTab(tabId, { type: "profile:updated", payload: { key, value } }))
        .catch(() => {});
      return;
    }

    // Memory management (learned answers live in local IndexedDB).
    case "memory:answers":
      getAnswers()
        .then((answers) =>
          sendToTab(tabId, {
            type: "memory:answers:response",
            payload: {
              answers: answers.map((a) => ({
                id: a.id,
                question: a.question,
                answer: a.answer,
                company: a.company,
                role: a.role,
                createdAt: a.createdAt,
              })),
            },
          }),
        )
        .catch(() => sendToTab(tabId, { type: "memory:answers:response", payload: { answers: [] } }));
      return;

    case "memory:update": {
      const id = payload.id as string;
      const answer = payload.answer as string;
      if (!id) return;
      updateAnswer(id, answer)
        .then((ok) => sendToTab(tabId, { type: "memory:updated", payload: { id, ok } }))
        .catch(() => sendToTab(tabId, { type: "memory:updated", payload: { id, ok: false } }));
      return;
    }

    case "memory:delete": {
      const id = payload.id as string;
      if (!id) return;
      deleteAnswer(id)
        .then((ok) => sendToTab(tabId, { type: "memory:deleted", payload: { id, ok } }))
        .catch(() => sendToTab(tabId, { type: "memory:deleted", payload: { id, ok: false } }));
      return;
    }

    case "resume:extract":
      // Parked: not yet reimplemented against the local storage layer /
      // BYOK LLM client (a separate feature from the transport/BYOK pivot).
      sendToTab(tabId, {
        type: "resume:extracted",
        payload: {
          fields: null,
          error: "Resume import isn't available yet. For now, add your profile fields manually in the Profile section.",
        },
      });
      return;

    case "auth:signIn":
      startSignIn()
        .then(() => pushAuthUpdate(tabId))
        .catch((e) => pushAuthUpdate(tabId, e instanceof Error ? e.message : String(e)));
      return;

    case "auth:signOut":
      signOut()
        .then(() => pushAuthUpdate(tabId))
        .catch(() => pushAuthUpdate(tabId));
      return;

    case "auth:status":
      void (async () => {
        const session = await getSession();
        const subscription = session ? await fetchSubscription() : null;
        sendToTab(tabId, { type: "auth:status", payload: { session: publicSession(session), subscription } });
      })();
      return;

    case "auth:checkout":
      void (async () => {
        const session = await getSession();
        if (!session?.sub) return;
        try {
          await chrome.tabs.create({ url: buildCheckoutUrl(session.sub) });
        } catch {}
      })();
      return;

    case "api:me":
      void (async () => {
        try {
          const me = await apiMe();
          sendToTab(tabId, { type: "api:me:response", payload: { ok: true, me } });
        } catch (e) {
          const code = errorCodeFor(e);
          sendToTab(tabId, {
            type: "api:me:response",
            payload: { ok: false, errorCode: code, error: e instanceof Error ? e.message : String(e) },
          });
        }
      })();
      return;

    // Not currently wired to anything: no content script targets Paddle's
    // checkout success page (docs/checkout/success.html, plain GitHub Pages
    // content, not part of this extension) to send this message. The ~30s
    // alarm poll (pushAuthUpdate on a timer, below) is what actually picks
    // up a subscription flip after checkout — this handler is a hook for an
    // optional instant-refresh content script, not yet built.
    case "checkout:done":
      pushAuthUpdate().catch(() => {});
      return;

    default:
      // Unknown sidebar messages: keep the pilot's pass-through so the
      // content script relay stays lossless.
      sendToTab(tabId, message);
  }
}

// --- lifecycle ---------------------------------------------------------------

// Token refresh on the alarm cadence (plan B2): the access token dies in an
// hour, so refresh proactively while the browser is open, then re-poll
// /api/me so a Paddle webhook that just landed shows up without a reload.
chrome.alarms.create("snag-session-refresh", { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "snag-session-refresh") return;
  void (async () => {
    try {
      const session = await getSession();
      if (!session) return;
      if (!isFresh(session)) await refreshSession();
    } catch {}
    pushAuthUpdate().catch(() => {});
  })();
});

chrome.runtime.onMessage.addListener((message, sender) => {
  handleRuntimeMessage(message as RuntimeMessage, sender);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
  pageContexts.delete(tabId);
  for (const [rid, pending] of pendingApprovals) {
    if (pending.tabId === tabId) pendingApprovals.delete(rid);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) return;

  if (activeTabs.has(tab.id)) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "deactivate" });
    } catch {}
    activeTabs.delete(tab.id);
  } else {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["content/index.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id, allFrames: true },
        files: ["content/styles.css"],
      });
    } catch (e) {
      console.error("[Snag] Injection failed:", e);
      return;
    }
    activeTabs.add(tab.id);
    chrome.tabs.sendMessage(tab.id, { type: "activate" }).catch(() => {});
  }
});
