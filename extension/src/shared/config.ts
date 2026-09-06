const PROVIDER_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  groq: "https://api.groq.com/openai/v1",
  "openai-compatible": "",
};

const DEFAULTS = {
  provider: "ollama",
  apiKey: "",
  baseUrl: "",
  model: "",
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "qwen3:8b",
  backendUrl: "ws://127.0.0.1:8765",
  authToken: "",
  debugLogging: false,
  defaultCompany: "",
  defaultRole: "",
};

export interface ExtensionSettings {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  ollamaUrl: string;
  ollamaModel: string;
  backendUrl: string;
  // Per-installation backend auth token (backend/auth.py). Printed to the
  // backend's console/log on first run; paste it here once. Required on
  // every REST call and WebSocket connection — see getBackendAuthHeaders /
  // background.ts's WS connect.
  authToken: string;
  // Verbose console logging in the content script (field-extraction dumps
  // on every scan). Off by default — see content/index.ts's sendPageUpdate.
  debugLogging: boolean;
  defaultCompany: string;
  defaultRole: string;
}

// chrome.storage.local (not .sync): settings include the backend auth token
// and BYOK API key — neither needs to sync to the user's Google account
// across devices, and local avoids that extra copy of the secret existing
// anywhere but this machine.
export async function getSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get("settings", (data) => {
      resolve({ ...DEFAULTS, ...(data.settings || {}) });
    });
  });
}

export function getBackendAuthHeaders(settings: ExtensionSettings): Record<string, string> {
  return settings.authToken ? { Authorization: `Bearer ${settings.authToken}` } : {};
}

export function getBackendWsUrl(settings: ExtensionSettings): string {
  return settings.backendUrl.replace(/\/$/, "");
}

export function getBackendHttpUrl(settings: ExtensionSettings): string {
  return settings.backendUrl.replace(/^ws/, "http").replace(/\/$/, "");
}

export function getProviderBaseUrl(settings: ExtensionSettings): string {
  if (settings.provider === "openai-compatible") {
    return settings.baseUrl;
  }
  return PROVIDER_URLS[settings.provider] || "";
}

export function getDefaultModel(settings: ExtensionSettings): string {
  if (settings.model) return settings.model;
  const defaults: Record<string, string> = {
    openai: "gpt-4o-mini",
    anthropic: "claude-3-5-haiku-20241022",
    groq: "llama-3.1-70b-versatile",
  };
  return defaults[settings.provider] || "";
}
