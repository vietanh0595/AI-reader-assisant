from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import jwt
from jwt import PyJWKClient, PyJWTError

from ..config import OidcSettings


@dataclass(frozen=True)
class AuthClaims:
    issuer: str
    subject: str
    email: Optional[str] = None
    display_name: Optional[str] = None


class InvalidAuthTokenError(Exception):
    """Raised when an OIDC access token cannot be authenticated."""


class JwtValidator:
    def __init__(self, settings: OidcSettings):
        self._settings = settings
        self._jwks_client = PyJWKClient(settings.jwks_url, cache_keys=True)

    def validate(self, token: str) -> AuthClaims:
        try:
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience=self._settings.audience,
                issuer=self._settings.issuer_url,
                options={"require": ["exp", "iat", "iss", "sub"]},
            )
        except PyJWTError as exc:
            raise InvalidAuthTokenError("Token validation failed.") from exc

        email = payload.get("email")
        display_name = payload.get("name")
        return AuthClaims(
            issuer=payload["iss"],
            subject=payload["sub"],
            email=email if isinstance(email, str) else None,
            display_name=display_name if isinstance(display_name, str) else None,
        )
