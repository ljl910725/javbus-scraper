from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app import db
from app.deps import CurrentUser, OptionalUser
from app.models import (
    SubtitleBrowseResponse,
    SubtitleItem,
    SubtitleSaveRequest,
    SubtitleSaveResponse,
    SubtitleSearchResponse,
)
from app.subtitles.service import (
    download_subtitle_file,
    save_subtitle_to_path,
    search_subtitles,
    user_settings_from_id,
)
from app.subtitles.storage import list_directory
from app.user_settings import apply_settings_update

router = APIRouter(prefix="/api/subtitles")


@router.get("/search", response_model=SubtitleSearchResponse)
async def subtitle_search(
    code: str = Query(..., min_length=1, description="番号"),
    user: OptionalUser = None,
) -> SubtitleSearchResponse:
    try:
        data = await search_subtitles(code, user_settings=user_settings_from_id(user))
        return SubtitleSearchResponse(
            code=data["code"],
            results=[SubtitleItem(**item) for item in data["results"]],
            providers=data["providers"],
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"字幕搜索失败: {exc}") from exc


@router.get("/browse", response_model=SubtitleBrowseResponse)
async def subtitle_browse(
    user: CurrentUser,
    path: str = Query("", description="要浏览的目录路径，留空显示根目录"),
) -> SubtitleBrowseResponse:
    try:
        data = list_directory(path or None)
        return SubtitleBrowseResponse(**data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"目录浏览失败: {exc}") from exc


@router.get("/download")
async def subtitle_download(
    provider: str = Query(..., description="字幕来源"),
    sub_id: str = Query(..., description="字幕 ID"),
    rev_id: str = Query("", description="字幕版本 ID"),
    detail_url: str = Query(..., description="字幕详情页 URL"),
    code: str = Query("", description="番号"),
    language_code: str = Query("", description="语言代码"),
    user: OptionalUser = None,
) -> Response:
    try:
        content, filename = await download_subtitle_file(
            provider=provider,
            sub_id=sub_id,
            rev_id=rev_id,
            detail_url=detail_url,
            code=code,
            language_code=language_code,
            user_settings=user_settings_from_id(user),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"字幕下载失败: {exc}") from exc

    return Response(
        content=content,
        media_type="application/x-subrip; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/save", response_model=SubtitleSaveResponse)
async def subtitle_save(body: SubtitleSaveRequest, user: CurrentUser) -> SubtitleSaveResponse:
    try:
        result = await save_subtitle_to_path(
            provider=body.provider,
            sub_id=body.sub_id,
            rev_id=body.rev_id,
            detail_url=body.detail_url,
            code=body.code,
            language_code=body.language_code,
            target_dir=body.target_dir,
            filename=body.filename,
            user_settings=user_settings_from_id(user),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"字幕保存失败: {exc}") from exc

    current = db.get_user_settings(user["id"])
    stored = apply_settings_update(current, {"subtitle_save_dir": body.target_dir.strip()})
    db.save_user_settings(user["id"], stored)

    return SubtitleSaveResponse(**result)
