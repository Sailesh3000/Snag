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
        chrome.storage.local.get("settings", (data: Record<string, unknown>) => {
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
        if (area === "local") load();
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    }
  }, []);

  return settings;
}
