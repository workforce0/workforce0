"""Calls Kokoro-FastAPI's OpenAI-compatible /v1/audio/speech, returns Twilio-
ready μ-law bytes (8 kHz mono).

Why we transcode here, not in the TS provider
─────────────────────────────────────────────
Kokoro hands back raw PCM at 24 kHz s16le mono. Twilio Media Streams expects
μ-law 8 kHz mono base64-encoded inside `media.payload`. The TS-side bridge
provider (`backend/.../pipecat.provider.ts`) already assumes "the bridge
produces mu-law bytes" and just base64-encodes them — see the comment near
the `event:'media'` send. Doing the resample + companding here keeps that
contract honest. A previous version of this adapter returned raw PCM and
silently broke any real Twilio call.

Pipeline:
  POST /v1/audio/speech response_format=pcm  →  16-bit LE mono @ 24 kHz
  audioop.ratecv()                          →  16-bit LE mono @ 8 kHz
  audioop.lin2ulaw()                        →  μ-law mono @ 8 kHz (1 byte/sample)

Byte budget: 1 second of speech is 48,000 bytes from Kokoro and ends as 8,000
bytes on the wire — a 6× reduction. If the live test sees a smaller ratio
something is mis-encoded.

Note on Python 3.13: `audioop` is removed in 3.13. The bridge pyproject pins
`>=3.12,<3.13`, so this is safe today; if we widen that, swap to a numpy or
pyaudioop_compat fallback.

Shares a class-level httpx.AsyncClient to keep keepalive across calls.
See stt_adapter.py for lifecycle notes.
"""

from __future__ import annotations
import asyncio
import audioop
import httpx


# Kokoro-FastAPI emits PCM at this rate; Twilio expects this rate.
_KOKORO_SAMPLE_RATE = 24000
_TWILIO_SAMPLE_RATE = 8000
_SAMPLE_WIDTH = 2  # 16-bit


def pcm24k_to_twilio_mulaw(pcm_24k_s16le: bytes) -> bytes:
    """Resample 24 kHz s16le PCM mono → μ-law 8 kHz mono.

    Exposed (and named) so the pipeline can call it directly when needed,
    and so unit tests can exercise the transform without HTTP.
    """
    pcm_8k, _state = audioop.ratecv(
        pcm_24k_s16le, _SAMPLE_WIDTH, 1, _KOKORO_SAMPLE_RATE, _TWILIO_SAMPLE_RATE, None
    )
    return audioop.lin2ulaw(pcm_8k, _SAMPLE_WIDTH)


class TTSAdapter:
    _shared_client: httpx.AsyncClient | None = None
    _client_lock = asyncio.Lock()

    def __init__(self, base_url: str, voice: str = "af_heart") -> None:
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
            f"{self.base_url}/v1/audio/speech",
            json={
                "model": "kokoro",
                "input": text,
                "voice": self.voice,
                "response_format": "pcm",
                "stream": False,
            },
        )
        res.raise_for_status()
        return pcm24k_to_twilio_mulaw(res.content)
