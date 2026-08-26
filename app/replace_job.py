from __future__ import annotations

import asyncio
import logging
import threading
import time
from pathlib import Path

from app import db
from app.config import settings
from app.duplicates import delete_video_file
from app.ignored_replace import pick_subtitle_magnet
from app.integrations import p115
from app.integrations.p115 import P115Error, P115NotConfiguredError
from app.missing_subs import _MAX_REPLACE_ITEMS, iter_scan_missing_subs
from app.scraper.article_torrents import fetch_article_torrents
from app.scraper.service import ScrapeError, scrape_movie
from app.user_settings import merge_settings

logger = logging.getLogger(__name__)
_job_lock = asyncio.Lock()
FOLDER_LOCK_SECONDS = 300
_folder_locks_guard = threading.Lock()
_folder_locks: dict[tuple[int, str], dict] = {}


class FolderLockBusy(Exception):
    pass


def _normalize_folder_path(path: str) -> str:
    text = (path or "").strip()
    if not text:
        return ""
    return str(Path(text)).replace("\\", "/").rstrip("/") or "/"


def _format_wait(seconds: float) -> str:
    remaining = max(1, int(seconds))
    minutes, secs = divmod(remaining, 60)
    if minutes and secs:
        return f"{minutes} 分 {secs} 秒"
    if minutes:
        return f"{minutes} 分钟"
    return f"{secs} 秒"


def try_acquire_folder_locks(user_id: int, folders: list[str]) -> list[str]:
    keys: list[str] = []
    seen: set[str] = set()
    for folder in folders:
        key = _normalize_folder_path(folder)
        if not key or key in seen:
            continue
        seen.add(key)
        keys.append(key)

    now = time.monotonic()
    with _folder_locks_guard:
        for key in keys:
            entry = _folder_locks.get((user_id, key))
            if not entry:
                continue
            if entry.get("running"):
                raise FolderLockBusy(f"「{key}」正在一键替换中，请等当前任务完成后再试")
            remaining = float(entry.get("expire") or 0) - now
            if remaining > 0:
                raise FolderLockBusy(
                    f"「{key}」5 分钟内已经执行过一键替换，请 {_format_wait(remaining)} 后再试"
                )
            _folder_locks.pop((user_id, key), None)
        expire = now + FOLDER_LOCK_SECONDS
        for key in keys:
            _folder_locks[(user_id, key)] = {"running": True, "expire": expire}
    return keys


def release_folder_locks(user_id: int, keys: list[str]) -> None:
    now = time.monotonic()
    with _folder_locks_guard:
        for key in keys:
            entry = _folder_locks.get((user_id, key))
            if not entry:
                continue
            entry["running"] = False
            if float(entry.get("expire") or 0) <= now:
                _folder_locks.pop((user_id, key), None)


def _file_exists(path: str) -> bool:
    from pathlib import Path

    try:
        return Path(path).is_file()
    except OSError:
        return False


def _item_payload(item: dict, *, status: str, message: str, magnet_title: str = "") -> dict:
    return {
        "status": status,
        "code": item.get("code") or "",
        "name": item.get("name") or "",
        "path": item.get("path") or "",
        "message": message,
        "magnet_title": magnet_title,
    }


