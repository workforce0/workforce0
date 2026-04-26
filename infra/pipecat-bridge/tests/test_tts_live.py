"""Live contract test against a real Kokoro-FastAPI instance.

Skipped unless KOKORO_BASE_URL is set in the environment. When the local-voice
compose profile is up, run with:

    KOKORO_BASE_URL=http://localhost:8880 pytest tests/test_tts_live.py -v

This exists because the mocked test in test_adapters.py only validates the
request *shape* — it cannot catch an endpoint or schema drift on the upstream
Kokoro side. PR #41 originally called a fictional /v1/audio/synthesize because
no live test pinned the contract.
"""
from __future__ import annotations

import os
import pytest

from tts_adapter import TTSAdapter


pytestmark = pytest.mark.skipif(
    not os.environ.get("KOKORO_BASE_URL"),
    reason="KOKORO_BASE_URL not set; skipping live Kokoro test",
)


@pytest.mark.asyncio
async def test_synthesize_returns_twilio_ready_mulaw():
    base_url = os.environ["KOKORO_BASE_URL"]
    TTSAdapter._shared_client = None  # ensure fresh client for live run
    adapter = TTSAdapter(base_url, voice="af_heart")
    try:
        audio = await adapter.synthesize("This is a workforce zero diagnostic.")
    finally:
        await TTSAdapter.aclose_shared()

    # μ-law @ 8 kHz mono = 8 KB/s. A short sentence must be at least ~2 s
    # of speech; below 8 KB something silently truncated upstream.
    assert isinstance(audio, bytes)
    assert len(audio) >= 8000, f"suspiciously short μ-law payload: {len(audio)} bytes"
    # Common header magic bytes that would indicate response_format silently
    # flipped to wav/mp3 — fail loudly so the regression is caught.
    assert audio[:4] != b"RIFF", "got WAV header — response_format=pcm not honored"
    assert audio[:3] != b"ID3", "got MP3 — response_format=pcm not honored"
    # μ-law is byte-encoded, so any signed-16-bit PCM tell would mean we
    # forgot the lin2ulaw step. Detection isn't perfect (random PCM bytes
    # can look like μ-law) but a stuck "all 0x00" PCM-silence pattern
    # would never appear from a μ-law-encoded utterance — μ-law silence is
    # 0xFF, so a long run of 0x00 == raw PCM leaked through.
    null_run = max(
        (sum(1 for _ in g) for v, g in __import__("itertools").groupby(audio) if v == 0),
        default=0,
    )
    assert null_run < 16, "long 0x00 run — looks like raw PCM, not μ-law"
