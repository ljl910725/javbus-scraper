from fastapi import APIRouter, HTTPException

from app import db
from app.auth import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
    hash_password,
    verify_password,
)
from app.deps import CurrentUser
from app.models import AuthResponse, LoginRequest, RefreshRequest, RegisterRequest

router = APIRouter(prefix="/api/auth")


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
    return _auth_response(user)


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest) -> AuthResponse:
    user = db.get_user_by_username(body.username.strip())
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    return _auth_response(user)


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
    return _auth_response(user)


@router.get("/me")
async def me(user: CurrentUser):
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
    }


def _auth_response(user: dict) -> AuthResponse:
    return AuthResponse(
        access_token=create_access_token(user["id"], user["username"]),
        refresh_token=create_refresh_token(user["id"], user["username"]),
        user={
            "id": user["id"],
            "username": user["username"],
            "email": user["email"],
        },
    )
