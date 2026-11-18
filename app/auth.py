from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def _encode_token(user_id: int, username: str, *, days: int, typ: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=days)
    payload = {
        "sub": str(user_id),
        "username": username,
        "exp": expire,
        "typ": typ,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: int, username: str) -> str:
    # 访问令牌：打开页面时会续期，避免隔几天就被当成未登录
    return _encode_token(user_id, username, days=settings.jwt_expire_days, typ="access")


def create_refresh_token(user_id: int, username: str) -> str:
    # 刷新令牌只用来换新的访问令牌，有效期更长
    return _encode_token(user_id, username, days=365, typ="refresh")


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
