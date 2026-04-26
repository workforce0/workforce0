import pytest
from unittest.mock import AsyncMock
from pipeline import VoicePipeline


@pytest.mark.asyncio
async def test_pipeline_processes_one_frame():
    """With STT/LLM/TTS adapters mocked, a sample frame in produces output + transcript chunk."""
    pipeline = VoicePipeline(
        stt=AsyncMock(transcribe=AsyncMock(return_value={
            "text": "hello",
            "language": "en",
            "duration": 1.0,
            "segments": [{"start": 0, "end": 1, "text": "hello"}],
        })),
        llm=AsyncMock(complete=AsyncMock(return_value="hi there")),
        tts=AsyncMock(synthesize=AsyncMock(return_value=b"\x00" * 100)),
        system_prompt="you are an intake agent",
    )
    transcripts = []
    audio_out = []

    async def on_transcript(t):
        transcripts.append(t)

    async def on_audio(b):
        audio_out.append(b)

    await pipeline.handle_audio_chunk(b"\x00" * 8000, on_audio, on_transcript)
    summary = await pipeline.finalize(on_transcript)

    assert any("hello" in t.get("text", "") for t in transcripts)
    assert audio_out, "expected at least one audio response"
    assert summary["text"], "final transcript should be non-empty"
