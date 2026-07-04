from fastapi import APIRouter

from app import db
from app.deps import CurrentUser
from app.models import UserSettingsRequest, UserSettingsResponse
from app.user_settings import apply_settings_update, merge_settings, public_settings

router = APIRouter(prefix="/api/settings")


@router.get("", response_model=UserSettingsResponse)
async def get_settings(user: CurrentUser) -> UserSettingsResponse:
    stored = db.get_user_settings(user["id"])
    merged = merge_settings(stored)
    return UserSettingsResponse(settings=public_settings(merged))


@router.put("", response_model=UserSettingsResponse)
async def update_settings(
    body: UserSettingsRequest,
    user: CurrentUser,
) -> UserSettingsResponse:
    current = db.get_user_settings(user["id"])
    updates = body.model_dump(exclude_none=True)
    stored = apply_settings_update(current, updates)
    saved = db.save_user_settings(user["id"], stored)
    merged = merge_settings(saved)
    return UserSettingsResponse(settings=public_settings(merged))
