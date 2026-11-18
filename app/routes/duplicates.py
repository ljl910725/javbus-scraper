import asyncio

from fastapi import APIRouter, HTTPException, Request

from app.deps import CurrentUser
from app.duplicates import delete_video_file, iter_scan_duplicate_videos, scan_duplicate_videos
from app.models import (
    DuplicateDeleteRequest,
    DuplicateDeleteResponse,
    DuplicateGroup,
    DuplicateScanRequest,
    DuplicateScanResponse,
)
from app.routes.streaming import stream_thread_events

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


@router.post("/scan/stream")
async def scan_duplicates_stream(body: DuplicateScanRequest, request: Request, user: CurrentUser):
    if not body.folders:
        raise HTTPException(status_code=400, detail="请至少选择一个文件夹")

    return stream_thread_events(
        request,
        lambda stop: iter_scan_duplicate_videos(body.folders, stop=stop),
        error_prefix="筛选失败",
    )


@router.post("/delete", response_model=DuplicateDeleteResponse)
async def delete_duplicate(body: DuplicateDeleteRequest, user: CurrentUser) -> DuplicateDeleteResponse:
    try:
        data = await asyncio.to_thread(delete_video_file, body.path)
        return DuplicateDeleteResponse(**data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"删除失败: {exc}") from exc
