from fastapi import APIRouter, HTTPException

from app.deps import OptionalUser
from app import db
from app.models import TranslateRequest, TranslateResponse
from app.services.translate import TranslateError, translate_text
from app.user_settings import merge_settings

router = APIRouter(prefix="/api")


@router.post("/translate", response_model=TranslateResponse)
async def translate(body: TranslateRequest, user: OptionalUser) -> TranslateResponse:
    user_settings = db.get_user_settings(user["id"]) if user else None
    try:
        result = await translate_text(
            body.text,
            user_settings=user_settings,
            engine=body.engine,
            target_lang=body.target_lang,
        )
        return TranslateResponse(**result)
    except TranslateError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
