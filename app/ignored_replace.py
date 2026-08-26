from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app import db
from app.config import settings
from app.duplicates import delete_video_file
from app.integrations import p115
from app.integrations.p115 import P115Error, P115NotConfiguredError
from app.models import MagnetLink
from app.scraper.service import ScrapeError, scrape_movie
from app.user_settings import merge_settings

logger = logging.getLogger(__name__)
try:
    _SHANGHAI = ZoneInfo("Asia/Shanghai")
except Exception:
    _SHANGHAI = timezone(timedelta(hours=8))
_job_lock = asyncio.Lock()


def seconds_until_hour(hour: int) -> float:
    now = datetime.now(_SHANGHAI)
    target_hour = max(0, min(int(hour), 23))
    target = now.replace(hour=target_hour, minute=0, second=0, microsecond=0)
    if now >= target:
        target += timedelta(days=1)
    return max(1.0, (target - now).total_seconds())


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
    if not (user_cfg.get("p115_cookie") or "").strip():
        message = "未配置 115 Cookie，无法自动推送"
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

    try:
        push_result = await p115.push_magnet(magnet.link, stored)
    except (P115NotConfiguredError, P115Error) as exc:
        message = str(exc)
        db.update_ignored_missing_sub(item_id, message=message, mark_checked=True)
        result["message"] = message
        return result
    except Exception as exc:
        message = f"推送115失败: {exc}"
        db.update_ignored_missing_sub(item_id, message=message, mark_checked=True)
        result["message"] = message
        return result

    pushed = bool(push_result.success) or "已存在" in (push_result.message or "")
    if not pushed:
        message = push_result.message or "推送115失败"
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
            backend="p115",
            folder_id=str(user_cfg.get("p115_folder_cid") or ""),
            folder_name="",
            folder_path=str(user_cfg.get("p115_folder_path") or ""),
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
        message = "已推送115并删除原文件"
    else:
        message = f"已推送115，但删除原文件失败: {delete_error}"

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


async def run_daily_replace_job() -> list[dict]:
    logger.info("ignored replace job started")
    results = await check_pending_ignored()
    replaced = sum(1 for item in results if item.get("replaced"))
    logger.info("ignored replace job finished: %s checked, %s replaced", len(results), replaced)
    return results


async def scheduler_loop() -> None:
    hour = getattr(settings, "ignored_replace_hour", 4)
    logger.info("ignored replace scheduler waiting for %02d:00 Asia/Shanghai", hour)
    while True:
        delay = seconds_until_hour(hour)
        await asyncio.sleep(delay)
        try:
            await run_daily_replace_job()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("ignored replace job failed")
