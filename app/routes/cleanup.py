from fastapi import APIRouter, HTTPException, Request

from app import db
from app.cleanup import iter_run_cleanup, iter_scan_cleanup
from app.deps import CurrentUser
from app.models import CleanupRequest
from app.routes.streaming import stream_thread_events
from app.user_settings import apply_settings_update

router = APIRouter(prefix="/api/cleanup")


def _cleanup_kwargs(body: CleanupRequest) -> dict:
    return {
        "extra_exts": body.extra_exts,
        "delete_html": body.delete_html,
        "delete_txt": body.delete_txt,
        "delete_small_video": body.delete_small_video,
        "small_video_mb": body.small_video_mb,
    }


def _persist_cleanup_rules(user_id: int, body: CleanupRequest) -> None:
    try:
        current = db.get_user_settings(user_id)
        stored = apply_settings_update(
            current,
            {
                "cleanup_delete_html": body.delete_html,
                "cleanup_delete_txt": body.delete_txt,
                "cleanup_delete_small_video": body.delete_small_video,
                "cleanup_small_video_mb": body.small_video_mb,
                "cleanup_extra_exts": body.extra_exts or "",
            },
        )
        db.save_user_settings(user_id, stored)
    except Exception:
        return


@router.post("/scan/stream")
async def scan_cleanup_stream(body: CleanupRequest, request: Request, user: CurrentUser):
    if not body.folders:
        raise HTTPException(status_code=400, detail="请至少选择一个文件夹")
    _persist_cleanup_rules(user["id"], body)
    kwargs = _cleanup_kwargs(body)
    return stream_thread_events(
        request,
        lambda stop: iter_scan_cleanup(body.folders, stop=stop, **kwargs),
        error_prefix="清理失败",
    )


@router.post("/run/stream")
async def run_cleanup_stream(body: CleanupRequest, request: Request, user: CurrentUser):
    if not body.folders:
        raise HTTPException(status_code=400, detail="请至少选择一个文件夹")
    _persist_cleanup_rules(user["id"], body)
    kwargs = _cleanup_kwargs(body)
    return stream_thread_events(
        request,
        lambda stop: iter_run_cleanup(body.folders, stop=stop, **kwargs),
        error_prefix="清理失败",
    )
