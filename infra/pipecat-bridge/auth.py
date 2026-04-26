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
        # Enforce exp presence + verification, plus our custom required
        # claims, at decode time. PyJWT will raise MissingRequiredClaimError
        # if any of these are absent.
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            options={
                "require": ["exp", *REQUIRED_CLAIMS],
                "verify_exp": True,
                "verify_signature": True,
            },
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("token expired") from exc
    except jwt.MissingRequiredClaimError as exc:
        raise AuthError(f"missing claim: {exc.claim}") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthError(f"invalid token: {exc}") from exc

    return payload
