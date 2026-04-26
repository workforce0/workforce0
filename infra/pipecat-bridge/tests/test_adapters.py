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
async def test_tts_returns_pcm_bytes():
    _install_mock_client(TTSAdapter, content=b"\x00" * 100)
    adapter = TTSAdapter("http://kokoro-tts:8880")
    audio = await adapter.synthesize("hello")
    assert audio == b"\x00" * 100


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
