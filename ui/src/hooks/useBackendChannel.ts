import { useEffect, useState, useCallback } from "react";
import { isInIframe, postToBackground } from "../lib/channel";

export type ConnectionStatus = "connected" | "offline";

export interface ChannelMessage {
  type: string;
  payload: Record<string, unknown>;
}

interface UseBackendChannelReturn {
  connected: boolean;
  connectionStatus: ConnectionStatus;
  lastMessage: ChannelMessage | null;
  messages: ChannelMessage[];
  send: (msg: object) => void;
}

// Sidebar ⇄ background channel (plan B3: renamed from useWebSocket, and the
// dead real-WebSocket branch to the retired local backend is gone). The
// "connection" is the postMessage relay itself — it's up the moment the
// content script has injected the iframe.
export function useBackendChannel(): UseBackendChannelReturn {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [connected, setConnected] = useState(isInIframe);

  useEffect(() => {
    if (!isInIframe) return;
    setConnected(true);

    function handleParentMessage(event: MessageEvent) {
      if (event.data?.source === "snag" && event.data?.msg) {
        setMessages((prev) => [...prev, event.data.msg as ChannelMessage]);
      }
    }
    window.addEventListener("message", handleParentMessage);
    return () => window.removeEventListener("message", handleParentMessage);
  }, []);

  const send = useCallback((msg: object) => {
    postToBackground({
      type: (msg as Record<string, unknown>).type as string,
      payload: (msg as Record<string, unknown>).payload,
    });
  }, []);

  return {
    connected,
    connectionStatus: connected ? "connected" : "offline",
    lastMessage: messages[messages.length - 1] ?? null,
    messages,
    send,
  };
}
