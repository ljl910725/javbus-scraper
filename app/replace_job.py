from __future__ import annotations

import asyncio
import logging
import threading
import time
from pathlib import Path

from app import db
from app.config import settings
from app.duplicates import delete_video_file
from app.ignored_replace import take_new_subtitle_magnets, try_push_subtitle_magnets
from app.integrations import push as push_service
from app.missing_subs import iter_scan_missing_subs
from app.scraper.article_torrents import fetch_article_torrents
from app.scraper.service import ScrapeError, scrape_movie
from app.user_settings import merge_settings

logger = logging.getLogger(__name__)
_job_lock = asyncio.Lock()
REPLACE_WORKERS = 2
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
    backend = push_service.active_backend(user_cfg)
    label = push_service.backend_label(user_cfg)
    if not backend:
        return _item_payload(item, status="push_failed", message="未配置推送方式，请在设置页配置 CD2 或 115")

    magnets = []
    used_javbus = False
    seen: set[str] = set()
    try:
        torrents = await fetch_article_torrents(code)
        magnets = take_new_subtitle_magnets(torrents, seen)
        if not magnets:
            used_javbus = True
            movie = await scrape_movie(code, user_settings=stored)
            magnets = take_new_subtitle_magnets(movie.magnets, seen)
    except ScrapeError as exc:
        return _item_payload(item, status="error", message=f"请求接口失败: {exc}")
    except Exception as exc:
        return _item_payload(item, status="error", message=f"请求接口失败: {exc}")

    if used_javbus:
        await asyncio.sleep(max(0.3, float(settings.request_delay)))

    if not magnets:
        if path:
            ignored = db.add_ignored_missing_sub(
                user["id"],
                path=path,
                name=item.get("name") or "",
                code=code,
                part=item.get("part") or "",
                title=item.get("title") or "",
                size=str(item.get("size") or ""),
                parent_dir=item.get("parent_dir") or "",
                message="一键替换：未找到带字幕磁力",
            )
            db.update_ignored_missing_sub(ignored["id"], mark_checked=True)
        return _item_payload(item, status="not_found", message="未找到带字幕磁力，已加入忽略列表")

    folder_id = push_service.default_folder_id(user_cfg)
    folder = push_service.folder_meta(user_cfg, folder_id)
    push_result, magnet, error, tried = await try_push_subtitle_magnets(
        magnets, stored, folder_id, label
    )

    if push_result is None and magnet is not None and not used_javbus:
        config_failed = "未配置" in (error or "")
        if not config_failed:
            try:
                await asyncio.sleep(max(0.3, float(settings.request_delay)))
                movie = await scrape_movie(code, user_settings=stored)
                extra = take_new_subtitle_magnets(movie.magnets, seen)
            except Exception as exc:
                extra = []
                if error:
                    error = f"{error}；补充源请求失败: {exc}"
                else:
                    error = f"补充源请求失败: {exc}"
            if extra:
                extra_result, extra_magnet, extra_error, extra_tried = await try_push_subtitle_magnets(
                    extra, stored, folder_id, label
                )
                tried += extra_tried
                if extra_result is not None and extra_magnet is not None:
                    push_result, magnet, error = extra_result, extra_magnet, ""
                else:
                    magnet = extra_magnet or magnet
                    last_error = extra_error.split("：", 1)[-1] if extra_error else error
                    error = f"已尝试 {tried} 条字幕磁力均失败"
                    if last_error:
                        error += f"：{last_error}"

    if push_result is None or magnet is None:
        return _item_payload(
            item,
            status="push_failed",
            message=error or f"推送{label}失败",
            magnet_title=(magnet.title if magnet else ""),
        )

    db.add_push_history(
        user["id"],
        code=code,
        magnet_link=magnet.link,
        magnet_title=magnet.title,
        backend=push_result.backend or backend,
        folder_id=str(folder.get("folder_id") or ""),
        folder_name=str(folder.get("folder_name") or ""),
        folder_path=str(folder.get("folder_path") or ""),
        success=True,
        message=push_result.message or f"一键替换推送{label}成功",
    )

    if _file_exists(path):
        try:
            delete_video_file(path)
        except Exception as exc:
            return _item_payload(
                item,
                status="error",
                message=f"已推送{label}，但删除原文件失败: {exc}",
                magnet_title=magnet.title,
            )

    ignored = db.get_ignored_missing_sub_by_path(user["id"], path)
    if ignored:
        db.update_ignored_missing_sub(
            ignored["id"],
            magnet_link=magnet.link,
            magnet_title=magnet.title,
            message=f"一键替换：已推送{label}并删除原文件",
            mark_replaced=True,
        )

    return _item_payload(
        item,
        status="replaced",
        message=f"已推送{label}并删除原文件",
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
    stored = db.get_user_settings(user["id"])
    user_cfg = merge_settings(stored)
    backend = push_service.active_backend(user_cfg)
    label = push_service.backend_label(user_cfg)
    if not backend:
        message = "未配置推送方式，请在设置页配置 CD2 或 115"
        db.update_nosub_replace_job(job_id, status="error", message=message, mark_finished=True)
        yield {"type": "error", "message": message, "job_id": job_id}
        return

    scan_q: asyncio.Queue[dict | None] = asyncio.Queue()
    work_q: asyncio.Queue[tuple[int, dict] | None] = asyncio.Queue()
    out_q: asyncio.Queue[dict] = asyncio.Queue()

    def scan_thread() -> None:
        ignored_paths = db.scan_skip_paths(user["id"])
        try:
            for event in iter_scan_missing_subs(
                folders,
                stop=stop,
                collect_all=True,
                ignored_paths=ignored_paths,
            ):
                if event.get("type") == "done":
                    meta = event.get("result") or {}
                    db.add_known_subtitle_files(user["id"], meta.pop("known_subtitles", None) or [])
                if stop.is_set():
                    loop.call_soon_threadsafe(scan_q.put_nowait, {"type": "cancelled"})
                    break
                loop.call_soon_threadsafe(scan_q.put_nowait, event)
        except ValueError as exc:
            loop.call_soon_threadsafe(scan_q.put_nowait, {"type": "error", "message": str(exc)})
        except Exception as exc:
            loop.call_soon_threadsafe(
                scan_q.put_nowait,
                {"type": "error", "message": f"遍历文件失败: {exc}"},
            )
        finally:
            loop.call_soon_threadsafe(scan_q.put_nowait, None)

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

    async def process_worker() -> None:
        while True:
            job_item = await work_q.get()
            try:
                if job_item is None:
                    break
                index, item = job_item
                if stop.is_set():
                    continue
                try:
                    payload = await replace_missing_file(item, user=user, stored=stored)
                except Exception as exc:
                    payload = _item_payload(item, status="error", message=f"处理失败: {exc}")
                await out_q.put({"kind": "result", "index": index, "item": item, "payload": payload})
            finally:
                work_q.task_done()

    async def pump_scan() -> None:
        found = 0
        meta: dict = {}
        try:
            while True:
                event = await scan_q.get()
                if event is None:
                    break
                kind = event.get("type")
                if kind == "progress":
                    await out_q.put(
                        {"kind": "sse", "event": {**event, "job_id": job_id, "scanning": True}}
                    )
                elif kind == "found":
                    if stop.is_set():
                        continue
                    found += 1
                    item = event.get("item") or {}
                    await out_q.put(
                        {
                            "kind": "sse",
                            "event": {
                                "type": "item_start",
                                "job_id": job_id,
                                "index": found,
                                "total": found,
                                "found": found,
                                "scanning": True,
                                "scanned": event.get("scanned") or 0,
                                "videos": event.get("videos") or 0,
                                "code": item.get("code") or "",
                                "name": item.get("name") or "",
                                "path": item.get("path") or "",
                            },
                        }
                    )
                    await work_q.put((found, item))
                elif kind == "done":
                    meta = event.get("result") or {}
                    found = max(found, int(meta.get("found") or 0))
                elif kind == "cancelled":
                    stop.set()
                    await out_q.put({"kind": "cancelled"})
                elif kind == "error":
                    stop.set()
                    await out_q.put(
                        {"kind": "error", "message": event.get("message") or "遍历文件失败"}
                    )
            await out_q.put({"kind": "scan_done", "found": found, "meta": meta})
            await work_q.join()
        finally:
            for _ in range(REPLACE_WORKERS):
                await work_q.put(None)
            await out_q.put({"kind": "all_done", "found": found, "meta": meta})

    processed = 0
    found_total = 0
    meta: dict = {}
    scan_finished = False
    finished_kind = ""
    error_message = ""
    worker_tasks: list[asyncio.Task] = []
    pump_task: asyncio.Task | None = None
    job_saved = False

    def save_job(status: str, message: str = "") -> dict | None:
        nonlocal job_saved
        if job_saved:
            return db.get_nosub_replace_job(job_id, user["id"])
        job_saved = True
        return db.update_nosub_replace_job(
            job_id,
            status=status,
            scanned=int(meta.get("scanned") or 0),
            videos=int(meta.get("videos") or 0),
            total=found_total,
            message=message,
            mark_finished=True,
        )

    try:
        async with _job_lock:
            loop.run_in_executor(None, scan_thread)
            worker_tasks = [asyncio.create_task(process_worker()) for _ in range(REPLACE_WORKERS)]
            pump_task = asyncio.create_task(pump_scan())
            while True:
                if await request_disconnected():
                    stop.set()
                    finished_kind = finished_kind or "interrupted"
                try:
                    msg = await asyncio.wait_for(out_q.get(), timeout=0.4)
                except asyncio.TimeoutError:
                    if stop.is_set() and pump_task and pump_task.done() and all(task.done() for task in worker_tasks):
                        finished_kind = finished_kind or "interrupted"
                        break
                    continue
                kind = msg.get("kind")
                if kind == "sse":
                    event = msg.get("event") or {}
                    if event.get("type") == "item_start":
                        found_total = max(found_total, int(event.get("found") or event.get("total") or 0))
                    yield event
                    continue
                if kind == "result":
                    processed += 1
                    found_total = max(found_total, int(msg.get("index") or 0), processed)
                    payload = msg.get("payload") or {}
                    recorded = _record_item(job_id, payload)
                    _bump_count(payload.get("status") or "error")
                    yield {
                        "type": "item",
                        "job_id": job_id,
                        "index": processed,
                        "total": found_total,
                        "scanning": not scan_finished,
                        **_counts_payload(),
                        **recorded,
                    }
                    if payload.get("status") == "push_failed":
                        yield {
                            "type": "toast",
                            "kind": "error",
                            "message": (
                                f"{payload.get('code') or payload.get('name') or '文件'} "
                                f"推送{label}失败：{payload.get('message') or '未知错误'}"
                            ),
                        }
                    continue
                if kind == "scan_done":
                    scan_finished = True
                    found_total = max(found_total, int(msg.get("found") or 0))
                    meta = msg.get("meta") or {}
                    for message in meta.get("walk_errors") or []:
                        recorded = _record_item(
                            job_id,
                            {
                                "status": "error",
                                "code": "",
                                "name": "",
                                "path": "",
                                "message": message,
                                "magnet_title": "",
                            },
                        )
                        _bump_count("error")
                        yield {
                            "type": "item",
                            "job_id": job_id,
                            "index": processed,
                            "total": found_total,
                            "scanning": False,
                            **_counts_payload(),
                            **recorded,
                        }
                    db.update_nosub_replace_job(
                        job_id,
                        scanned=int(meta.get("scanned") or 0),
                        videos=int(meta.get("videos") or 0),
                        total=found_total,
                        message=(
                            f"扫描结束，发现 {found_total} 个无字幕文件"
                            if found_total
                            else "没有找到无字幕文件"
                        ),
                    )
                    yield {
                        "type": "scan_done",
                        "job_id": job_id,
                        "scanned": int(meta.get("scanned") or 0),
                        "videos": int(meta.get("videos") or 0),
                        "total": found_total,
                        "scanning": False,
                        **_counts_payload(),
                    }
                    continue
                if kind == "cancelled":
                    finished_kind = "cancelled"
                    break
                if kind == "error":
                    finished_kind = "error"
                    error_message = msg.get("message") or "遍历文件失败"
                    break
                if kind == "all_done":
                    found_total = max(found_total, int(msg.get("found") or 0))
                    meta = msg.get("meta") or meta
                    finished_kind = "done"
                    break
    except (asyncio.CancelledError, GeneratorExit):
        finished_kind = finished_kind or "interrupted"
        raise
    except Exception as exc:
        logger.exception("replace job failed")
        finished_kind = "error"
        error_message = str(exc) or "任务失败"
    finally:
        stop.set()
        if pump_task:
            pump_task.cancel()
        for task in worker_tasks:
            task.cancel()
        await asyncio.gather(*([pump_task] if pump_task else []), *worker_tasks, return_exceptions=True)
        if finished_kind == "cancelled":
            save_job("cancelled", f"已取消，处理到 {processed}/{found_total}")
        elif finished_kind == "error":
            if error_message:
                db.add_nosub_replace_item(job_id, status="error", message=error_message)
            save_job("error", error_message or "任务失败")
        elif finished_kind == "done":
            if found_total == 0 and processed == 0:
                save_job("done", "没有找到无字幕文件")
            else:
                save_job("done", "")
        else:
            save_job("interrupted", f"任务中断，已处理 {processed}/{found_total}")

    if finished_kind == "cancelled":
        yield {"type": "cancelled", "job_id": job_id, "index": processed, "total": found_total}
        return
    if finished_kind == "error":
        yield {"type": "error", "message": error_message or "任务失败", "job_id": job_id}
        return
    if finished_kind == "interrupted":
        yield {"type": "cancelled", "job_id": job_id, "index": processed, "total": found_total}
        return
    yield {"type": "done", "job_id": job_id, "job": db.get_nosub_replace_job(job_id, user["id"])}
