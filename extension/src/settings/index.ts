interface Settings {
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

const DEFAULTS: Settings = {
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

const PROVIDER_HINTS: Record<string, string> = {
  openai: "Get your key at <a href='https://platform.openai.com/api-keys' target='_blank'>platform.openai.com</a>",
  anthropic: "Get your key at <a href='https://console.anthropic.com/' target='_blank'>console.anthropic.com</a>",
  groq: "Get your free key at <a href='https://console.groq.com/keys' target='_blank'>console.groq.com</a>",
  "openai-compatible": "Enter any OpenAI-compatible API key",
};

const PROVIDER_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  groq: "llama-3.1-70b-versatile",
  "openai-compatible": "",
};

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  groq: "https://api.groq.com/openai/v1",
};

function sel(id: string): HTMLSelectElement {
  return document.getElementById(id) as HTMLSelectElement;
}

function inp(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

function div(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function showStatus(msg: string, type: "success" | "error") {
  const el = div("status");
  el.textContent = msg;
  el.className = `status show ${type}`;
  setTimeout(() => (el.className = "status"), 3000);
}

function toggleKeyVisibility() {
  const input = inp("apiKey");
  input.type = input.type === "password" ? "text" : "password";
}

function updateProviderUI() {
  const provider = sel("provider").value;
  const needsKey = provider !== "ollama";
  const isOpenAICompat = provider === "openai-compatible";

  div("apiKeyField").style.display = needsKey ? "block" : "none";
  div("ollamaUrlField").style.display = provider === "ollama" ? "block" : "none";
  div("ollamaModelField").style.display = provider === "ollama" ? "block" : "none";
  div("baseUrlField").style.display = isOpenAICompat ? "block" : "none";
  div("modelField").style.display = provider !== "ollama" ? "block" : "none";

  if (needsKey) {
    div("apiKeyHint").innerHTML = PROVIDER_HINTS[provider] || "";
    inp("model").placeholder = PROVIDER_MODELS[provider] || "model-name";
    if (!isOpenAICompat) {
      inp("baseUrl").value = PROVIDER_BASE_URLS[provider] || "";
    }
  }
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get("settings");
  const s: Settings = { ...DEFAULTS, ...(stored.settings || {}) };

  sel("provider").value = s.provider;
  inp("apiKey").value = s.apiKey;
  inp("baseUrl").value = s.baseUrl;
  inp("model").value = s.model;
  inp("ollamaUrl").value = s.ollamaUrl;
  inp("ollamaModel").value = s.ollamaModel;
  inp("backendUrl").value = s.backendUrl;
  inp("defaultCompany").value = s.defaultCompany;
  inp("defaultRole").value = s.defaultRole;

  updateProviderUI();
}

async function saveSettings() {
  const settings: Settings = {
    provider: sel("provider").value,
    apiKey: inp("apiKey").value.trim(),
    baseUrl: inp("baseUrl").value.trim(),
    model: inp("model").value.trim(),
    ollamaUrl: inp("ollamaUrl").value.trim() || DEFAULTS.ollamaUrl,
    ollamaModel: inp("ollamaModel").value.trim() || DEFAULTS.ollamaModel,
    backendUrl: inp("backendUrl").value.trim() || DEFAULTS.backendUrl,
    defaultCompany: inp("defaultCompany").value.trim(),
    defaultRole: inp("defaultRole").value.trim(),
  };

  await chrome.storage.sync.set({ settings });
  showStatus("Settings saved!", "success");
}

function resetDefaults() {
  sel("provider").value = DEFAULTS.provider;
  inp("apiKey").value = DEFAULTS.apiKey;
  inp("baseUrl").value = DEFAULTS.baseUrl;
  inp("model").value = DEFAULTS.model;
  inp("ollamaUrl").value = DEFAULTS.ollamaUrl;
  inp("ollamaModel").value = DEFAULTS.ollamaModel;
  inp("backendUrl").value = DEFAULTS.backendUrl;
  inp("defaultCompany").value = DEFAULTS.defaultCompany;
  inp("defaultRole").value = DEFAULTS.defaultRole;
  updateProviderUI();
  showStatus("Defaults restored. Click Save to apply.", "success");
}

(window as any).toggleKeyVisibility = toggleKeyVisibility;
(window as any).saveSettings = saveSettings;
(window as any).resetDefaults = resetDefaults;

sel("provider").addEventListener("change", updateProviderUI);

loadSettings();
