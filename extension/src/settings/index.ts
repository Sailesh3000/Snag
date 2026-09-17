// Snag settings page (extension page, direct chrome.runtime access).
// Sections: account, local-data notice, AI provider (BYOK — the only way
// answers are generated), profile defaults, debugging. Free product, no
// billing/plan concept.

interface Settings {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  ollamaUrl: string;
  ollamaModel: string;
  debugLogging: boolean;
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
  debugLogging: false,
  defaultCompany: "",
  defaultRole: "",
};

// Must stay in sync with optional_host_permissions in manifest.json.
// Requested per-provider on Save (not all at once) — least-privilege, and
// avoids a scary blanket permission prompt for a provider the user never
// picked.
const PROVIDER_ORIGINS: Record<string, string> = {
  openai: "https://api.openai.com/*",
  anthropic: "https://api.anthropic.com/*",
  groq: "https://api.groq.com/*",
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

// ---------------------------------------------------------------------------
// Account section — background is the only place that talks to /api/me;
// this page just renders the reduced session view.
// ---------------------------------------------------------------------------

interface AccountView {
  session?: { sub: string; email: string } | null;
}

function renderAccount(view: AccountView) {
  const email = div("accountEmail");
  const detail = div("accountDetail");
  const signInBtn = div("signInBtn");
  const signOutBtn = div("signOutBtn");

  if (view.session) {
    email.textContent = view.session.email;
    detail.textContent = "Signed in";
    signInBtn.style.display = "none";
    signOutBtn.style.display = "";
  } else {
    email.textContent = "Not signed in";
    detail.textContent = "Sign in to use Snag.";
    signInBtn.style.display = "";
    signOutBtn.style.display = "none";
  }
}

function refreshAccount() {
  chrome.runtime.sendMessage({ type: "auth:status" }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg: { type: string; payload?: AccountView }) => {
  if (msg.type === "auth:status" || msg.type === "auth:updated") {
    renderAccount(msg.payload || {});
  }
});

// ---------------------------------------------------------------------------

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

/** Least-privilege: request only the picked provider's origin (Ollama's
 * localhost origin, or a cloud provider's origin once a key is entered) —
 * not all optional origins at once. */
/** "openai-compatible" has no fixed domain — the user types their own
 *  base URL (LM Studio, Together AI, Fireworks, ...). manifest.json
 *  declares a broad `https://*\/*` optional permission specifically so
 *  THIS function can request just that one specific origin at runtime —
 *  Chrome only grants the exact pattern requested, never the full
 *  wildcard, so this stays scoped to whatever domain the user actually
 *  configured. */
function originFor(baseUrl: string): string | null {
  try {
    return `${new URL(baseUrl).origin}/*`;
  } catch {
    return null;
  }
}

async function requestProviderPermissionIfNeeded(provider: string, apiKey: string, baseUrl: string): Promise<void> {
  let origins: string[];
  if (provider === "ollama") {
    origins = ["http://127.0.0.1/*", "http://localhost/*"];
  } else if (provider === "openai-compatible") {
    const origin = apiKey ? originFor(baseUrl) : null;
    origins = origin ? [origin] : [];
  } else {
    origins = PROVIDER_ORIGINS[provider] && apiKey ? [PROVIDER_ORIGINS[provider]] : [];
  }
  if (origins.length === 0) return;
  try {
    const granted = await chrome.permissions.request({ origins });
    if (!granted) showStatus(`Snag needs permission to reach ${provider} to generate answers.`, "error");
  } catch (e) {
    showStatus(`Could not update permissions: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

async function loadSettings() {
  // chrome.storage.local (not .sync): settings include the BYOK API key,
  // which shouldn't sync to the user's Google account.
  const stored = await chrome.storage.local.get("settings");
  const s: Settings = { ...DEFAULTS, ...(stored.settings || {}) };

  sel("provider").value = s.provider;
  inp("apiKey").value = s.apiKey;
  inp("baseUrl").value = s.baseUrl;
  inp("model").value = s.model;
  inp("ollamaUrl").value = s.ollamaUrl;
  inp("ollamaModel").value = s.ollamaModel;
  inp("debugLogging").checked = s.debugLogging;
  inp("defaultCompany").value = s.defaultCompany;
  inp("defaultRole").value = s.defaultRole;

  updateProviderUI();
  refreshAccount();
}

async function saveSettings() {
  const settings: Settings = {
    provider: sel("provider").value,
    apiKey: inp("apiKey").value.trim(),
    baseUrl: inp("baseUrl").value.trim(),
    model: inp("model").value.trim(),
    ollamaUrl: inp("ollamaUrl").value.trim() || DEFAULTS.ollamaUrl,
    ollamaModel: inp("ollamaModel").value.trim() || DEFAULTS.ollamaModel,
    debugLogging: inp("debugLogging").checked,
    defaultCompany: inp("defaultCompany").value.trim(),
    defaultRole: inp("defaultRole").value.trim(),
  };

  await chrome.storage.local.set({ settings });
  await requestProviderPermissionIfNeeded(settings.provider, settings.apiKey, settings.baseUrl);
  showStatus("Settings saved!", "success");
}

function resetDefaults() {
  sel("provider").value = DEFAULTS.provider;
  inp("apiKey").value = DEFAULTS.apiKey;
  inp("baseUrl").value = DEFAULTS.baseUrl;
  inp("model").value = DEFAULTS.model;
  inp("ollamaUrl").value = DEFAULTS.ollamaUrl;
  inp("ollamaModel").value = DEFAULTS.ollamaModel;
  inp("debugLogging").checked = DEFAULTS.debugLogging;
  inp("defaultCompany").value = DEFAULTS.defaultCompany;
  inp("defaultRole").value = DEFAULTS.defaultRole;
  updateProviderUI();
  showStatus("Defaults restored. Click Save to apply.", "success");
}

(window as any).toggleKeyVisibility = toggleKeyVisibility;

sel("provider").addEventListener("change", updateProviderUI);
document.getElementById("saveBtn")!.addEventListener("click", saveSettings);
document.getElementById("resetBtn")!.addEventListener("click", resetDefaults);
document.getElementById("toggleVis")!.addEventListener("click", toggleKeyVisibility);

div("signInBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "auth:signIn" }).catch(() => {});
});
div("signOutBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "auth:signOut" }).catch(() => {});
});

loadSettings();
