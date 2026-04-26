"""Tests for the /sessions/synthetic debug endpoint.

The endpoint is gated by `DEBUG=1`. We exercise:
  1. DEBUG unset → 404 (hidden)
  2. DEBUG=1 + valid token + a tiny audio payload → 200 with transcript

The pipeline's STT/LLM/TTS adapters are patched so the test doesn't need
the whisper/ollama/kokoro containers running.
"""
from __future__ import annotations

import os
import time
import importlib

import jwt
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

SECRET = "test-secret-12345678901234567890123456789012"


def _make_token(secret: str = SECRET) -> str:
    payload = {
        "callId": "diag",
        "tenantId": "default",
        "sessionId": "diag",
        "exp": int(time.time()) + 300,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def _client(env: dict[str, str]) -> TestClient:
    """Build a TestClient against a freshly-imported server module so the
    @app.post handler observes the right `os.environ` values at request time
    (the module reads env *inside* the handler, so a single import is fine —
    we just want a clean app instance)."""
    import server

    importlib.reload(server)
    return TestClient(server.app)


def test_synthetic_returns_404_when_debug_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEBUG", raising=False)
    monkeypatch.setenv("BRIDGE_JWT_SECRET", SECRET)
    client = _client({})
    res = client.post(
        "/sessions/synthetic",
        params={"token": _make_token()},
        content=b"\x00" * 100,
        headers={"Content-Type": "audio/wav"},
    )
    assert res.status_code == 404
    assert res.json() == {"error": "debug disabled"}


def test_synthetic_processes_audio_when_debug_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEBUG", "1")
    monkeypatch.setenv("BRIDGE_JWT_SECRET", SECRET)
    monkeypatch.setenv("WHISPER_BASE_URL", "http://whisper.invalid")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://ollama.invalid")
    monkeypatch.setenv("KOKORO_BASE_URL", "http://kokoro.invalid")

    client = _client({})

    fake_stt = AsyncMock(transcribe=AsyncMock(return_value={
        "text": "hello this is a test",
        "language": "en",
        "duration": 1.0,
        "segments": [],
    }))
    fake_llm = AsyncMock(complete=AsyncMock(return_value="thanks for the test"))
    fake_tts = AsyncMock(synthesize=AsyncMock(return_value=b"\x00" * 256))

    with patch("server.STTAdapter", return_value=fake_stt), \
         patch("server.LLMAdapter", return_value=fake_llm), \
         patch("server.TTSAdapter", return_value=fake_tts):
        res = client.post(
            "/sessions/synthetic",
            params={"token": _make_token()},
            content=b"\x00" * 8000,
            headers={"Content-Type": "audio/wav"},
        )

    assert res.status_code == 200, res.text
    body = res.json()
    assert "transcript" in body
    assert body["audioBytes"] == 256
    assert "hello this is a test" in body["transcript"]["text"]


def test_synthetic_rejects_invalid_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEBUG", "1")
    monkeypatch.setenv("BRIDGE_JWT_SECRET", SECRET)
    client = _client({})
    res = client.post(
        "/sessions/synthetic",
        params={"token": "not-a-real-token"},
        content=b"",
        headers={"Content-Type": "audio/wav"},
    )
    assert res.status_code == 401