async def replace_missing_file(item: dict, *, user: dict, stored: dict) -> dict:
    code = (item.get("code") or "").strip()
    path = item.get("path") or ""
    if not code:
        return _item_payload(item, status="error", message="无法识别番号")

    user_cfg = merge_settings(stored)
    if not (user_cfg.get("p115_cookie") or "").strip():
        return _item_payload(item, status="push_failed", message="未配置 115 Cookie")

    magnet = None
    used_javbus = False
    try:
        torrents = await fetch_article_torrents(code)
        magnet = pick_subtitle_magnet(torrents)
        if magnet is None:
            used_javbus = True
            movie = await scrape_movie(code, user_settings=stored)
            magnet = pick_subtitle_magnet(movie.magnets)
    except ScrapeError as exc:
        return _item_payload(item, status="error", message=f"请求接口失败: {exc}")
    except Exception as exc:
        return _item_payload(item, status="error", message=f"请求接口失败: {exc}")

    if used_javbus:
        await asyncio.sleep(max(0.3, float(settings.request_delay)))

    if magnet is None:
        return _item_payload(item, status="not_found", message="未找到带字幕磁力")

    try:
        push_result = await p115.push_magnet(magnet.link, stored)
    except (P115NotConfiguredError, P115Error) as exc:
        return _item_payload(
            item,
            status="push_failed",
            message=str(exc) or "推送115失败",
            magnet_title=magnet.title,
        )
    except Exception as exc:
        return _item_payload(
            item,
            status="push_failed",
            message=f"推送115失败: {exc}",
            magnet_title=magnet.title,
        )

    pushed = bool(push_result.success) or "已存在" in (push_result.message or "")
    if not pushed:
        return _item_payload(
            item,
            status="push_failed",
            message=push_result.message or "推送115失败",
            magnet_title=magnet.title,
        )

    db.add_push_history(
        user["id"],
        code=code,
        magnet_link=magnet.link,
        magnet_title=magnet.title,
        backend="p115",
        folder_id=str(user_cfg.get("p115_folder_cid") or ""),
        folder_name="",
        folder_path=str(user_cfg.get("p115_folder_path") or ""),
        success=True,
        message=push_result.message or "一键替换推送成功",
    )

    if _file_exists(path):
        try:
            delete_video_file(path)
        except Exception as exc:
            return _item_payload(
                item,
                status="error",
                message=f"已推送115，但删除原文件失败: {exc}",
                magnet_title=magnet.title,
            )

    ignored = db.get_ignored_missing_sub_by_path(user["id"], path)
    if ignored:
        db.update_ignored_missing_sub(
            ignored["id"],
            magnet_link=magnet.link,
            magnet_title=magnet.title,
            message="一键替换：已推送115并删除原文件",
            mark_replaced=True,
        )

    return _item_payload(
        item,
        status="replaced",
        message="已推送115并删除原文件",
        magnet_title=magnet.title,
    )


def _record_item(job_id: int, payload: dict) -> dict:
    return db.add_nosub_replace_item(
        job_id,
        status=payload["status"],
        code=payload.get("code") or "",
        name=payload.get("name") or "",
        path=payload.get("path") or "",
        message=payload.get("message") or "",
        magnet_title=payload.get("magnet_title") or "",
    )


