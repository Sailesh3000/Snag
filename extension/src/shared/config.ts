const PROVIDER_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  groq: "https://api.groq.com/openai/v1",
};

const DEFAULTS = {
  provider: "ollama",
  apiKey: "",
  baseUrl: "",
  model: "",
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "qwen3:8b",
  backendUrl: "ws://127.0.0.1:8765",
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
  defaultCompany: string;
  defaultRole: string;
}

export async function getSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get("settings", (data) => {
      resolve({ ...DEFAULTS, ...(data.settings || {}) });
    });
  });
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
