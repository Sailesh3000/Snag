import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveModel, resolveBaseUrl, llmGenerate } from "./client.js";
import type { ExtensionSettings } from "../shared/config.js";

function settings(overrides: Partial<ExtensionSettings> = {}): ExtensionSettings {
  return {
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
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("resolveModel", () => {
  it("prefers an explicit model over any provider default", () => {
    expect(resolveModel(settings({ provider: "ollama", model: "llama3.2", ollamaModel: "qwen3:8b" }))).toBe("llama3.2");
  });

  it("uses the configured Ollama model when no explicit model is set", () => {
    expect(resolveModel(settings({ provider: "ollama", ollamaModel: "mistral" }))).toBe("mistral");
  });

  it("falls back to qwen3:8b for Ollama with nothing configured", () => {
    expect(resolveModel(settings({ provider: "ollama", ollamaModel: "" }))).toBe("qwen3:8b");
  });

  it("uses the known default for a cloud provider", () => {
    expect(resolveModel(settings({ provider: "groq" }))).toBe("llama-3.1-70b-versatile");
  });
});

describe("resolveBaseUrl", () => {
  it("uses the user-supplied baseUrl for openai-compatible", () => {
    expect(resolveBaseUrl(settings({ provider: "openai-compatible", baseUrl: "http://localhost:1234/v1/" })))
      .toBe("http://localhost:1234/v1");
  });

  it("uses the known base URL for groq", () => {
    expect(resolveBaseUrl(settings({ provider: "groq" }))).toBe("https://api.groq.com/openai/v1");
  });

  it("returns empty string for ollama/anthropic (they don't use this base URL scheme)", () => {
    expect(resolveBaseUrl(settings({ provider: "ollama" }))).toBe("");
    expect(resolveBaseUrl(settings({ provider: "anthropic" }))).toBe("");
  });
});

describe("llmGenerate retry", () => {
  it("retries once on a transient network error and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: "second try worked" }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await llmGenerate("sys", "prompt", settings({ provider: "ollama" }));

    expect(result).toBe("second try worked");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-transient error (e.g. HTTP error)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(llmGenerate("sys", "prompt", settings({ provider: "ollama" }))).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
