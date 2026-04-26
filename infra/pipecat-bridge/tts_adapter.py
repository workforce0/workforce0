"""Calls Kokoro TTS container's HTTP synthesize endpoint, returns raw PCM bytes."""

from __future__ import annotations
import httpx


class TTSAdapter:
    def __init__(self, base_url: str, voice: str = "af") -> None:
        self.base_url = base_url.rstrip("/")
        self.voice = voice

    async def synthesize(self, text: str) -> bytes:
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.post(
                f"{self.base_url}/v1/audio/synthesize",
                json={"text": text, "voice": self.voice, "format": "pcm_16000"},
            )
            res.raise_for_status()
            return res.content
