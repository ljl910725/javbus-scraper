import asyncio
import json
import threading

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse

from app.deps import CurrentUser, OptionalUser
from app.duplicates import delete_video_file
from app.missing_subs import IMAGE_EXTS, iter_scan_missing_subs
from app.models import DuplicateDeleteRequest, DuplicateDeleteResponse, MissingSubScanRequest
from app.subtitles.storage import resolve_file

router = APIRouter(prefix="/api/missing-subs")


@router.post("/scan/stream")
async def scan_missing_subs_stream(body: MissingSubScanRequest, request: Request, user: CurrentUser):
    if not body.folders:
        raise HTTPException(status_code=400, detail="请至少选择一个文件夹")

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict | None] = asyncio.Queue()
    stop = threading.Event()

    def worker() -> None:
        try:
            for event in iter_scan_missing_subs(
                body.folders,
                stop=stop,
                limit=body.limit,
                offset=body.offset,
            ):
                loop.call_soon_threadsafe(queue.put_nowait, event)
        except ValueError as exc:
            loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": str(exc)})
        except Exception as exc:
            loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": f"排查失败: {exc}"})
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
async def delete_missing_sub_file(body: DuplicateDeleteRequest, user: CurrentUser) -> DuplicateDeleteResponse:
    try:
        data = await asyncio.to_thread(delete_video_file, body.path)
        return DuplicateDeleteResponse(**data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"删除失败: {exc}") from exc


@router.get("/image")
async def missing_sub_image(
    user: OptionalUser,
    path: str = Query(..., description="本地图片路径"),
):
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    try:
        target = resolve_file(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if target.suffix.lower() not in IMAGE_EXTS:
        raise HTTPException(status_code=400, detail="只能预览图片文件")
    return FileResponse(target)
