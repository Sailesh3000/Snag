import { useEffect, useRef, useState, useCallback } from "react";

export type ConnectionStatus = "connected" | "reconnecting" | "offline";

export interface WebSocketMessage {
  type: string;
  payload: Record<string, unknown>;
}

interface UseWebSocketReturn {
  connected: boolean;
  connectionStatus: ConnectionStatus;
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
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("reconnecting");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [backendUrl, setBackendUrl] = useState(getBackendUrl);
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
          retryCountRef.current = 0;
          setConnectionStatus("connected");
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
          const attempt = retryCountRef.current++;
          const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
          setConnectionStatus(attempt >= 5 ? "offline" : "reconnecting");
          retryTimerRef.current = setTimeout(connect, delay);
        };

        ws.onerror = () => ws.close();

        wsRef.current = ws;
      }

      connect();
    } else {
      setConnected(true);
      setConnectionStatus("connected");
    }

    return () => {
      window.removeEventListener("message", handleParentMessage);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
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

  return { connected, connectionStatus, sessionId, lastMessage, messages, send, backendUrl };
}
