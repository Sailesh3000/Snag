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

function $(id: string): HTMLInputElement | HTMLSelectElement {
  return document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
}

function showStatus(msg: string, type: "success" | "error") {
  const el = $("status");
  el.textContent = msg;
  el.className = `status show ${type}`;
  setTimeout(() => (el.className = "status"), 3000);
}

function toggleKeyVisibility() {
  const input = $("apiKey");
  input.type = input.type === "password" ? "text" : "password";
}

function updateProviderUI() {
  const provider = $("provider").value;
  const needsKey = provider !== "ollama";
  const isOpenAICompat = provider === "openai-compatible";

  $("apiKeyField").style.display = needsKey ? "block" : "none";
  $("ollamaUrlField").style.display = provider === "ollama" ? "block" : "none";
  $("ollamaModelField").style.display = provider === "ollama" ? "block" : "none";
  $("baseUrlField").style.display = isOpenAICompat ? "block" : "none";
  $("modelField").style.display = provider !== "ollama" ? "block" : "none";

  if (needsKey) {
    $("apiKeyHint").innerHTML = PROVIDER_HINTS[provider] || "";
    $("model").placeholder = PROVIDER_MODELS[provider] || "model-name";
    if (!isOpenAICompat) {
      $("baseUrl").value = PROVIDER_BASE_URLS[provider] || "";
    }
  }
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get("settings");
  const s: Settings = { ...DEFAULTS, ...(stored.settings || {}) };

  ($("provider") as HTMLSelectElement).value = s.provider;
  $("apiKey").value = s.apiKey;
  $("baseUrl").value = s.baseUrl;
  $("model").value = s.model;
  $("ollamaUrl").value = s.ollamaUrl;
  $("ollamaModel").value = s.ollamaModel;
  $("backendUrl").value = s.backendUrl;
  $("defaultCompany").value = s.defaultCompany;
  $("defaultRole").value = s.defaultRole;

  updateProviderUI();
}

async function saveSettings() {
  const settings: Settings = {
    provider: ($("provider") as HTMLSelectElement).value,
    apiKey: $("apiKey").value.trim(),
    baseUrl: $("baseUrl").value.trim(),
    model: $("model").value.trim(),
    ollamaUrl: $("ollamaUrl").value.trim() || DEFAULTS.ollamaUrl,
    ollamaModel: $("ollamaModel").value.trim() || DEFAULTS.ollamaModel,
    backendUrl: $("backendUrl").value.trim() || DEFAULTS.backendUrl,
    defaultCompany: $("defaultCompany").value.trim(),
    defaultRole: $("defaultRole").value.trim(),
  };

  await chrome.storage.sync.set({ settings });
  showStatus("Settings saved!", "success");
}

function resetDefaults() {
  ($("provider") as HTMLSelectElement).value = DEFAULTS.provider;
  $("apiKey").value = DEFAULTS.apiKey;
  $("baseUrl").value = DEFAULTS.baseUrl;
  $("model").value = DEFAULTS.model;
  $("ollamaUrl").value = DEFAULTS.ollamaUrl;
  $("ollamaModel").value = DEFAULTS.ollamaModel;
  $("backendUrl").value = DEFAULTS.backendUrl;
  $("defaultCompany").value = DEFAULTS.defaultCompany;
  $("defaultRole").value = DEFAULTS.defaultRole;
  updateProviderUI();
  showStatus("Defaults restored. Click Save to apply.", "success");
}

// Expose for HTML onclick
(window as any).toggleKeyVisibility = toggleKeyVisibility;
(window as any).saveSettings = saveSettings;
(window as any).resetDefaults = resetDefaults;

$("provider").addEventListener("change", updateProviderUI);

loadSettings();
