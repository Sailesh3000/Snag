import { useState, useEffect } from "react";

export interface ProviderSettings {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

const DEFAULTS: ProviderSettings = {
  provider: "ollama",
  apiKey: "",
  model: "",
  baseUrl: "",
};

export function useProvider(): ProviderSettings {
  const [settings, setSettings] = useState<ProviderSettings>(DEFAULTS);

  useEffect(() => {
    function load() {
      if (typeof chrome !== "undefined" && chrome.storage) {
        chrome.storage.sync.get("settings", (data: Record<string, unknown>) => {
          const s = data?.settings as Record<string, string> | undefined;
          if (s) {
            const provider = s.provider || "ollama";
            const baseUrl = provider === "ollama"
              ? (s.ollamaUrl || "http://127.0.0.1:11434")
              : (s.baseUrl || "");
            setSettings({
              provider,
              apiKey: s.apiKey || "",
              model: s.model || "",
              baseUrl,
            });
          }
        });
      }
    }
    load();

    if (typeof chrome !== "undefined" && chrome.storage) {
      const listener = (_changes: any, area: string) => {
        if (area === "sync") load();
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    }
  }, []);

  return settings;
}

export function getProviderHeaders(s: ProviderSettings): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  headers["X-Provider"] = s.provider;
  if (s.apiKey) headers["X-API-Key"] = s.apiKey;
  if (s.model) headers["X-Model"] = s.model;
  if (s.baseUrl) headers["X-Base-URL"] = s.baseUrl;
  return headers;
}
