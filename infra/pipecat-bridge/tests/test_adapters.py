"""Adapter tests.

Adapters now share a class-level `httpx.AsyncClient` (lazy-init) so we
inject the mock client directly via the `_shared_client` slot. This also
exercises the connection-pooling pathway: a second call must reuse the
same client.
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock
from stt_adapter import STTAdapter
from llm_adapter import LLMAdapter
from tts_adapter import TTSAdapter


def _make_response(*, json_value=None, content=None):
    res = MagicMock()
    if json_value is not None:
        res.json = MagicMock(return_value=json_value)
    if content is not None:
        res.content = content
    res.raise_for_status = MagicMock(return_value=None)
    res.status_code = 200
    return res


def _install_mock_client(adapter_cls, *, json_value=None, content=None):
    mock = MagicMock()
    mock.post = AsyncMock(return_value=_make_response(json_value=json_value, content=content))
    mock.aclose = AsyncMock(return_value=None)
    adapter_cls._shared_client = mock
    return mock


@pytest.fixture(autouse=True)
def _reset_shared_clients():
    """Ensure no shared client leaks between tests."""
    for cls in (STTAdapter, LLMAdapter, TTSAdapter):
        cls._shared_client = None
    yield
    for cls in (STTAdapter, LLMAdapter, TTSAdapter):
        cls._shared_client = None


@pytest.mark.asyncio
async def test_stt_posts_multipart():
    mock = _install_mock_client(
        STTAdapter,
        json_value={"text": "hello", "duration": 1.0, "language": "en", "segments": []},
    )
    adapter = STTAdapter("http://whisper:8000")
    result = await adapter.transcribe(b"\x00" * 16, "audio.wav")
    assert result["text"] == "hello"
    assert mock.post.called
    url = mock.post.call_args.args[0]
    assert "/v1/audio/transcriptions" in url


@pytest.mark.asyncio
async def test_llm_chat_completion():
    _install_mock_client(
        LLMAdapter,
        json_value={"choices": [{"message": {"content": "hi"}}]},
    )
    adapter = LLMAdapter("http://ollama:11434", "qwen3.5:8b")
    out = await adapter.complete([{"role": "user", "content": "hi"}])
    assert out == "hi"


@pytest.mark.asyncio
async def test_tts_calls_kokoro_speech_endpoint_with_pcm_request():
    """Pin the request shape to upstream Kokoro-FastAPI's OpenAI-compat schema.

    A previous version called /v1/audio/synthesize with {text, voice, format} —
    a fictional endpoint that 404s on the real image. This test asserts we
    call /v1/audio/speech with {model, input, voice, response_format, stream}
    so a future regression of that mistake is caught at unit-test time.
    """
    # 24 kHz s16le silence — 1 second worth, large enough that ratecv has
    # something to resample without hitting its small-input degenerate path.
    pcm_24k_silence = b"\x00\x00" * 24000
    mock = _install_mock_client(TTSAdapter, content=pcm_24k_silence)
    adapter = TTSAdapter("http://kokoro-tts:8880", voice="af_heart")
    audio = await adapter.synthesize("hello world")

    url = mock.post.call_args.args[0]
    body = mock.post.call_args.kwargs["json"]
    assert url.endswith("/v1/audio/speech")
    assert body == {
        "model": "kokoro",
        "input": "hello world",
        "voice": "af_heart",
        "response_format": "pcm",
        "stream": False,
    }
    # 24 kHz s16le → 8 kHz μ-law: 6× compression. Allow a few-byte slop
    # from ratecv state but assert the right order of magnitude.
    assert len(audio) == pytest.approx(len(pcm_24k_silence) // 6, abs=4)


def test_pcm24k_to_twilio_mulaw_byte_ratio_and_silence_value():
    """Direct unit test for the resample/companding helper."""
    from tts_adapter import pcm24k_to_twilio_mulaw

    # 1 s of s16le silence at 24 kHz = 48000 bytes → ~8000 μ-law bytes.
    pcm_silence = b"\x00\x00" * 24000
    out = pcm24k_to_twilio_mulaw(pcm_silence)
    assert len(out) == pytest.approx(8000, abs=4)
    # μ-law silence is 0xFF (the encoded value for amplitude 0).
    # Allow a small startup transient from ratecv but everything settles to
    # 0xFF for a silent input.
    silent_count = sum(1 for b in out if b == 0xFF)
    assert silent_count >= len(out) - 4, (
        f"expected nearly all μ-law silence (0xFF), got {silent_count}/{len(out)}"
    )


@pytest.mark.asyncio
async def test_shared_client_is_reused_across_calls():
    """A second .transcribe() must reuse the same httpx client (pooling)."""
    mock = _install_mock_client(
        STTAdapter,
        json_value={"text": "x", "duration": 0.1, "language": "en", "segments": []},
    )
    adapter = STTAdapter("http://whisper:8000")
    await adapter.transcribe(b"\x00" * 16)
    await adapter.transcribe(b"\x00" * 16)
    # Two POSTs, same client instance.
    assert mock.post.call_count == 2
    assert STTAdapter._shared_client is mock


@pytest.mark.asyncio
async def test_aclose_shared_releases_client():
    mock = _install_mock_client(STTAdapter, json_value={"text": "x"})
    await STTAdapter.aclose_shared()
    assert STTAdapter._shared_client is None
    assert mock.aclose.await_count == 1
