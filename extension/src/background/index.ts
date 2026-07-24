import { getSettings, getBackendWsUrl } from "../shared/config.js";

interface TabSession {
  sessionId: string;
  ws: WebSocket;
}

const tabSessions = new Map<number, TabSession>();
const activeTabs = new Set<number>();

async function createSession(tabId: number): Promise<TabSession> {
  const settings = await getSettings();
  const baseUrl = getBackendWsUrl(settings);
  const sessionId = `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const ws = new WebSocket(`${baseUrl}/ws/${sessionId}`);

  ws.onopen = () => {
    console.log(`[Snag] WS connected: ${sessionId}`);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      chrome.tabs.sendMessage(tabId, msg).catch(() => {});
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

chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  if (message.type === "deactivate") return;

  let session = getSession(tabId);
  if (!session) {
    createSession(tabId).then((s) => sendToBackend(tabId, message));
    return;
  }
  sendToBackend(tabId, message);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = tabSessions.get(tabId);
  if (session) {
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
