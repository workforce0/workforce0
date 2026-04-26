"""JWT verification for incoming bridge connections.

Backend mints a short-lived (1h) HS256 token containing callId, tenantId,
sessionId. Bridge verifies signature + expiration + required claims.
"""

from __future__ import annotations
import jwt


class AuthError(Exception):
    pass


REQUIRED_CLAIMS = ("callId", "tenantId", "sessionId")


def verify_token(token: str, secret: str) -> dict:
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthError(f"invalid token: {exc}") from exc

    for claim in REQUIRED_CLAIMS:
        if claim not in payload:
            raise AuthError(f"missing claim: {claim}")
    return payload
