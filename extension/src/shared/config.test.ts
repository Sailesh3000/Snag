import { describe, expect, it } from "vitest";

function makeChromeStub(initial: Record<string, unknown> = {}) {
  const map = new Map<string, unknown>(Object.entries(initial));
  return {
    storage: {
      local: {
        get: async (key: string) => (map.has(key) ? { [key]: map.get(key) } : {}),
      },
    },
  };
}

describe("getSettings", () => {
  it("returns defaults when nothing is stored", async () => {
    (globalThis as any).chrome = makeChromeStub();
    const { getSettings } = await import("./config.js");

    const settings = await getSettings();

    expect(settings).toMatchObject({
      provider: "ollama",
      apiKey: "",
      ollamaUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen3:8b",
      debugLogging: false,
    });
  });

  it("merges stored settings over the defaults", async () => {
    (globalThis as any).chrome = makeChromeStub({
      settings: { provider: "anthropic", apiKey: "sk-ant-123" },
    });
    const { getSettings } = await import("./config.js");

    const settings = await getSettings();

    expect(settings.provider).toBe("anthropic");
    expect(settings.apiKey).toBe("sk-ant-123");
    // Unset fields still fall back to defaults.
    expect(settings.ollamaUrl).toBe("http://127.0.0.1:11434");
  });
});
