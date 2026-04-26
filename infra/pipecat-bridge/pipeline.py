"""Voice pipeline: incoming audio → STT → LLM → TTS → outgoing audio.

Behaviour:
  * Inbound audio frames (Twilio Media Streams emits ~50 frames/sec at 20ms
    per frame, mu-law / linear16) are buffered into a single utterance.
  * A simple energy-threshold VAD watches each incoming frame: when the
    rolling RMS drops below a threshold for ~700ms after at least some
    voiced audio, the utterance is finalized and run through STT → LLM → TTS.
  * `finalize()` flushes any pending utterance and emits the
    `transcript_complete` summary expected by the backend.

Why not Pipecat's built-in pipeline yet: the framework wires VAD/turn-taking
out of the box, but adopting it is larger surgery; we keep the
framework-agnostic loop with a swap-in point. Energy-VAD also has zero deps.

Timing notes:
  * `time.monotonic()` everywhere — NTP slew on `time.time()` can produce
    negative durations and corrupt `startMs/endMs/durationMs`.
  * Every transcript turn now carries both `startMs` and `endMs`. The
    backend's `TranscriptDoc` type requires `endMs: number` per turn.

Wire protocol contract (do NOT break — backend depends on these shapes):
  * Per-turn frame:        {type: "turn", speaker, text, startMs, endMs}
  * Final summary frame:   {type: "transcript_complete", text, turns,
                            durationMs, language}
  * Audio:                 binary websocket frames carrying TTS PCM.
"""

from __future__ import annotations
import time
from typing import Any, Awaitable, Callable


# ---- VAD tuning -------------------------------------------------------------
# Twilio Media Streams default frame: 20ms of audio. We assume linear PCM16
# little-endian for energy computation; if the upstream sends mu-law it should
# be decoded before reaching this pipeline (the synthetic endpoint passes
# linear16 from the diagnose script).
_SILENCE_TRIGGER_MS = 700           # consecutive silence required to finalize
_MIN_UTTERANCE_BYTES = 3200         # ~100ms @ 16kHz/16bit; below = ignore
_ENERGY_THRESHOLD = 500             # int16 RMS — empirical, not load-bearing


def _rms_int16(buf: bytes) -> float:
    """Compute the RMS of a little-endian int16 PCM buffer.

    Avoids `numpy` (extra dep). Iterates pairs of bytes; for empty/odd-length
    buffers returns 0.
    """
    n = len(buf) // 2
    if n == 0:
        return 0.0
    total = 0
    # struct.iter_unpack is fast enough for our 20ms frames
    import struct
    for (sample,) in struct.iter_unpack("<h", buf[: n * 2]):
        total += sample * sample
    return (total / n) ** 0.5


class VoicePipeline:
    def __init__(self, stt: Any, llm: Any, tts: Any, system_prompt: str) -> None:
        self.stt = stt
        self.llm = llm
        self.tts = tts
        self.history: list[dict] = [{"role": "system", "content": system_prompt}]
        self._turns: list[dict] = []
        self._t0 = time.monotonic()

        # Utterance buffering / VAD state
        self._utt_buf = bytearray()
        self._silence_ms = 0
        self._utt_started_ms: int | None = None  # startMs of the utterance
        self._has_voiced = False                 # at least one frame above threshold

    # ------------------------------------------------------------------ utils
    def _elapsed_ms(self) -> int:
        return int((time.monotonic() - self._t0) * 1000)

    def _frame_duration_ms(self, frame: bytes) -> int:
        """Estimate ms of audio in `frame` assuming 16kHz mono int16."""
        # 16000 samples/sec * 2 bytes/sample = 32000 B/sec → 32 B/ms
        return max(1, len(frame) // 32)

    # ---------------------------------------------------------- main entrypoints
    async def handle_audio_chunk(
        self,
        audio: bytes,
        on_audio: Callable[[bytes], Awaitable[None]],
        on_transcript: Callable[[dict], Awaitable[None]],
    ) -> None:
        """Buffer one inbound audio frame; finalize on silence trigger.

        Twilio sends ~50 frames/sec; running a full STT→LLM→TTS turn per frame
        was the prior bug. We accumulate until a `_SILENCE_TRIGGER_MS` window
        of below-threshold audio elapses, then flush as one utterance.
        """
        if not audio:
            return

        if self._utt_started_ms is None:
            self._utt_started_ms = self._elapsed_ms()

        self._utt_buf.extend(audio)

        rms = _rms_int16(audio)
        frame_ms = self._frame_duration_ms(audio)
        if rms >= _ENERGY_THRESHOLD:
            self._has_voiced = True
            self._silence_ms = 0
            return

        # Below threshold — accumulate silence
        self._silence_ms += frame_ms
        if (
            self._has_voiced
            and self._silence_ms >= _SILENCE_TRIGGER_MS
            and len(self._utt_buf) >= _MIN_UTTERANCE_BYTES
        ):
            await self._flush_utterance(on_audio, on_transcript)

    async def _flush_utterance(
        self,
        on_audio: Callable[[bytes], Awaitable[None]],
        on_transcript: Callable[[dict], Awaitable[None]],
    ) -> None:
        """Run STT → LLM → TTS on the buffered utterance, emit transcript turns."""
        audio = bytes(self._utt_buf)
        start_ms = self._utt_started_ms or 0
        # Reset before any awaits so a re-entrant call doesn't double-flush.
        self._utt_buf.clear()
        self._silence_ms = 0
        self._utt_started_ms = None
        self._has_voiced = False

        if not audio:
            return

        stt_result = await self.stt.transcribe(audio)
        user_text = (stt_result.get("text") or "").strip()
        if not user_text:
            return

        end_ms = self._elapsed_ms()
        turn_user = {
            "speaker": "caller",
            "text": user_text,
            "startMs": start_ms,
            "endMs": end_ms,
        }
        self._turns.append(turn_user)
        await on_transcript({"type": "turn", **turn_user})

        self.history.append({"role": "user", "content": user_text})
        agent_start_ms = self._elapsed_ms()
        agent_text = await self.llm.complete(self.history)
        agent_end_ms = self._elapsed_ms()

        turn_agent = {
            "speaker": "agent",
            "text": agent_text,
            "startMs": agent_start_ms,
            "endMs": agent_end_ms,
        }
        self._turns.append(turn_agent)
        await on_transcript({"type": "turn", **turn_agent})
        self.history.append({"role": "assistant", "content": agent_text})

        audio_bytes = await self.tts.synthesize(agent_text)
        await on_audio(audio_bytes)

    async def finalize(
        self,
        on_transcript: Callable[[dict], Awaitable[None]],
        on_audio: Callable[[bytes], Awaitable[None]] | None = None,
    ) -> dict:
        """Flush any pending utterance and emit the closing summary frame.

        `on_audio` is optional — the synthetic-test path doesn't supply one
        because the test only inspects transcript output.
        """
        if self._utt_buf and self._has_voiced and len(self._utt_buf) >= _MIN_UTTERANCE_BYTES:
            async def _drop_audio(_b: bytes) -> None:
                pass

            await self._flush_utterance(on_audio or _drop_audio, on_transcript)

        duration_ms = self._elapsed_ms()
        text = "\n".join(f"[{t['speaker']}] {t['text']}" for t in self._turns)
        summary = {
            "type": "transcript_complete",
            "text": text,
            "turns": self._turns,
            "durationMs": duration_ms,
            # Kept for backwards compat with earlier callers; backend reads
            # durationMs.
            "durationSec": duration_ms // 1000,
            "language": "en",
        }
        await on_transcript(summary)
        return summary
