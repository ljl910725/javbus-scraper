from typing import Annotated

from fastapi import Depends, HTTPException, Request

from app import db
from app.auth import decode_access_token


async def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录")

    token = auth_header.removeprefix("Bearer ").strip()
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="登录已过期")

    user = db.get_user_by_id(int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user


async def get_optional_user(request: Request) -> dict | None:
    auth_header = request.headers.get("Authorization", "")
    token = ""
    if auth_header.startswith("Bearer "):
        token = auth_header.removeprefix("Bearer ").strip()
    else:
        token = (request.query_params.get("access_token") or "").strip()

    if not token:
        return None

    payload = decode_access_token(token)
    if not payload:
        return None

    return db.get_user_by_id(int(payload["sub"]))


CurrentUser = Annotated[dict, Depends(get_current_user)]
OptionalUser = Annotated[dict | None, Depends(get_optional_user)]
