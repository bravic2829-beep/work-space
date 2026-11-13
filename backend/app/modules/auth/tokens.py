import uuid
from dataclasses import dataclass
from datetime import datetime

import jwt

from app.core.config import Settings


@dataclass(frozen=True)
class TokenClaims:
    user_id: uuid.UUID
    session_id: uuid.UUID  # the "jti" claim


def encode_token(
    settings: Settings,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    issued_at: datetime,
    expires_at: datetime,
) -> str:
    payload = {
        "sub": str(user_id),
        "jti": str(session_id),
        "iat": issued_at,
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.require_jwt_secret(), algorithm=settings.jwt_algorithm)


def decode_token(settings: Settings, token: str) -> TokenClaims | None:
    """The claims of a valid token, or None for any problem (bad signature, expired, malformed).

    Only the configured algorithm is accepted, so a token with `alg: none` or another
    algorithm is rejected.
    """
    try:
        payload = jwt.decode(
            token,
            settings.require_jwt_secret(),
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "iat", "sub", "jti"]},
        )
        return TokenClaims(
            user_id=uuid.UUID(str(payload["sub"])),
            session_id=uuid.UUID(str(payload["jti"])),
        )
    except (jwt.InvalidTokenError, ValueError):
        return None