async def run_replace_job_events(
    *,
    user: dict,
    folders: list[str],
    stop: threading.Event,
    request_disconnected,
):
    job = db.create_nosub_replace_job(user["id"], folders)
    job_id = job["id"]
    yield {"type": "job", "job_id": job_id, "job": job}

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict | None] = asyncio.Queue()
    stored = db.get_user_settings(user["id"])
    user_cfg = merge_settings(stored)
    if not (user_cfg.get("p115_cookie") or "").strip():
        message = "未配置 115 Cookie，无法推送"
        db.update_nosub_replace_job(job_id, status="error", message=message, mark_finished=True)
        yield {"type": "error", "message": message, "job_id": job_id}
        return

    def worker() -> None:
        try:
            for event in iter_scan_missing_subs(
                folders,
                stop=stop,
                collect_all=True,
                ignored_paths=set(),
            ):
                loop.call_soon_threadsafe(queue.put_nowait, event)
        except ValueError as exc:
            loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": str(exc)})
        except Exception as exc:
            loop.call_soon_threadsafe(
                queue.put_nowait,
                {"type": "error", "message": f"遍历文件失败: {exc}"},
            )
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    loop.run_in_executor(None, worker)

    items: list[dict] = []
    meta: dict = {}
    while True:
        if await request_disconnected():
            stop.set()
        try:
            event = await asyncio.wait_for(queue.get(), timeout=0.4)
        except asyncio.TimeoutError:
            continue
        if event is None:
            break
        kind = event.get("type")
        if kind == "progress":
            yield {**event, "job_id": job_id}
            continue
        if kind == "done":
            meta = event.get("result") or {}
            items = list(meta.get("items") or [])
            continue
        if kind == "cancelled":
            db.update_nosub_replace_job(
                job_id,
                status="cancelled",
                message="已取消",
                mark_finished=True,
            )
            yield {"type": "cancelled", "job_id": job_id}
            return
        if kind == "error":
            message = event.get("message") or "遍历文件失败"
            db.add_nosub_replace_item(job_id, status="error", message=message)
            db.update_nosub_replace_job(job_id, status="error", message=message, mark_finished=True)
            yield {"type": "error", "message": message, "job_id": job_id}
            return

    counts = {
        "replaced_count": 0,
        "not_found_count": 0,
        "push_failed_count": 0,
        "error_count": 0,
    }

    def _counts_payload() -> dict:
        return dict(counts)

    def _bump_count(status: str) -> None:
        key = {
            "replaced": "replaced_count",
            "not_found": "not_found_count",
            "push_failed": "push_failed_count",
            "error": "error_count",
        }.get(status)
        if key:
            counts[key] += 1

    for message in meta.get("walk_errors") or []:
        recorded = _record_item(
            job_id,
            {"status": "error", "code": "", "name": "", "path": "", "message": message, "magnet_title": ""},
        )
        _bump_count("error")
        yield {"type": "item", "job_id": job_id, "index": 0, "total": len(items), **_counts_payload(), **recorded}

    if meta.get("truncated") or meta.get("has_more"):
        recorded = _record_item(
            job_id,
            {
                "status": "error",
                "code": "",
                "name": "",
                "path": "",
                "message": f"扫描达到上限（最多 {_MAX_REPLACE_ITEMS} 个无字幕文件），后续文件未处理",
                "magnet_title": "",
            },
        )
        _bump_count("error")
        yield {"type": "item", "job_id": job_id, "index": 0, "total": len(items), **_counts_payload(), **recorded}

    db.update_nosub_replace_job(
        job_id,
        scanned=int(meta.get("scanned") or 0),
        videos=int(meta.get("videos") or 0),
        total=len(items),
        message=f"开始处理 {len(items)} 个无字幕文件",
    )
    yield {
        "type": "scan_done",
        "job_id": job_id,
        "scanned": int(meta.get("scanned") or 0),
        "videos": int(meta.get("videos") or 0),
        "total": len(items),
        **_counts_payload(),
    }

    if not items:
        db.update_nosub_replace_job(
            job_id,
            status="done",
            message="没有找到无字幕文件",
            mark_finished=True,
        )
        yield {"type": "done", "job_id": job_id, "job": db.get_nosub_replace_job(job_id, user["id"])}
        return

    async with _job_lock:
        for index, item in enumerate(items, start=1):
            if stop.is_set() or await request_disconnected():
                db.update_nosub_replace_job(
                    job_id,
                    status="cancelled",
                    message=f"已取消，处理到 {index - 1}/{len(items)}",
                    mark_finished=True,
                )
                yield {"type": "cancelled", "job_id": job_id, "index": index - 1, "total": len(items)}
                return
            yield {
                "type": "item_start",
                "job_id": job_id,
                "index": index,
                "total": len(items),
                "code": item.get("code") or "",
                "name": item.get("name") or "",
                "path": item.get("path") or "",
            }
            try:
                payload = await replace_missing_file(item, user=user, stored=stored)
            except Exception as exc:
                payload = _item_payload(item, status="error", message=f"处理失败: {exc}")
            recorded = _record_item(job_id, payload)
            _bump_count(payload["status"])
            event = {
                "type": "item",
                "job_id": job_id,
                "index": index,
                "total": len(items),
                **_counts_payload(),
                **recorded,
            }
            yield event
            if payload["status"] == "push_failed":
                yield {
                    "type": "toast",
                    "kind": "error",
                    "message": f"{payload.get('code') or payload.get('name') or '文件'} 推送115失败：{payload.get('message') or '未知错误'}",
                }

    finished = db.update_nosub_replace_job(
        job_id,
        status="done",
        scanned=int(meta.get("scanned") or 0),
        videos=int(meta.get("videos") or 0),
        total=len(items),
        message="",
        mark_finished=True,
    )
    yield {"type": "done", "job_id": job_id, "job": finished}
