"""Voice pipeline: incoming audio → STT → LLM → TTS → outgoing audio.

Minimal version. Pipecat-ai supplies more sophisticated VAD/turn-taking;
this is the framework-agnostic loop with a swap-in point for Pipecat's
real pipeline once we wire it.
"""

from __future__ import annotations
import time
from typing import Any, Awaitable, Callable


class VoicePipeline:
    def __init__(self, stt: Any, llm: Any, tts: Any, system_prompt: str) -> None:
        self.stt = stt
        self.llm = llm
        self.tts = tts
        self.history: list[dict] = [{"role": "system", "content": system_prompt}]
        self._turns: list[dict] = []
        self._t0 = time.time()

    async def handle_audio_chunk(
        self,
        audio: bytes,
        on_audio: Callable[[bytes], Awaitable[None]],
        on_transcript: Callable[[dict], Awaitable[None]],
    ) -> None:
        """Process one chunk: transcribe, complete, synthesize."""
        stt_result = await self.stt.transcribe(audio)
        user_text = (stt_result.get("text") or "").strip()
        if not user_text:
            return

        turn_user = {
            "speaker": "caller",
            "text": user_text,
            "startMs": int((time.time() - self._t0) * 1000),
        }
        self._turns.append(turn_user)
        await on_transcript({"type": "turn", **turn_user})

        self.history.append({"role": "user", "content": user_text})
        agent_text = await self.llm.complete(self.history)
        turn_agent = {
            "speaker": "agent",
            "text": agent_text,
            "startMs": int((time.time() - self._t0) * 1000),
        }
        self._turns.append(turn_agent)
        await on_transcript({"type": "turn", **turn_agent})
        self.history.append({"role": "assistant", "content": agent_text})

        audio_bytes = await self.tts.synthesize(agent_text)
        await on_audio(audio_bytes)

    async def finalize(self, on_transcript: Callable[[dict], Awaitable[None]]) -> dict:
        text = "\n".join(f"[{t['speaker']}] {t['text']}" for t in self._turns)
        summary = {
            "type": "transcript_complete",
            "text": text,
            "turns": self._turns,
            "durationSec": int(time.time() - self._t0),
            "language": "en",
        }
        await on_transcript(summary)
        return summary
