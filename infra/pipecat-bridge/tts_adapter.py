"""Calls Kokoro TTS container's HTTP synthesize endpoint, returns raw PCM bytes.

Shares a class-level `httpx.AsyncClient` to keep keepalive across calls.
See stt_adapter.py for lifecycle notes.
"""

from __future__ import annotations
import asyncio
import httpx


class TTSAdapter:
    _shared_client: httpx.AsyncClient | None = None
    _client_lock = asyncio.Lock()

    def __init__(self, base_url: str, voice: str = "af") -> None:
        self.base_url = base_url.rstrip("/")
        self.voice = voice

    @classmethod
    async def _client(cls) -> httpx.AsyncClient:
        if cls._shared_client is None:
            async with cls._client_lock:
                if cls._shared_client is None:
                    cls._shared_client = httpx.AsyncClient(timeout=60)
        return cls._shared_client

    @classmethod
    async def aclose_shared(cls) -> None:
        if cls._shared_client is not None:
            await cls._shared_client.aclose()
            cls._shared_client = None

    async def synthesize(self, text: str) -> bytes:
        client = await self._client()
        res = await client.post(
            f"{self.base_url}/v1/audio/synthesize",
            json={"text": text, "voice": self.voice, "format": "pcm_16000"},
        )
        res.raise_for_status()
        return res.content
