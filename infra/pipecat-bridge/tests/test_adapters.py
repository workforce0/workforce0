import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from stt_adapter import STTAdapter
from llm_adapter import LLMAdapter
from tts_adapter import TTSAdapter


def _make_response(*, json_value=None, content=None):
    """Build a mock httpx.Response. .json() is sync, .raise_for_status() is sync."""
    res = MagicMock()
    if json_value is not None:
        res.json = MagicMock(return_value=json_value)
    if content is not None:
        res.content = content
    res.raise_for_status = MagicMock(return_value=None)
    res.status_code = 200
    return res


@pytest.mark.asyncio
async def test_stt_posts_multipart():
    adapter = STTAdapter("http://whisper:8000")
    with patch("stt_adapter.httpx.AsyncClient") as mock_client_class:
        mock = AsyncMock()
        mock.post = AsyncMock(return_value=_make_response(
            json_value={"text": "hello", "duration": 1.0, "language": "en", "segments": []},
        ))
        mock_client_class.return_value.__aenter__.return_value = mock
        result = await adapter.transcribe(b"\x00" * 16, "audio.wav")
        assert result["text"] == "hello"
        assert mock.post.called
        url = mock.post.call_args.args[0]
        assert "/v1/audio/transcriptions" in url


@pytest.mark.asyncio
async def test_llm_chat_completion():
    adapter = LLMAdapter("http://ollama:11434", "qwen3.5:8b")
    with patch("llm_adapter.httpx.AsyncClient") as mock_client_class:
        mock = AsyncMock()
        mock.post = AsyncMock(return_value=_make_response(
            json_value={"choices": [{"message": {"content": "hi"}}]},
        ))
        mock_client_class.return_value.__aenter__.return_value = mock
        out = await adapter.complete([{"role": "user", "content": "hi"}])
        assert out == "hi"


@pytest.mark.asyncio
async def test_tts_returns_pcm_bytes():
    adapter = TTSAdapter("http://kokoro-tts:8880")
    with patch("tts_adapter.httpx.AsyncClient") as mock_client_class:
        mock = AsyncMock()
        mock.post = AsyncMock(return_value=_make_response(content=b"\x00" * 100))
        mock_client_class.return_value.__aenter__.return_value = mock
        audio = await adapter.synthesize("hello")
        assert audio == b"\x00" * 100
