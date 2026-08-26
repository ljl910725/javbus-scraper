from __future__ import annotations

import asyncio

from app import db
from app.config import settings
from app.duplicates import delete_video_file
from app.integrations import push as push_service
from app.integrations.cd2 import CD2Error, CD2NotConfiguredError
from app.integrations.p115 import P115Error, P115NotConfiguredError
from app.models import MagnetLink
from app.scraper.service import ScrapeError, scrape_movie
from app.user_settings import merge_settings

_job_lock = asyncio.Lock()


def pick_subtitle_magnet(magnets: list[MagnetLink] | None) -> MagnetLink | None:
    for magnet in magnets or []:
        if magnet.has_subtitle and (magnet.link or "").startswith("magnet:"):
            return magnet
    return None


def _file_exists(path: str) -> bool:
    from pathlib import Path

    try:
        return Path(path).is_file()
    except OSError:
        return False


async def check_ignored_item(item: dict) -> dict:
    item_id = int(item["id"])
    code = (item.get("code") or "").strip()
    path = item.get("path") or ""
    result = {
        "id": item_id,
        "code": code,
        "path": path,
        "status": item.get("status") or "ignored",
        "replaced": False,
        "message": "",
    }

    if result["status"] == "replaced":
        result["replaced"] = True
        result["message"] = "已经替换过"
        return result

    if not code:
        message = "无法识别番号，跳过搜索"
        db.update_ignored_missing_sub(item_id, message=message, mark_checked=True)
        result["message"] = message
        return result

    user = db.get_user_by_id(int(item["user_id"]))
    stored = db.get_user_settings(int(item["user_id"])) if user else {}
    user_cfg = merge_settings(stored)
    backend = push_service.active_backend(user_cfg)
    label = push_service.backend_label(user_cfg)
    if not backend:
        message = "未配置推送方式，无法自动推送"
        db.update_ignored_missing_sub(item_id, message=message, mark_checked=True)
        result["message"] = message
        return result

    try:
        movie = await scrape_movie(code, user_settings=stored)
    except ScrapeError as exc:
        message = str(exc) or "搜索失败"
        db.update_ignored_missing_sub(item_id, message=message, mark_checked=True)
        result["message"] = message
        return result
    except Exception as exc:
        message = f"搜索失败: {exc}"
        db.update_ignored_missing_sub(item_id, message=message, mark_checked=True)
        result["message"] = message
        return result

    magnet = pick_subtitle_magnet(movie.magnets)
    if not magnet:
        message = "暂无字幕版本"
        db.update_ignored_missing_sub(item_id, message=message, mark_checked=True)
        result["message"] = message
        return result

    folder_id = push_service.default_folder_id(user_cfg)
    folder = push_service.folder_meta(user_cfg, folder_id)
    try:
        push_result = await push_service.push_magnet(magnet.link, stored, folder_id)
    except (CD2NotConfiguredError, P115NotConfiguredError, CD2Error, P115Error) as exc:
        message = str(exc)
        db.update_ignored_missing_sub(item_id, message=message, mark_checked=True)
        result["message"] = message
        return result
    except Exception as exc:
        message = f"推送{label}失败: {exc}"
        db.update_ignored_missing_sub(item_id, message=message, mark_checked=True)
        result["message"] = message
        return result

    pushed = bool(push_result.success) or "已存在" in (push_result.message or "")
    if not pushed:
        message = push_result.message or f"推送{label}失败"
        db.update_ignored_missing_sub(
            item_id,
            magnet_link=magnet.link,
            magnet_title=magnet.title,
            message=message,
            mark_checked=True,
        )
        result["message"] = message
        return result

    if user:
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
            message=push_result.message or "自动替换推送成功",
        )

    deleted = True
    delete_error = ""
    if _file_exists(path):
        try:
            delete_video_file(path)
        except Exception as exc:
            deleted = False
            delete_error = str(exc)
    if deleted:
        message = f"已推送{label}并删除原文件"
    else:
        message = f"已推送{label}，但删除原文件失败: {delete_error}"

    updated = db.update_ignored_missing_sub(
        item_id,
        magnet_link=magnet.link,
        magnet_title=magnet.title,
        message=message,
        mark_replaced=True,
    )
    result["status"] = (updated or {}).get("status") or "replaced"
    result["replaced"] = True
    result["message"] = message
    return result


async def check_pending_ignored(*, user_id: int | None = None, item_id: int | None = None) -> list[dict]:
    async with _job_lock:
        if item_id is not None:
            item = db.get_ignored_missing_sub(item_id, user_id)
            if not item:
                raise ValueError("忽略记录不存在")
            return [await check_ignored_item(item)]

        items = db.list_pending_ignored_missing_subs(user_id)
        results: list[dict] = []
        for index, item in enumerate(items):
            results.append(await check_ignored_item(item))
            if index < len(items) - 1:
                await asyncio.sleep(max(1.0, float(settings.request_delay)))
        return results
