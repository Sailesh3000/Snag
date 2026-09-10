// The sidebar's only transport (plan B3): postMessage to the content script,
// which relays to the background service worker via chrome.runtime.sendMessage.
// In the published build the sidebar is always an injected iframe; outside an
// iframe (plain dev preview) there is no background, so sending is a no-op.

export const isInIframe = window.self !== window.top;

export interface OutboundMessage {
  type: string;
  payload?: unknown;
}

export function postToBackground(msg: OutboundMessage): void {
  if (isInIframe) {
    window.parent.postMessage({ source: "snag", ...msg }, "*");
  }
}
