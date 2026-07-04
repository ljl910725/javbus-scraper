from fastapi import APIRouter, HTTPException

from app import db
from app.auth import create_access_token, hash_password, verify_password
from app.deps import CurrentUser
from app.models import AuthResponse, LoginRequest, RegisterRequest

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
    token = create_access_token(user["id"], user["username"])
    return AuthResponse(
        access_token=token,
        user={"id": user["id"], "username": user["username"], "email": user["email"]},
    )


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest) -> AuthResponse:
    user = db.get_user_by_username(body.username.strip())
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    token = create_access_token(user["id"], user["username"])
    return AuthResponse(
        access_token=token,
        user={
            "id": user["id"],
            "username": user["username"],
            "email": user["email"],
        },
    )


@router.get("/me")
async def me(user: CurrentUser):
    return user
