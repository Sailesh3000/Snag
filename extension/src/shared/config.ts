// BYOK provider settings (revised plan: this is the primary, only path for
// LLM generation — see llm/client.ts, which resolves the actual model/base
// URL per provider). `getSettings()` is also read directly by
// background/index.ts to decide whether an API key is configured before
// attempting a generation.

const DEFAULTS = {
  provider: "ollama",
  apiKey: "",
  baseUrl: "",
  model: "",
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "qwen3:8b",
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
  // Verbose console logging in the content script (field-extraction dumps
  // on every scan). Off by default — see content/index.ts's sendPageUpdate.
  debugLogging: boolean;
  defaultCompany: string;
  defaultRole: string;
}

// chrome.storage.local (not .sync): settings include the BYOK API key,
// which shouldn't sync to the user's Google account across devices.
export async function getSettings(): Promise<ExtensionSettings> {
  const data = await chrome.storage.local.get("settings");
  return { ...DEFAULTS, ...(data.settings || {}) };
}
