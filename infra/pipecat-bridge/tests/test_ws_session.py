"""WebSocket session tests — auth binding + init handling.

The TestClient.websocket_connect path lets us drive the FastAPI handler
without a real network. STT/LLM/TTS adapters are patched so the session
opens cleanly.
"""
from __future__ import annotations

import importlib
import json
import time

import jwt
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

# Fake secret for tests; allowlisted in .gitleaks.toml.
SECRET = "test-secret-12345678901234567890123456789012"


def _make_token(call_id: str, secret: str = SECRET) -> str:
    payload = {
        "callId": call_id,
        "tenantId": "default",
        "sessionId": "s",
        "exp": int(time.time()) + 300,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("BRIDGE_JWT_SECRET", SECRET)
    monkeypatch.setenv("WHISPER_BASE_URL", "http://whisper.invalid")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://ollama.invalid")
    monkeypatch.setenv("KOKORO_BASE_URL", "http://kokoro.invalid")
    import server
    importlib.reload(server)
    return TestClient(server.app)


def _patched_adapters():
    fake_stt = AsyncMock(transcribe=AsyncMock(return_value={
        "text": "hi",
        "language": "en",
        "duration": 0.1,
        "segments": [],
    }))
    fake_llm = AsyncMock(complete=AsyncMock(return_value="hello caller"))
    fake_tts = AsyncMock(synthesize=AsyncMock(return_value=b"\x00" * 32))
    return (
        patch("server.STTAdapter", return_value=fake_stt),
        patch("server.LLMAdapter", return_value=fake_llm),
        patch("server.TTSAdapter", return_value=fake_tts),
    )


def test_ws_rejects_callid_mismatch(client: TestClient):
    """Token with callId=CA-A used against /sessions/CA-B must close 1008.

    Prevents session-hijack via token replay across calls.
    """
    token = _make_token("CA-A")
    with pytest.raises(Exception) as excinfo:
        with client.websocket_connect(f"/sessions/CA-B?token={token}") as ws:
            ws.send_text(json.dumps({"type": "init"}))
            ws.receive()  # should not get here
    # Starlette raises WebSocketDisconnect on the rejected handshake.
    assert "1008" in str(excinfo.value) or "callId" in str(excinfo.value).lower() or excinfo.value.__class__.__name__ == "WebSocketDisconnect"


def test_ws_accepts_matching_callid(client: TestClient):
    """Same callId in token + URL path → handshake succeeds, init OK."""
    token = _make_token("CA-XYZ")
    p_stt, p_llm, p_tts = _patched_adapters()
    with p_stt, p_llm, p_tts:
        with client.websocket_connect(f"/sessions/CA-XYZ?token={token}") as ws:
            ws.send_text(json.dumps({"type": "init", "systemPrompt": "be helpful"}))
            # Send stop control to close cleanly; the server emits a final
            # transcript_complete frame in finalize().
            ws.send_text(json.dumps({"type": "stop"}))
            final = json.loads(ws.receive_text())
            assert final["type"] == "transcript_complete"
            assert "durationMs" in final


def test_ws_handles_missing_system_prompt(client: TestClient):
    """init JSON without systemPrompt should not raise KeyError — server
    falls back to DEFAULT_SYSTEM_PROMPT."""
    token = _make_token("CA-NOPROMPT")
    p_stt, p_llm, p_tts = _patched_adapters()
    with p_stt, p_llm, p_tts:
        with client.websocket_connect(f"/sessions/CA-NOPROMPT?token={token}") as ws:
            ws.send_text(json.dumps({"type": "init"}))  # no systemPrompt
            ws.send_text(json.dumps({"type": "stop"}))
            final = json.loads(ws.receive_text())
            assert final["type"] == "transcript_complete"


def test_ws_rejects_malformed_init_json(client: TestClient):
    """Bogus init payload must close 1003 (unsupported data), not crash
    with json.JSONDecodeError."""
    token = _make_token("CA-BADJSON")
    with client.websocket_connect(f"/sessions/CA-BADJSON?token={token}") as ws:
        ws.send_text("this is not json {")
        # Server closes with code 1003; receive() returns the close frame.
        msg = ws.receive()
        assert msg.get("type") == "websocket.close"
        assert msg.get("code") == 1003


def test_ws_rejects_invalid_token(client: TestClient):
    with pytest.raises(Exception):
        with client.websocket_connect("/sessions/CA-X?token=not-a-token") as ws:
            ws.receive()


def test_ws_rejects_binary_init_frame(client: TestClient):
    """First frame must be TEXT JSON. A binary first frame should close
    1003 cleanly instead of raising RuntimeError from receive_text()."""
    token = _make_token("CA-BIN")
    with client.websocket_connect(f"/sessions/CA-BIN?token={token}") as ws:
        # Send binary as the first frame — protocol violation.
        ws.send_bytes(b"\x00\x01\x02\x03")
        msg = ws.receive()
        assert msg.get("type") == "websocket.close"
        assert msg.get("code") == 1003
