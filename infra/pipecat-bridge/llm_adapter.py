"""Calls Ollama via OpenAI-compatible /v1/chat/completions.

Shares a class-level `httpx.AsyncClient` to preserve keepalive between turns.
"""

from __future__ import annotations
import asyncio
import httpx


class LLMAdapter:
    _shared_client: httpx.AsyncClient | None = None
    _client_lock = asyncio.Lock()

    def __init__(self, base_url: str, model: str = "qwen3.5:8b") -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model

    @classmethod
    async def _client(cls) -> httpx.AsyncClient:
        if cls._shared_client is None:
            async with cls._client_lock:
                if cls._shared_client is None:
                    cls._shared_client = httpx.AsyncClient(timeout=120)
        return cls._shared_client

    @classmethod
    async def aclose_shared(cls) -> None:
        if cls._shared_client is not None:
            await cls._shared_client.aclose()
            cls._shared_client = None

    async def complete(self, messages: list[dict], temperature: float = 0.4) -> str:
        client = await self._client()
        res = await client.post(
            f"{self.base_url}/v1/chat/completions",
            json={"model": self.model, "messages": messages, "temperature": temperature},
        )
        res.raise_for_status()
        data = res.json()
        return data["choices"][0]["message"]["content"]
