// Snag settings page (extension page, direct chrome.runtime access).
// Sections: account/plan, local-data notice, advanced BYOK (off by default,
// parked until the local-model phase), profile defaults, debugging.

interface Settings {
  localModelMode: boolean;
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  ollamaUrl: string;
  ollamaModel: string;
  backendUrl: string;
  authToken: string;
  debugLogging: boolean;
  defaultCompany: string;
  defaultRole: string;
}

const DEFAULTS: Settings = {
  localModelMode: false,
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

// Must stay in sync with ui/src/lib/pricing.ts.
const PADDLE_PORTAL_URL = "https://REPLACE_WITH_PADDLE_CUSTOMER_PORTAL_URL";

// Must stay in sync with optional_host_permissions in manifest.json.
const OPTIONAL_ORIGINS = [
  "https://api.anthropic.com/*",
  "https://api.openai.com/*",
  "https://api.groq.com/*",
  "http://127.0.0.1/*",
  "http://localhost/*",
];

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
// this page just renders the reduced session + subscription view.
// ---------------------------------------------------------------------------

interface AccountView {
  session?: { sub: string; email: string } | null;
  subscription?: { status: string; currentPeriodEnd: string | null } | null;
}

function renderAccount(view: AccountView) {
  const email = div("accountEmail");
  const detail = div("accountDetail");
  const pill = div("planPill");
  const signInBtn = div("signInBtn");
  const manageBtn = div("manageBtn");
  const signOutBtn = div("signOutBtn");

  if (view.session) {
    email.textContent = view.session.email;
    if (view.subscription?.status === "active") {
      const until = view.subscription.currentPeriodEnd
        ? ` · until ${new Date(view.subscription.currentPeriodEnd).toLocaleDateString()}`
        : "";
      detail.textContent = `Subscription active${until}`;
      pill.textContent = "Pro";
      pill.className = "pill active";
    } else {
      detail.textContent = "No active subscription — subscribe from the sidebar to generate answers.";
      pill.textContent = "No plan";
      pill.className = "pill inactive";
    }
    signInBtn.style.display = "none";
    manageBtn.style.display = "";
    signOutBtn.style.display = "";
  } else {
    email.textContent = "Not signed in";
    detail.textContent = "Sign in to generate answers from your Snag subscription.";
    pill.textContent = "No plan";
    pill.className = "pill none";
    signInBtn.style.display = "";
    manageBtn.style.display = "none";
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
// Advanced: local model mode (BYOK) — parked; enabling it requests the
// optional host permissions the provider calls would need.
// ---------------------------------------------------------------------------

function setByokVisible(on: boolean) {
  div("byokFields").style.display = on ? "block" : "none";
}

async function onLocalModeToggled(on: boolean) {
  setByokVisible(on);
  try {
    if (on) {
      const granted = await chrome.permissions.request({ origins: OPTIONAL_ORIGINS });
      if (!granted) showStatus("Local model mode needs the provider API permission — enable it and retry.", "error");
    } else {
      await chrome.permissions.remove({ origins: OPTIONAL_ORIGINS });
    }
  } catch (e) {
    showStatus(`Could not update permissions: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

// ---------------------------------------------------------------------------

function toggleKeyVisibility() {
  const input = inp("apiKey");
  input.type = input.type === "password" ? "text" : "password";
}

function toggleAuthTokenVisibility() {
  const input = inp("authToken");
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
  // chrome.storage.local (not .sync): this holds the backend auth token and
  // the BYOK API key — neither should sync to the user's Google account.
  const stored = await chrome.storage.local.get("settings");
  const s: Settings = { ...DEFAULTS, ...(stored.settings || {}) };

  inp("localModelMode").checked = s.localModelMode;
  setByokVisible(s.localModelMode);
  sel("provider").value = s.provider;
  inp("apiKey").value = s.apiKey;
  inp("baseUrl").value = s.baseUrl;
  inp("model").value = s.model;
  inp("ollamaUrl").value = s.ollamaUrl;
  inp("ollamaModel").value = s.ollamaModel;
  inp("backendUrl").value = s.backendUrl;
  inp("authToken").value = s.authToken;
  inp("debugLogging").checked = s.debugLogging;
  inp("defaultCompany").value = s.defaultCompany;
  inp("defaultRole").value = s.defaultRole;

  updateProviderUI();
  refreshAccount();
}

async function saveSettings() {
  const settings: Settings = {
    localModelMode: inp("localModelMode").checked,
    provider: sel("provider").value,
    apiKey: inp("apiKey").value.trim(),
    baseUrl: inp("baseUrl").value.trim(),
    model: inp("model").value.trim(),
    ollamaUrl: inp("ollamaUrl").value.trim() || DEFAULTS.ollamaUrl,
    ollamaModel: inp("ollamaModel").value.trim() || DEFAULTS.ollamaModel,
    backendUrl: inp("backendUrl").value.trim() || DEFAULTS.backendUrl,
    authToken: inp("authToken").value.trim(),
    debugLogging: inp("debugLogging").checked,
    defaultCompany: inp("defaultCompany").value.trim(),
    defaultRole: inp("defaultRole").value.trim(),
  };

  await chrome.storage.local.set({ settings });
  showStatus("Settings saved!", "success");
}

function resetDefaults() {
  inp("localModelMode").checked = DEFAULTS.localModelMode;
  setByokVisible(DEFAULTS.localModelMode);
  sel("provider").value = DEFAULTS.provider;
  inp("apiKey").value = DEFAULTS.apiKey;
  inp("baseUrl").value = DEFAULTS.baseUrl;
  inp("model").value = DEFAULTS.model;
  inp("ollamaUrl").value = DEFAULTS.ollamaUrl;
  inp("ollamaModel").value = DEFAULTS.ollamaModel;
  inp("backendUrl").value = DEFAULTS.backendUrl;
  inp("authToken").value = DEFAULTS.authToken;
  inp("debugLogging").checked = DEFAULTS.debugLogging;
  inp("defaultCompany").value = DEFAULTS.defaultCompany;
  inp("defaultRole").value = DEFAULTS.defaultRole;
  updateProviderUI();
  showStatus("Defaults restored. Click Save to apply.", "success");
}

(window as any).toggleKeyVisibility = toggleKeyVisibility;
(window as any).toggleAuthTokenVisibility = toggleAuthTokenVisibility;

sel("provider").addEventListener("change", updateProviderUI);
document.getElementById("saveBtn")!.addEventListener("click", saveSettings);
document.getElementById("resetBtn")!.addEventListener("click", resetDefaults);
document.getElementById("toggleVis")!.addEventListener("click", toggleKeyVisibility);
document.getElementById("toggleAuthVis")!.addEventListener("click", toggleAuthTokenVisibility);
(inp("localModelMode") as HTMLInputElement).addEventListener("change", (e) =>
  onLocalModeToggled((e.target as HTMLInputElement).checked),
);

div("signInBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "auth:signIn" }).catch(() => {});
});
div("signOutBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "auth:signOut" }).catch(() => {});
});
div("manageBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: PADDLE_PORTAL_URL });
});

loadSettings();
