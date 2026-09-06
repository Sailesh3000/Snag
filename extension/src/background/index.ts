import { getSettings, getBackendWsUrl, getBackendHttpUrl } from "../shared/config.js";
import { llmGenerate, llmGenerateStream } from "../llm/client.js";

interface TabSession {
  sessionId: string;
  ws: WebSocket;
}

const tabSessions = new Map<number, TabSession>();
const activeTabs = new Set<number>();
const pendingContexts = new Map<string, { tabId: number; company: string; role: string; question: string; fieldId: string }>();

async function pingBackendHealth() {
  const settings = await getSettings();
  const httpUrl = getBackendHttpUrl(settings);
  let online = false;
  try {
    const resp = await fetch(`${httpUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) online = true;
  } catch {}
  for (const tabId of activeTabs) {
    chrome.tabs.sendMessage(tabId, {
      type: "backend:status",
      payload: { online },
    }).catch(() => {});
  }
}

chrome.alarms.create("snag-health-ping", { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "snag-health-ping") {
    pingBackendHealth();
  }
});

async function createSession(tabId: number): Promise<TabSession> {
  const settings = await getSettings();
  const baseUrl = getBackendWsUrl(settings);
  const sessionId = `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  // The browser WebSocket API can't set custom headers, so the auth token
  // (backend/auth.py) travels as a query param instead. This only leaves the
  // service-worker/background context, which page-level content scripts and
  // arbitrary web pages never see.
  const tokenParam = settings.authToken ? `?token=${encodeURIComponent(settings.authToken)}` : "";
  const ws = new WebSocket(`${baseUrl}/ws/${sessionId}${tokenParam}`);

  ws.onopen = () => {
    console.log(`[Snag] WS connected: ${sessionId}`);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleBackendMessage(tabId, sessionId, msg);
    } catch (e) {
      console.error("[Snag] WS parse error:", e);
    }
  };

  ws.onclose = () => {
    console.log(`[Snag] WS disconnected: ${sessionId}`);
    tabSessions.delete(tabId);
  };

  const session: TabSession = { sessionId, ws };
  tabSessions.set(tabId, session);
  return session;
}

function getSession(tabId: number): TabSession | undefined {
  return tabSessions.get(tabId);
}

function sendToBackend(tabId: number, message: object) {
  const session = getSession(tabId);
  if (session && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify(message));
  }
}

async function handleBackendMessage(tabId: number, sessionId: string, msg: { type: string; payload: Record<string, unknown> }) {
  if (msg.type === "answer:context") {
    const ctx = pendingContexts.get(sessionId);
    if (ctx) {
      pendingContexts.delete(sessionId);
      await callLLMDirectly(tabId, sessionId, msg.payload, ctx);
      return;
    }
  }

  // Forward all other messages to content script
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

async function callLLMDirectly(
  tabId: number,
  sessionId: string,
  context: Record<string, unknown>,
  original: { company: string; role: string; question: string; fieldId: string },
) {
  const settings = await getSettings();
  const systemPrompt = context.systemPrompt as string;
  const prompt = context.prompt as string;

  // Try streaming first, fall back to non-streaming
  try {
    let fullText = "";
    await llmGenerateStream(systemPrompt, prompt, settings, {
      onChunk: (chunk) => {
        fullText += chunk;
        chrome.tabs.sendMessage(tabId, {
          type: "answer:stream",
          payload: { fieldId: original.fieldId, chunk, partial: fullText },
        }).catch(() => {});
      },
      onDone: () => {
        // Note: the draft is NOT saved to memory here. It's only a suggestion
        // until the user accepts/edits+accepts it via the review UI, which
        // triggers a "fill:approve" (or "answer:edit") message that the
        // backend persists as approved memory.
        chrome.tabs.sendMessage(tabId, {
          type: "answer:draft",
          payload: {
            fieldId: original.fieldId,
            question: original.question,
            draft: fullText,
            error: null,
            questionType: context.questionType,
            company: original.company || context.company,
            role: original.role || context.role,
            confidence: fullText.length > 20 ? 0.7 : 0.3,
            profileUsed: context.profileUsed,
            memoryCount: context.memoryCount,
          },
        }).catch(() => {});
      },
      onError: (error) => {
        console.error("[Snag] LLM error:", error);
        chrome.tabs.sendMessage(tabId, {
          type: "answer:draft",
          payload: {
            fieldId: original.fieldId,
            question: original.question,
            draft: "",
            error: `LLM generation failed: ${error}`,
            questionType: context.questionType,
            company: original.company,
            role: original.role,
            confidence: 0,
            profileUsed: [],
            memoryCount: 0,
          },
        }).catch(() => {});
      },
    });
  } catch (e) {
    console.error("[Snag] LLM stream failed, trying non-streaming:", e);
    try {
      const result = await llmGenerate(systemPrompt, prompt, settings);
      chrome.tabs.sendMessage(tabId, {
        type: "answer:draft",
        payload: {
          fieldId: original.fieldId,
          question: original.question,
          draft: result,
          error: null,
          questionType: context.questionType,
          company: original.company || context.company,
          role: original.role || context.role,
          confidence: result.length > 20 ? 0.7 : 0.3,
          profileUsed: context.profileUsed,
          memoryCount: context.memoryCount,
        },
      }).catch(() => {});
    } catch (e2) {
      chrome.tabs.sendMessage(tabId, {
        type: "answer:draft",
        payload: {
          fieldId: original.fieldId,
          question: original.question,
          draft: "",
          error: `LLM generation failed: ${e2}`,
          questionType: context.questionType,
          company: original.company,
          role: original.role,
          confidence: 0,
          profileUsed: [],
          memoryCount: 0,
        },
      }).catch(() => {});
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  if (message.type === "deactivate") return;

  let session = getSession(tabId);

  if (message.type === "answer:generate") {
    // Intercept answer generation: request context from backend, then call LLM directly
    if (!session) {
      createSession(tabId).then((s) => {
        const payload = message.payload || {};
        pendingContexts.set(s.sessionId, {
          tabId,
          company: payload.company || "",
          role: payload.role || "",
          question: payload.question || "",
          fieldId: payload.fieldId || "",
        });
        s.ws.addEventListener("open", () => {
          s.ws.send(JSON.stringify(message));
        }, { once: true });
      });
      return;
    }

    const payload = message.payload || {};
    pendingContexts.set(session.sessionId, {
      tabId,
      company: payload.company || "",
      role: payload.role || "",
      question: payload.question || "",
      fieldId: payload.fieldId || "",
    });
    sendToBackend(tabId, message);
    return;
  }

  // For all other messages, just forward to backend
  if (!session) {
    createSession(tabId).then((s) => sendToBackend(tabId, message));
    return;
  }
  sendToBackend(tabId, message);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = tabSessions.get(tabId);
  if (session) {
    pendingContexts.delete(session.sessionId);
    session.ws.close();
    tabSessions.delete(tabId);
  }
  activeTabs.delete(tabId);
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
