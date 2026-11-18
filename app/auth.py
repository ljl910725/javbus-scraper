from datetime import datetime

import bcrypt
from jose import JWTError, jwt

from app.config import settings


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(user_id: int, username: str, expires_at: datetime) -> str:
    # 截止时间就是登录时选的自动登录时长，到点后必须重新登录
    payload = {
        "sub": str(user_id),
        "username": username,
        "exp": expires_at,
        "typ": "access",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError:
        return None
    # 之前版本发过刷新令牌，它不能拿来调接口
    if payload.get("typ") == "refresh":
        return None
    return payload
