"""Calls Ollama via OpenAI-compatible /v1/chat/completions."""

from __future__ import annotations
import httpx


class LLMAdapter:
    def __init__(self, base_url: str, model: str = "qwen3.5:8b") -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model

    async def complete(self, messages: list[dict], temperature: float = 0.4) -> str:
        async with httpx.AsyncClient(timeout=120) as client:
            res = await client.post(
                f"{self.base_url}/v1/chat/completions",
                json={"model": self.model, "messages": messages, "temperature": temperature},
            )
            res.raise_for_status()
            data = res.json()
            return data["choices"][0]["message"]["content"]
