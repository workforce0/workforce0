"""Calls the Workforce0 faster-whisper-server container via OpenAI-compatible API.

Uses a class-level shared `httpx.AsyncClient` so HTTP/1.1 connection pooling
is preserved across calls. Spinning up a fresh client per request defeats
keepalive and adds a TLS/TCP handshake on every utterance.

Lifecycle: the client is lazy-initialized on first use; the FastAPI lifespan
in server.py calls `STTAdapter.aclose_shared()` on shutdown.
"""

from __future__ import annotations
import asyncio
import httpx


class STTAdapter:
    _shared_client: httpx.AsyncClient | None = None
    _client_lock = asyncio.Lock()

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    @classmethod
    async def _client(cls) -> httpx.AsyncClient:
        if cls._shared_client is None:
            async with cls._client_lock:
                if cls._shared_client is None:
                    cls._shared_client = httpx.AsyncClient(timeout=600)
        return cls._shared_client

    @classmethod
    async def aclose_shared(cls) -> None:
        if cls._shared_client is not None:
            await cls._shared_client.aclose()
            cls._shared_client = None

    async def transcribe(self, audio: bytes, filename: str = "audio.wav") -> dict:
        client = await self._client()
        files = {"file": (filename, audio, "audio/wav")}
        data = {"model": "whisper-1", "response_format": "verbose_json"}
        res = await client.post(
            f"{self.base_url}/v1/audio/transcriptions", files=files, data=data
        )
        res.raise_for_status()
        return res.json()
