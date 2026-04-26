"""Calls the Workforce0 faster-whisper-server container via OpenAI-compatible API."""

from __future__ import annotations
import httpx


class STTAdapter:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    async def transcribe(self, audio: bytes, filename: str = "audio.wav") -> dict:
        async with httpx.AsyncClient(timeout=600) as client:
            files = {"file": (filename, audio, "audio/wav")}
            data = {"model": "whisper-1", "response_format": "verbose_json"}
            res = await client.post(f"{self.base_url}/v1/audio/transcriptions", files=files, data=data)
            res.raise_for_status()
            return res.json()
