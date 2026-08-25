import asyncio

from fastapi import APIRouter, HTTPException

from app.deps import CurrentUser
from app.duplicates import delete_video_file, scan_duplicate_videos
from app.models import (
    DuplicateDeleteRequest,
    DuplicateDeleteResponse,
    DuplicateGroup,
    DuplicateScanRequest,
    DuplicateScanResponse,
)

router = APIRouter(prefix="/api/duplicates")


@router.post("/scan", response_model=DuplicateScanResponse)
async def scan_duplicates(body: DuplicateScanRequest, user: CurrentUser) -> DuplicateScanResponse:
    try:
        data = await asyncio.to_thread(scan_duplicate_videos, body.folders)
        return DuplicateScanResponse(
            groups=[DuplicateGroup(**group) for group in data["groups"]],
            scanned=data["scanned"],
            videos=data["videos"],
            duplicate_codes=data["duplicate_codes"],
            duplicate_files=data["duplicate_files"],
            truncated=data["truncated"],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"筛选失败: {exc}") from exc


@router.post("/delete", response_model=DuplicateDeleteResponse)
async def delete_duplicate(body: DuplicateDeleteRequest, user: CurrentUser) -> DuplicateDeleteResponse:
    try:
        data = await asyncio.to_thread(delete_video_file, body.path)
        return DuplicateDeleteResponse(**data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"删除失败: {exc}") from exc
