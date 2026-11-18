import asyncio
import json
import threading
from collections.abc import Callable, Iterator

from fastapi import Request
from fastapi.responses import StreamingResponse

FINAL_EVENT_TYPES = {"done", "error", "cancelled"}


def stream_thread_events(
    request: Request,
    iterate: Callable[[threading.Event], Iterator[dict]],
    *,
    error_prefix: str,
    before_send: Callable[[dict], None] | None = None,
) -> StreamingResponse:
    """把后台线程里一边扫目录一边产出的进度事件，转成浏览器能边收边显示的进度流。"""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict | None] = asyncio.Queue()
    stop = threading.Event()

    def worker() -> None:
        try:
            for event in iterate(stop):
                loop.call_soon_threadsafe(queue.put_nowait, event)
        except ValueError as exc:
            loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": str(exc)})
        except Exception as exc:
            loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": f"{error_prefix}: {exc}"})
        finally:
            # 放一个 None 表示线程结束，下面的循环收到后就退出
            loop.call_soon_threadsafe(queue.put_nowait, None)

    loop.run_in_executor(None, worker)

    async def event_gen():
        try:
            while True:
                # 浏览器关掉或点了取消，通知扫描线程尽快停
                if await request.is_disconnected():
                    stop.set()
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=0.4)
                except asyncio.TimeoutError:
                    continue
                if event is None:
                    break
                if before_send is not None:
                    before_send(event)
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event.get("type") in FINAL_EVENT_TYPES:
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
