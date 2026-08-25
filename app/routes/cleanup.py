import asyncio
import json
import threading

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.cleanup import iter_run_cleanup, iter_scan_cleanup
from app.deps import CurrentUser
from app.models import CleanupRequest

router = APIRouter(prefix="/api/cleanup")


def _stream_cleanup(request: Request, worker_factory):
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict | None] = asyncio.Queue()
    stop = threading.Event()

    def worker() -> None:
        try:
            for event in worker_factory(stop):
                loop.call_soon_threadsafe(queue.put_nowait, event)
        except ValueError as exc:
            loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": str(exc)})
        except Exception as exc:
            loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": f"清理失败: {exc}"})
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


@router.post("/scan/stream")
async def scan_cleanup_stream(body: CleanupRequest, request: Request, user: CurrentUser):
    if not body.folders:
        raise HTTPException(status_code=400, detail="请至少选择一个文件夹")

    def worker_factory(stop):
        return iter_scan_cleanup(body.folders, body.extra_exts, stop=stop)

    return _stream_cleanup(request, worker_factory)


@router.post("/run/stream")
async def run_cleanup_stream(body: CleanupRequest, request: Request, user: CurrentUser):
    if not body.folders:
        raise HTTPException(status_code=400, detail="请至少选择一个文件夹")

    def worker_factory(stop):
        return iter_run_cleanup(body.folders, body.extra_exts, stop=stop)

    return _stream_cleanup(request, worker_factory)
