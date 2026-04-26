"""FastAPI WebSocket server that wraps the voice pipeline with JWT auth."""

from __future__ import annotations
import os
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Request
from fastapi.responses import JSONResponse
from auth import verify_token, AuthError
from pipeline import VoicePipeline
from stt_adapter import STTAdapter
from llm_adapter import LLMAdapter
from tts_adapter import TTSAdapter


app = FastAPI()


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

    await pipeline.handle_audio_chunk(audio, on_audio, on_transcript)
    summary = await pipeline.finalize(on_transcript)
    return JSONResponse(
        {"transcript": summary, "audioBytes": sum(len(b) for b in audio_out)}
    )


@app.websocket("/sessions/{call_id}")
async def session(websocket: WebSocket, call_id: str, token: str = Query(...)) -> None:
    secret = os.environ["BRIDGE_JWT_SECRET"]
    try:
        verify_token(token, secret)
    except AuthError:
        await websocket.close(code=1008, reason="auth")
        return

    await websocket.accept()
    init_msg = await websocket.receive_text()
    init = json.loads(init_msg)
    if init.get("type") != "init":
        await websocket.close(code=1008, reason="bad init")
        return

    pipeline = VoicePipeline(
        stt=STTAdapter(os.environ["WHISPER_BASE_URL"]),
        llm=LLMAdapter(os.environ["OLLAMA_BASE_URL"]),
        tts=TTSAdapter(os.environ["KOKORO_BASE_URL"]),
        system_prompt=init["systemPrompt"],
    )

    async def on_audio(b: bytes) -> None:
        await websocket.send_bytes(b)

    async def on_transcript(t: dict) -> None:
        await websocket.send_text(json.dumps(t))

    try:
        while True:
            msg = await websocket.receive()
            if "bytes" in msg:
                await pipeline.handle_audio_chunk(msg["bytes"], on_audio, on_transcript)
            elif "text" in msg:
                control = json.loads(msg["text"])
                if control.get("type") == "stop":
                    break
    except WebSocketDisconnect:
        pass
    finally:
        await pipeline.finalize(on_transcript)
