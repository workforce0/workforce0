import os
import time
import jwt
import pytest
from auth import verify_token, AuthError

SECRET = "test-secret-12345678901234567890123456789012"


def make_token(payload: dict, exp_offset: int = 3600, secret: str = SECRET) -> str:
    payload = {**payload, "exp": int(time.time()) + exp_offset}
    return jwt.encode(payload, secret, algorithm="HS256")


def test_valid_token_returns_payload():
    token = make_token({"callId": "CA1", "tenantId": "t1", "sessionId": "s1"})
    payload = verify_token(token, SECRET)
    assert payload["callId"] == "CA1"
    assert payload["tenantId"] == "t1"


def test_expired_token_raises():
    token = make_token({"callId": "CA1"}, exp_offset=-10)
    with pytest.raises(AuthError):
        verify_token(token, SECRET)


def test_wrong_secret_raises():
    token = make_token({"callId": "CA1"}, secret="other-secret-1234567890123456789012345")
    with pytest.raises(AuthError):
        verify_token(token, SECRET)


def test_missing_callId_raises():
    token = make_token({"tenantId": "t1"})
    with pytest.raises(AuthError):
        verify_token(token, SECRET)
