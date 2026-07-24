import { useEffect, useRef, useState, useCallback } from "react";

export interface WebSocketMessage {
  type: string;
  payload: Record<string, unknown>;
}

interface UseWebSocketReturn {
  connected: boolean;
  sessionId: string | null;
  lastMessage: WebSocketMessage | null;
  messages: WebSocketMessage[];
  send: (msg: object) => void;
  backendUrl: string;
}

const isInIframe = window.self !== window.top;

const DEFAULT_BACKEND_URL = "ws://127.0.0.1:8765";

function getBackendUrl(): string {
  try {
    if (typeof chrome !== "undefined" && chrome.storage) {
      return DEFAULT_BACKEND_URL;
    }
  } catch {}
  return DEFAULT_BACKEND_URL;
}

export function useWebSocket(): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [backendUrl, setBackendUrl] = useState(getBackendUrl);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.sync.get("settings", (data: Record<string, unknown>) => {
        const s = data?.settings as Record<string, string> | undefined;
        setBackendUrl(s?.backendUrl || DEFAULT_BACKEND_URL);
      });
    }
  }, []);

  useEffect(() => {
    if (!backendUrl) return;

    function handleParentMessage(event: MessageEvent) {
      if (event.data?.source === "snag" && event.data?.msg) {
        const msg = event.data.msg as WebSocketMessage;
        setLastMessage(msg);
        setMessages((prev) => [...prev, msg]);
        if (msg.type === "status:update" && msg.payload?.sessionId) {
          setSessionId(msg.payload.sessionId as string);
          setConnected(true);
        }
      }
    }

    window.addEventListener("message", handleParentMessage);

    if (!isInIframe) {
      function connect() {
        const session = `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const wsUrl = backendUrl.replace(/\/$/, "");
        const ws = new WebSocket(`${wsUrl}/ws/${session}`);

        ws.onopen = () => {
          setConnected(true);
          setSessionId(session);
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            setLastMessage(msg);
            setMessages((prev) => [...prev, msg]);
            if (msg.type === "status:update" && msg.payload?.sessionId) {
              setSessionId(msg.payload.sessionId as string);
            }
          } catch {}
        };

        ws.onclose = () => {
          setConnected(false);
          setTimeout(connect, 3000);
        };

        ws.onerror = () => ws.close();

        wsRef.current = ws;
      }

      connect();
    } else {
      setConnected(true);
    }

    return () => {
      window.removeEventListener("message", handleParentMessage);
      wsRef.current?.close();
    };
  }, [backendUrl]);

  const send = useCallback((msg: object) => {
    if (isInIframe) {
      window.parent.postMessage(
        { source: "snag", type: (msg as Record<string, unknown>).type, payload: (msg as Record<string, unknown>).payload },
        "*"
      );
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { connected, sessionId, lastMessage, messages, send, backendUrl };
}
