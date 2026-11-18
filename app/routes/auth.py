from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from app import db
from app.auth import create_access_token, verify_password
from app.deps import CurrentUser
from app.models import AuthResponse, LoginRequest

router = APIRouter(prefix="/api/auth")
REMEMBER_DAY_CHOICES = (1, 7, 30, 365)


def _remember_deadline(days: int) -> datetime:
    # 只接受登录框里的四个时长，截止时间从这次登录开始算
    if days not in REMEMBER_DAY_CHOICES:
        raise HTTPException(status_code=400, detail="自动登录时长只能是 1、7、30 或 365 天")
    return datetime.now(timezone.utc) + timedelta(days=days)


@router.post("/register")
async def register():
    # 注册已关闭：注册后的账号能删除挂载目录里的视频，不能对外开放
    raise HTTPException(status_code=403, detail="注册已关闭")


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest) -> AuthResponse:
    user = db.get_user_by_username(body.username.strip())
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    expires_at = _remember_deadline(body.remember_days)
    return AuthResponse(
        access_token=create_access_token(user["id"], user["username"], expires_at),
        user={
            "id": user["id"],
            "username": user["username"],
            "email": user["email"],
        },
    )


@router.get("/me")
async def me(user: CurrentUser):
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
    }
