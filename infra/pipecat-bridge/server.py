"""FastAPI WebSocket server that wraps the voice pipeline with JWT auth.

WebSocket protocol (source-of-truth for the TS backend):

  Open:    GET ws://.../sessions/{call_id}?token=<jwt>
           JWT must (a) verify against BRIDGE_JWT_SECRET, (b) include
           `callId` claim equal to the URL `{call_id}`. Otherwise the
           server closes 1008 (policy violation).

  Init:    Client sends one TEXT frame:
             {"type":"init","systemPrompt":"..."}     (systemPrompt optional)
           Anything else → close 1003 (unsupported data).

  Inbound: BINARY frames carrying caller PCM audio.

  Control: TEXT frames; currently only {"type":"stop"} → graceful close.

  Outbound:
    BINARY frames — TTS audio response.
    TEXT frames   — JSON, one of:
       {type:"turn", speaker, text, startMs, endMs}
       {type:"transcript_complete", turns:[...], durationMs, text, language}
"""

from __future__ import annotations
import os
import json
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Request
from fastapi.responses import JSONResponse
from auth import verify_token, AuthError
from pipeline import VoicePipeline
from stt_adapter import STTAdapter
from llm_adapter import LLMAdapter
from tts_adapter import TTSAdapter


logger = logging.getLogger("pipecat-bridge")

DEFAULT_SYSTEM_PROMPT = (
    "You are a Workforce0 voice intake agent. Greet the caller, ask why "
    "they're calling, and capture key facts."
)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Open shared httpx clients on startup; close them on shutdown so
    connection pools don't leak across reloads."""
    yield
    # Close any module-level clients held by adapters.
    for adapter_mod in (STTAdapter, TTSAdapter, LLMAdapter):
        close = getattr(adapter_mod, "aclose_shared", None)
        if callable(close):
            try:
                await close()
            except Exception as exc:
                logger.warning("adapter shutdown failed: %s", exc)


app = FastAPI(lifespan=_lifespan)


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.post("/sessions/synthetic")
async def synthetic(request: Request, token: str = Query(...)) -> JSONResponse:
    """Debug-only endpoint used by `bin/diagnose-voice.sh`.

    Accepts a raw audio payload, runs it through the full STT→LLM→TTS pipeline,
    and returns the resulting transcript summary. Gated by `DEBUG=1` so the
    endpoint is hidden in production. Auth identical to the WS endpoint.
    """
    if os.environ.get("DEBUG") != "1":
        return JSONResponse({"error": "debug disabled"}, status_code=404)
    secret = os.environ["BRIDGE_JWT_SECRET"]
    try:
        verify_token(token, secret)
    except AuthError:
        return JSONResponse({"error": "auth"}, status_code=401)

    audio = await request.body()
    pipeline = VoicePipeline(
        stt=STTAdapter(os.environ["WHISPER_BASE_URL"]),
        llm=LLMAdapter(os.environ["OLLAMA_BASE_URL"]),
        tts=TTSAdapter(os.environ["KOKORO_BASE_URL"]),
        system_prompt="You are a synthetic-session intake agent.",
    )
    audio_out: list[bytes] = []
    transcripts: list[dict] = []

    async def on_audio(b: bytes) -> None:
        audio_out.append(b)

    async def on_transcript(t: dict) -> None:
        transcripts.append(t)

    # The synthetic path bypasses the energy-VAD by feeding one large blob
    # straight into _flush_utterance — the diagnose script provides a single
    # complete utterance, not a stream.
    pipeline._utt_buf.extend(audio)
    pipeline._utt_started_ms = 0
    pipeline._has_voiced = True
    await pipeline._flush_utterance(on_audio, on_transcript)
    summary = await pipeline.finalize(on_transcript, on_audio)
    return JSONResponse(
        {"transcript": summary, "audioBytes": sum(len(b) for b in audio_out)}
    )


@app.websocket("/sessions/{call_id}")
async def session(websocket: WebSocket, call_id: str, token: str = Query(...)) -> None:
    secret = os.environ["BRIDGE_JWT_SECRET"]
    try:
        claims = verify_token(token, secret)
    except AuthError:
        await websocket.close(code=1008, reason="auth")
        return

    # Bind the JWT's callId claim to the URL path. Without this check, a token
    # minted for call A could be replayed against call B's WebSocket — a
    # session-hijack class bug.
    if claims.get("callId") != call_id:
        await websocket.close(code=1008, reason="callId mismatch")
        return

    await websocket.accept()

    # Init frame — must be valid JSON with type=="init". Anything else closes
    # the socket with 1003 (unsupported data).
    try:
        init_msg = await websocket.receive_text()
        init = json.loads(init_msg)
    except WebSocketDisconnect:
        return
    except (json.JSONDecodeError, ValueError):
        await websocket.close(code=1003, reason="bad init json")
        return

    if not isinstance(init, dict) or init.get("type") != "init":
        await websocket.close(code=1003, reason="bad init")
        return

    system_prompt = init.get("systemPrompt") or DEFAULT_SYSTEM_PROMPT

    pipeline = VoicePipeline(
        stt=STTAdapter(os.environ["WHISPER_BASE_URL"]),
        llm=LLMAdapter(os.environ["OLLAMA_BASE_URL"]),
        tts=TTSAdapter(os.environ["KOKORO_BASE_URL"]),
        system_prompt=system_prompt,
    )

    async def on_audio(b: bytes) -> None:
        await websocket.send_bytes(b)

    async def on_transcript(t: dict) -> None:
        await websocket.send_text(json.dumps(t))

    try:
        while True:
            msg = await websocket.receive()
            mtype = msg.get("type")
            if mtype == "websocket.disconnect":
                break
            if "bytes" in msg and msg["bytes"] is not None:
                await pipeline.handle_audio_chunk(msg["bytes"], on_audio, on_transcript)
            elif "text" in msg and msg["text"] is not None:
                try:
                    control = json.loads(msg["text"])
                except (json.JSONDecodeError, ValueError):
                    # Malformed control frame — log and ignore rather than
                    # tearing down the call.
                    logger.warning("malformed control frame; ignoring")
                    continue
                if isinstance(control, dict) and control.get("type") == "stop":
                    break
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await pipeline.finalize(on_transcript, on_audio)
        except Exception as exc:
            # Final transcript send may itself fail if the socket is already
            # closed; that's expected and not worth a stack trace.
            logger.debug("finalize after disconnect: %s", exc)
