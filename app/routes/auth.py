from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from app import db
from app.auth import (
    decode_access_token,
    decode_refresh_token,
    hash_password,
    issue_session_tokens,
    token_expires_at,
    verify_password,
)
from app.deps import CurrentUser
from app.models import AuthResponse, LoginRequest, RefreshRequest, RegisterRequest

router = APIRouter(prefix="/api/auth")
REMEMBER_DAY_CHOICES = (1, 7, 30, 365)


def _remember_deadline(days: int) -> datetime:
    # 只接受登录框里的四个时长，截止时间从这次登录开始算
    if days not in REMEMBER_DAY_CHOICES:
        raise HTTPException(status_code=400, detail="自动登录时长只能是 1、7、30 或 365 天")
    return datetime.now(timezone.utc) + timedelta(days=days)


@router.post("/register", response_model=AuthResponse)
async def register(body: RegisterRequest) -> AuthResponse:
    username = body.username.strip()
    email = body.email.strip().lower()
    password = body.password

    if len(username) < 3:
        raise HTTPException(status_code=400, detail="用户名至少 3 个字符")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 个字符")
    if "@" not in email:
        raise HTTPException(status_code=400, detail="邮箱格式不正确")

    if db.get_user_by_username(username):
        raise HTTPException(status_code=400, detail="用户名已存在")

    user = db.create_user(username, email, hash_password(password))
    return _auth_response(user, _remember_deadline(body.remember_days))


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest) -> AuthResponse:
    user = db.get_user_by_username(body.username.strip())
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    return _auth_response(user, _remember_deadline(body.remember_days))


@router.post("/refresh", response_model=AuthResponse)
async def refresh(body: RefreshRequest) -> AuthResponse:
    # 先用刷新令牌；老的登录只有访问令牌，只要还没过期也给续上
    payload = decode_refresh_token(body.refresh_token) if body.refresh_token else None
    if payload is None and body.access_token:
        payload = decode_access_token(body.access_token)
    if not payload:
        raise HTTPException(status_code=401, detail="登录已过期")

    user = db.get_user_by_id(int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    expires_at = token_expires_at(payload)
    if not expires_at or expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="登录已过期")
    # 打开页面只换新令牌，截止时间仍是登录时选的那天
    return _auth_response(user, expires_at)


@router.get("/me")
async def me(user: CurrentUser):
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
    }


def _auth_response(user: dict, expires_at: datetime) -> AuthResponse:
    access_token, refresh_token = issue_session_tokens(user["id"], user["username"], expires_at)
    return AuthResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user={
            "id": user["id"],
            "username": user["username"],
            "email": user["email"],
        },
    )
