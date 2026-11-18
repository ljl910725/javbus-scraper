from datetime import datetime, timezone

import bcrypt
from jose import JWTError, jwt

from app.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def _encode_token(user_id: int, username: str, *, expires_at: datetime, typ: str) -> str:
    payload = {
        "sub": str(user_id),
        "username": username,
        "exp": expires_at,
        "typ": typ,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def issue_session_tokens(user_id: int, username: str, expires_at: datetime) -> tuple[str, str]:
    # 访问令牌和刷新令牌用同一个截止时间，续期也不会超过登录时选的时长
    access = _encode_token(user_id, username, expires_at=expires_at, typ="access")
    refresh = _encode_token(user_id, username, expires_at=expires_at, typ="refresh")
    return access, refresh


def token_expires_at(payload: dict) -> datetime | None:
    exp = payload.get("exp")
    if isinstance(exp, datetime):
        return exp if exp.tzinfo else exp.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromtimestamp(int(exp), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def _decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError:
        return None


def decode_access_token(token: str) -> dict | None:
    payload = _decode_token(token)
    if not payload:
        return None
    # 旧令牌没有 typ，仍然当作访问令牌；刷新令牌不能拿来调接口
    if payload.get("typ") == "refresh":
        return None
    return payload


def decode_refresh_token(token: str) -> dict | None:
    payload = _decode_token(token)
    if not payload or payload.get("typ") != "refresh":
        return None
    return payload
