import { describe, expect, it } from "vitest";
import {
  getBackendWsUrl,
  getBackendHttpUrl,
  getProviderBaseUrl,
  getDefaultModel,
  getBackendAuthHeaders,
  type ExtensionSettings,
} from "./config.js";

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

describe("getBackendWsUrl / getBackendHttpUrl", () => {
  it("strips a trailing slash", () => {
    expect(getBackendWsUrl(settings({ backendUrl: "ws://127.0.0.1:8765/" }))).toBe("ws://127.0.0.1:8765");
  });

  it("converts ws:// to http:// for REST calls", () => {
    expect(getBackendHttpUrl(settings({ backendUrl: "ws://127.0.0.1:8765" }))).toBe("http://127.0.0.1:8765");
  });

  it("converts wss:// to https://", () => {
    expect(getBackendHttpUrl(settings({ backendUrl: "wss://snag.example.com" }))).toBe("https://snag.example.com");
  });
});

describe("getProviderBaseUrl", () => {
  it("returns the known base URL for openai", () => {
    expect(getProviderBaseUrl(settings({ provider: "openai" }))).toBe("https://api.openai.com/v1");
  });

  it("returns the user-supplied baseUrl for openai-compatible", () => {
    expect(getProviderBaseUrl(settings({ provider: "openai-compatible", baseUrl: "http://localhost:1234/v1" })))
      .toBe("http://localhost:1234/v1");
  });

  it("returns empty string for an unknown provider", () => {
    expect(getProviderBaseUrl(settings({ provider: "made-up" }))).toBe("");
  });
});

describe("getDefaultModel", () => {
  it("prefers an explicitly configured model", () => {
    expect(getDefaultModel(settings({ provider: "openai", model: "gpt-4o" }))).toBe("gpt-4o");
  });

  it("falls back to the provider's default model", () => {
    expect(getDefaultModel(settings({ provider: "anthropic" }))).toBe("claude-3-5-haiku-20241022");
  });
});

describe("getBackendAuthHeaders", () => {
  it("returns an empty object when no token is configured", () => {
    expect(getBackendAuthHeaders(settings({ authToken: "" }))).toEqual({});
  });

  it("returns a Bearer Authorization header when a token is configured", () => {
    expect(getBackendAuthHeaders(settings({ authToken: "abc123" }))).toEqual({
      Authorization: "Bearer abc123",
    });
  });
});
