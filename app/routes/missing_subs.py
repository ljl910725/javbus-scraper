import asyncio
import json
import threading

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse

from app import db
from app.deps import CurrentUser, OptionalUser
from app.duplicates import delete_video_file
from app.ignored_replace import check_pending_ignored
from app.missing_subs import IMAGE_EXTS, iter_scan_missing_subs
from app.models import (
    DuplicateDeleteRequest,
    DuplicateDeleteResponse,
    IgnoreMissingSubRequest,
    IgnoredMissingSubCheckItemResult,
    IgnoredMissingSubCheckRequest,
    IgnoredMissingSubCheckResponse,
    IgnoredMissingSubItem,
    IgnoredMissingSubListResponse,
    MissingSubScanRequest,
    NosubReplaceJob,
    NosubReplaceJobListResponse,
    NosubReplaceItem,
    NosubReplaceRequest,
)
from app.replace_job import run_replace_job_events
from app.subtitles.storage import resolve_file

router = APIRouter(prefix="/api/missing-subs")


@router.post("/scan/stream")
async def scan_missing_subs_stream(body: MissingSubScanRequest, request: Request, user: CurrentUser):
    if not body.folders:
        raise HTTPException(status_code=400, detail="请至少选择一个文件夹")

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict | None] = asyncio.Queue()
    stop = threading.Event()
    ignored_paths = db.list_ignored_missing_paths(user["id"])

    def worker() -> None:
        try:
            for event in iter_scan_missing_subs(
                body.folders,
                stop=stop,
                limit=body.limit,
                offset=body.offset,
                ignored_paths=ignored_paths,
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


def _ignored_item(row: dict) -> IgnoredMissingSubItem:
    return IgnoredMissingSubItem(
        id=row["id"],
        path=row["path"],
        name=row.get("name") or "",
        code=row.get("code") or "",
        part=row.get("part") or "",
        title=row.get("title") or "",
        size=row.get("size") or "",
        parent_dir=row.get("parent_dir") or "",
        status=row.get("status") or "ignored",
        magnet_link=row.get("magnet_link") or "",
        magnet_title=row.get("magnet_title") or "",
        message=row.get("message") or "",
        last_checked_at=row.get("last_checked_at") or "",
        replaced_at=row.get("replaced_at") or "",
        created_at=row.get("created_at") or "",
    )


@router.post("/ignore", response_model=IgnoredMissingSubItem)
async def ignore_missing_sub(body: IgnoreMissingSubRequest, user: CurrentUser) -> IgnoredMissingSubItem:
    path = (body.path or "").strip()
    if not path:
        raise HTTPException(status_code=400, detail="文件路径不能为空")
    item = db.add_ignored_missing_sub(
        user["id"],
        path=path,
        name=body.name,
        code=body.code,
        part=body.part,
        title=body.title,
        size=body.size,
        parent_dir=body.parent_dir,
    )
    return _ignored_item(item)


@router.get("/ignored", response_model=IgnoredMissingSubListResponse)
async def list_ignored_missing_subs(user: CurrentUser) -> IgnoredMissingSubListResponse:
    items = db.list_ignored_missing_subs(user["id"])
    return IgnoredMissingSubListResponse(items=[_ignored_item(item) for item in items])


@router.delete("/ignored/{item_id}")
async def unignore_missing_sub(item_id: int, user: CurrentUser) -> dict:
    if not db.delete_ignored_missing_sub(item_id, user["id"]):
        raise HTTPException(status_code=404, detail="忽略记录不存在")
    return {"deleted": True, "id": item_id}


@router.post("/ignored/check", response_model=IgnoredMissingSubCheckResponse)
async def check_ignored_missing_subs(
    user: CurrentUser,
    body: IgnoredMissingSubCheckRequest | None = None,
) -> IgnoredMissingSubCheckResponse:
    payload = body or IgnoredMissingSubCheckRequest()
    try:
        results = await check_pending_ignored(user_id=user["id"], item_id=payload.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"检查失败: {exc}") from exc

    replaced = sum(1 for item in results if item.get("replaced"))
    if payload.id is not None:
        message = results[0]["message"] if results else "没有可检查的记录"
    elif not results:
        message = "没有等待替换的忽略文件"
    else:
        message = f"已检查 {len(results)} 条，替换 {replaced} 条"

    return IgnoredMissingSubCheckResponse(
        success=True,
        message=message,
        results=[IgnoredMissingSubCheckItemResult(**item) for item in results],
    )


def _replace_job(row: dict) -> NosubReplaceJob:
    return NosubReplaceJob(
        id=row["id"],
        status=row.get("status") or "running",
        folders=row.get("folders") or [],
        scanned=row.get("scanned") or 0,
        videos=row.get("videos") or 0,
        total=row.get("total") or 0,
        replaced_count=row.get("replaced_count") or 0,
        not_found_count=row.get("not_found_count") or 0,
        push_failed_count=row.get("push_failed_count") or 0,
        error_count=row.get("error_count") or 0,
        message=row.get("message") or "",
        started_at=row.get("started_at") or "",
        finished_at=row.get("finished_at") or "",
        items=[NosubReplaceItem(**item) for item in row.get("items") or []],
    )


@router.post("/replace/stream")
async def replace_missing_subs_stream(body: NosubReplaceRequest, request: Request, user: CurrentUser):
    if not body.folders:
        raise HTTPException(status_code=400, detail="请至少选择一个文件夹")

    stop = threading.Event()

    async def disconnected() -> bool:
        return await request.is_disconnected()

    async def event_gen():
        try:
            async for event in run_replace_job_events(
                user=user,
                folders=body.folders,
                stop=stop,
                request_disconnected=disconnected,
            ):
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


@router.get("/replace/jobs", response_model=NosubReplaceJobListResponse)
async def list_replace_jobs(user: CurrentUser) -> NosubReplaceJobListResponse:
    items = db.list_nosub_replace_jobs(user["id"])
    return NosubReplaceJobListResponse(items=[_replace_job(item) for item in items])


@router.get("/replace/jobs/{job_id}", response_model=NosubReplaceJob)
async def get_replace_job(job_id: int, user: CurrentUser) -> NosubReplaceJob:
    item = db.get_nosub_replace_job(job_id, user["id"])
    if not item:
        raise HTTPException(status_code=404, detail="执行记录不存在")
    return _replace_job(item)
