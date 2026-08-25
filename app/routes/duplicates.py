import asyncio
import json
import threading

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.deps import CurrentUser
from app.duplicates import delete_video_file, iter_scan_duplicate_videos, scan_duplicate_videos
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


@router.post("/scan/stream")
async def scan_duplicates_stream(body: DuplicateScanRequest, request: Request, user: CurrentUser):
    if not body.folders:
        raise HTTPException(status_code=400, detail="请至少选择一个文件夹")

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict | None] = asyncio.Queue()
    stop = threading.Event()

    def worker() -> None:
        try:
            for event in iter_scan_duplicate_videos(body.folders, stop=stop):
                loop.call_soon_threadsafe(queue.put_nowait, event)
        except ValueError as exc:
            loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": str(exc)})
        except Exception as exc:
            loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": f"筛选失败: {exc}"})
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    loop.run_in_executor(None, worker)

    async def event_gen():
        try:
            while True:
                if await request.is_disconnected():
                    stop.set()
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=0.4)
                except asyncio.TimeoutError:
                    continue
                if event is None:
                    break
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event.get("type") in {"done", "error", "cancelled"}:
                    break
        finally:
            stop.set()

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
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
