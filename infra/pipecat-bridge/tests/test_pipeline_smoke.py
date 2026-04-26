"""Pipeline-level tests.

Two paths exercised:

  * `test_pipeline_finalize_flushes_pending_utterance` — feed a buffered
    utterance (above the energy threshold) and a trailing block of silence
    so the VAD finalizes the utterance mid-stream.

  * `test_pipeline_finalize_emits_summary` — verify finalize() emits the
    `transcript_complete` summary frame with `durationMs` and a
    well-formed turn list (each turn has both `startMs` and `endMs`).
"""
from __future__ import annotations

import struct
import pytest
from unittest.mock import AsyncMock
from pipeline import VoicePipeline


def _voiced_pcm(ms: int = 200, amp: int = 8000, sample_rate: int = 16000) -> bytes:
    """Generate `ms` of int16-LE PCM at constant amplitude — high RMS, easy
    for the energy VAD to detect as voiced."""
    n = int(sample_rate * ms / 1000)
    return b"".join(struct.pack("<h", amp if i % 2 == 0 else -amp) for i in range(n))


def _silence_pcm(ms: int = 800, sample_rate: int = 16000) -> bytes:
    n = int(sample_rate * ms / 1000)
    return b"\x00\x00" * n


def _make_pipeline() -> VoicePipeline:
    return VoicePipeline(
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


@pytest.mark.asyncio
async def test_silence_finalizes_utterance():
    """Voiced audio followed by >=700ms silence should trigger one full
    STT→LLM→TTS turn — not one per inbound frame."""
    pipeline = _make_pipeline()
    transcripts: list[dict] = []
    audio_out: list[bytes] = []

    async def on_transcript(t):
        transcripts.append(t)

    async def on_audio(b):
        audio_out.append(b)

    # 200ms of voiced audio fed as one frame, then four 200ms silence frames
    # (= 800ms silence, above the 700ms trigger).
    await pipeline.handle_audio_chunk(_voiced_pcm(200), on_audio, on_transcript)
    for _ in range(4):
        await pipeline.handle_audio_chunk(_silence_pcm(200), on_audio, on_transcript)

    # STT should have been called exactly once even though we sent 5 frames.
    assert pipeline.stt.transcribe.await_count == 1
    assert pipeline.llm.complete.await_count == 1
    assert pipeline.tts.synthesize.await_count == 1
    assert audio_out, "expected one TTS audio response after the turn"

    # Both turns should have startMs and endMs set.
    turn_msgs = [t for t in transcripts if t.get("type") == "turn"]
    assert len(turn_msgs) == 2
    for t in turn_msgs:
        assert "startMs" in t and "endMs" in t
        assert t["endMs"] >= t["startMs"]


@pytest.mark.asyncio
async def test_finalize_emits_summary_with_durationms():
    pipeline = _make_pipeline()
    transcripts: list[dict] = []

    async def on_transcript(t):
        transcripts.append(t)

    async def on_audio(b):
        pass

    # No audio fed — finalize should still emit a summary frame.
    summary = await pipeline.finalize(on_transcript, on_audio)
    assert summary["type"] == "transcript_complete"
    assert "durationMs" in summary
    assert isinstance(summary["durationMs"], int)
    assert summary["turns"] == []


@pytest.mark.asyncio
async def test_per_chunk_does_not_run_full_turn():
    """Regression for the original bug: feeding a single short voiced frame
    (no trailing silence) must NOT fire STT/LLM/TTS — the utterance is still
    being buffered."""
    pipeline = _make_pipeline()
    transcripts: list[dict] = []

    async def on_transcript(t):
        transcripts.append(t)

    async def on_audio(b):
        pass

    await pipeline.handle_audio_chunk(_voiced_pcm(40), on_audio, on_transcript)
    assert pipeline.stt.transcribe.await_count == 0
    assert pipeline.llm.complete.await_count == 0
    assert pipeline.tts.synthesize.await_count == 0


@pytest.mark.asyncio
async def test_pre_speech_silence_is_not_buffered():
    """Caller dials in but waits before speaking. The 5 seconds of silence
    that arrive before any voiced frame must be dropped — otherwise the
    eventual STT payload contains seconds of zeros and bloats Whisper.

    Feeds ~5 seconds of silence, then a voiced burst, and asserts the
    buffer at flush time only spans the burst (plus the trailing silence
    that triggered the flush).
    """
    pipeline = _make_pipeline()
    captured_audio_lengths: list[int] = []

    # Spy on _flush_utterance to capture buffer length at flush time.
    original_flush = pipeline._flush_utterance

    async def spy_flush(on_audio, on_transcript):
        captured_audio_lengths.append(len(pipeline._utt_buf))
        await original_flush(on_audio, on_transcript)

    pipeline._flush_utterance = spy_flush  # type: ignore[assignment]

    async def on_transcript(t):
        pass

    async def on_audio(b):
        pass

    # 5 seconds of pre-speech silence in 200ms frames → 25 frames.
    for _ in range(25):
        await pipeline.handle_audio_chunk(_silence_pcm(200), on_audio, on_transcript)

    # Buffer must still be empty — silence before any voice should be dropped.
    assert len(pipeline._utt_buf) == 0
    assert pipeline._has_voiced is False

    # Now a 200ms voiced burst, then trailing silence to trigger the flush.
    await pipeline.handle_audio_chunk(_voiced_pcm(200), on_audio, on_transcript)
    for _ in range(4):
        await pipeline.handle_audio_chunk(_silence_pcm(200), on_audio, on_transcript)

    assert captured_audio_lengths, "expected a flush after silence trigger"
    flushed = captured_audio_lengths[0]

    voiced_bytes = len(_voiced_pcm(200))
    # 4 trailing 200ms silence frames are buffered as part of the utterance
    # before the threshold fires. Allow for small rounding (silence frames
    # are 200ms each).
    silence_bytes = len(_silence_pcm(200))
    expected_max = voiced_bytes + 4 * silence_bytes

    # The flush buffer should contain at most the voiced burst + the
    # trailing silence — NOT the 5 seconds of pre-speech silence (which
    # alone would be ~160 KB).
    assert flushed <= expected_max, (
        f"flushed {flushed} bytes exceeds voiced+trailing-silence bound "
        f"{expected_max} — pre-speech silence is leaking into the buffer"
    )
    assert flushed >= voiced_bytes, "voiced burst must be in the buffer"


@pytest.mark.asyncio
async def test_voice_started_resets_after_finalize():
    """After a successful flush, _has_voiced must reset so the next
    utterance again drops its pre-speech silence rather than starting
    pre-armed from the previous turn."""
    pipeline = _make_pipeline()

    async def on_transcript(t):
        pass

    async def on_audio(b):
        pass

    # First utterance.
    await pipeline.handle_audio_chunk(_voiced_pcm(200), on_audio, on_transcript)
    for _ in range(4):
        await pipeline.handle_audio_chunk(_silence_pcm(200), on_audio, on_transcript)

    # Flush happened; flag must be back to False.
    assert pipeline._has_voiced is False
    assert len(pipeline._utt_buf) == 0

    # Second caller pause — silence after a previous utterance must
    # still be dropped (no buffering until the next voiced frame).
    for _ in range(10):
        await pipeline.handle_audio_chunk(_silence_pcm(200), on_audio, on_transcript)
    assert len(pipeline._utt_buf) == 0
