import logging
from abc import ABC, abstractmethod

import httpx

logger = logging.getLogger(__name__)


class LLMProvider(ABC):
    @abstractmethod
    async def generate(self, system: str, prompt: str, **kwargs) -> str:
        ...

    @abstractmethod
    async def generate_stream(self, system: str, prompt: str, **kwargs):
        ...


class OllamaProvider(LLMProvider):
    def __init__(self, base_url: str, model: str, timeout: float | None = None, keep_alive: str = "10m"):
        self.base_url = base_url
        self.model = model
        self.timeout = timeout
        self.keep_alive = keep_alive

    async def generate(self, system: str, prompt: str, **kwargs) -> str:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(
                f"{self.base_url}/api/generate",
                json={
                    "model": self.model,
                    "system": system,
                    "prompt": f"/no_think\n{prompt}",
                    "stream": False,
                    "options": {
                        "num_predict": kwargs.get("max_tokens", 1024),
                        "temperature": kwargs.get("temperature", 0.7),
                        "top_p": kwargs.get("top_p", 0.9),
                    },
                },
            )
            r.raise_for_status()
            body = r.json()
            raw = body.get("response", "").strip()
            if not raw and body.get("thinking"):
                raw = body["thinking"].strip()
            logger.info(f"Ollama response: {len(raw)} chars, done_reason={body.get('done_reason')}")
            return raw

    async def generate_stream(self, system: str, prompt: str, **kwargs):
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/generate",
                json={
                    "model": self.model,
                    "system": system,
                    "prompt": f"/no_think\n{prompt}",
                    "stream": True,
                    "options": {
                        "num_predict": kwargs.get("max_tokens", 1024),
                        "temperature": kwargs.get("temperature", 0.7),
                        "top_p": kwargs.get("top_p", 0.9),
                    },
                },
            ) as resp:
                async for line in resp.aiter_lines():
                    if line.strip():
                        try:
                            import json
                            chunk = json.loads(line)
                            text = chunk.get("response", "")
                            if text:
                                yield text
                        except Exception:
                            pass


class OpenAIProvider(LLMProvider):
    def __init__(self, api_key: str, model: str = "gpt-4o-mini", base_url: str = "https://api.openai.com/v1"):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")

    async def generate(self, system: str, prompt: str, **kwargs) -> str:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": kwargs.get("max_tokens", 300),
                    "temperature": kwargs.get("temperature", 0.7),
                },
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"].strip()

    async def generate_stream(self, system: str, prompt: str, **kwargs):
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": kwargs.get("max_tokens", 300),
                    "temperature": kwargs.get("temperature", 0.7),
                    "stream": True,
                },
            ) as resp:
                async for line in resp.aiter_lines():
                    if line.startswith("data: ") and line != "data: [DONE]":
                        try:
                            import json
                            data = json.loads(line[6:])
                            delta = data["choices"][0].get("delta", {})
                            text = delta.get("content", "")
                            if text:
                                yield text
                        except Exception:
                            pass


class AnthropicProvider(LLMProvider):
    def __init__(self, api_key: str, model: str = "claude-3-5-haiku-20241022"):
        self.api_key = api_key
        self.model = model

    async def generate(self, system: str, prompt: str, **kwargs) -> str:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": self.model,
                    "max_tokens": kwargs.get("max_tokens", 300),
                    "system": system,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            r.raise_for_status()
            return r.json()["content"][0]["text"].strip()

    async def generate_stream(self, system: str, prompt: str, **kwargs):
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": self.model,
                    "max_tokens": kwargs.get("max_tokens", 300),
                    "system": system,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": True,
                },
            ) as resp:
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        try:
                            import json
                            data = json.loads(line[6:])
                            if data.get("type") == "content_block_delta":
                                yield data["delta"].get("text", "")
                        except Exception:
                            pass


class GroqProvider(LLMProvider):
    def __init__(self, api_key: str, model: str = "llama-3.1-70b-versatile"):
        self.api_key = api_key
        self.model = model

    async def generate(self, system: str, prompt: str, **kwargs) -> str:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": kwargs.get("max_tokens", 300),
                    "temperature": kwargs.get("temperature", 0.7),
                },
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"].strip()

    async def generate_stream(self, system: str, prompt: str, **kwargs):
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": kwargs.get("max_tokens", 300),
                    "temperature": kwargs.get("temperature", 0.7),
                    "stream": True,
                },
            ) as resp:
                async for line in resp.aiter_lines():
                    if line.startswith("data: ") and line != "data: [DONE]":
                        try:
                            import json
                            data = json.loads(line[6:])
                            delta = data["choices"][0].get("delta", {})
                            text = delta.get("content", "")
                            if text:
                                yield text
                        except Exception:
                            pass


def get_provider(provider: str, api_key: str = "", model: str = "", base_url: str = "") -> LLMProvider:
    if provider == "ollama":
        from backend.config import settings
        effective_url = base_url or settings.ollama_url
        logger.info(f"Ollama provider: base_url={base_url!r}, effective_url={effective_url!r}")
        return OllamaProvider(
            base_url=effective_url,
            model=model or "qwen3:8b",
        )
    elif provider == "openai":
        return OpenAIProvider(api_key=api_key, model=model or "gpt-4o-mini")
    elif provider == "anthropic":
        return AnthropicProvider(api_key=api_key, model=model or "claude-3-5-haiku-20241022")
    elif provider == "groq":
        return GroqProvider(api_key=api_key, model=model or "llama-3.1-70b-versatile")
    elif provider == "openai-compatible":
        return OpenAIProvider(api_key=api_key, model=model, base_url=base_url)
    else:
        raise ValueError(f"Unknown provider: {provider}")
