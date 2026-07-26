import { ExtensionSettings } from "../shared/config.js";
import { ollamaGenerate, ollamaGenerateStream } from "./ollama.js";
import { openaiGenerate, openaiGenerateStream } from "./openai.js";
import { anthropicGenerate, anthropicGenerateStream } from "./anthropic.js";

export interface LLMStreamCallbacks {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

function resolveModel(settings: ExtensionSettings): string {
  if (settings.model) return settings.model;
  if (settings.provider === "ollama") return settings.ollamaModel || "qwen3:8b";
  const defaults: Record<string, string> = {
    openai: "gpt-4o-mini",
    anthropic: "claude-3-5-haiku-20241022",
    groq: "llama-3.1-70b-versatile",
  };
  return defaults[settings.provider] || "";
}

function resolveBaseUrl(settings: ExtensionSettings): string {
  if (settings.provider === "openai-compatible" && settings.baseUrl) {
    return settings.baseUrl.replace(/\/$/, "");
  }
  const urls: Record<string, string> = {
    openai: "https://api.openai.com/v1",
    groq: "https://api.groq.com/openai/v1",
  };
  return urls[settings.provider] || "";
}

export async function llmGenerate(
  system: string,
  prompt: string,
  settings: ExtensionSettings,
): Promise<string> {
  const model = resolveModel(settings);

  if (settings.provider === "ollama") {
    return ollamaGenerate(system, prompt, {
      baseUrl: settings.ollamaUrl || "http://127.0.0.1:11434",
      model,
    });
  }

  if (settings.provider === "anthropic") {
    return anthropicGenerate(system, prompt, {
      apiKey: settings.apiKey,
      model,
    });
  }

  // OpenAI, Groq, OpenAI-compatible all use the same API format
  return openaiGenerate(system, prompt, {
    baseUrl: resolveBaseUrl(settings),
    apiKey: settings.apiKey,
    model,
  });
}

export async function llmGenerateStream(
  system: string,
  prompt: string,
  settings: ExtensionSettings,
  callbacks: LLMStreamCallbacks,
): Promise<void> {
  const model = resolveModel(settings);

  if (settings.provider === "ollama") {
    return ollamaGenerateStream(system, prompt, {
      baseUrl: settings.ollamaUrl || "http://127.0.0.1:11434",
      model,
    }, callbacks);
  }

  if (settings.provider === "anthropic") {
    return anthropicGenerateStream(system, prompt, {
      apiKey: settings.apiKey,
      model,
    }, callbacks);
  }

  // OpenAI, Groq, OpenAI-compatible
  return openaiGenerateStream(system, prompt, {
    baseUrl: resolveBaseUrl(settings),
    apiKey: settings.apiKey,
    model,
  }, callbacks);
}
