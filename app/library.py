from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from zoneinfo import ZoneInfo

from app import db
from app.duplicates import VIDEO_EXTENSIONS, extract_jav_code
from app.scraper.magnets import is_ed2k_link, is_magnet_link, parse_ed2k_link
from app.subtitles.storage import resolve_directory

_SHANGHAI = ZoneInfo("Asia/Shanghai")


def _library_paths(user_id: int) -> list[str]:
    stored = db.get_user_settings(user_id)
    paths = stored.get("library_paths") or []
    return [str(path) for path in paths if str(path).strip()]


def _save_library_paths(user_id: int, paths: list[str]) -> None:
    stored = db.get_user_settings(user_id)
    stored["library_paths"] = paths
    db.save_user_settings(user_id, stored)


def _video_rows(root: Path):
    # 只收能认出番号的视频，CD1 / CD2 用同一个番号
    for dirpath, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        dirnames[:] = sorted(name for name in dirnames if not name.startswith("."))
        for name in filenames:
            if name.startswith(".") or Path(name).suffix.lower() not in VIDEO_EXTENSIONS:
                continue
            code = extract_jav_code(name)
            if not code:
                continue
            yield code, name, str((Path(dirpath) / name).resolve())


def duplicate_groups(user_id: int, codes: list[str] | None = None) -> list[dict]:
    rows = (
        db.list_local_videos_by_codes(user_id, codes)
        if codes is not None
        else db.list_local_videos(user_id)
    )
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["code"], []).append(
            {"name": row["name"], "path": row["path"], "root": row["root"]}
        )
    groups = []
    for code, files in grouped.items():
        if len(files) < 2:
            continue
        files.sort(key=lambda item: item["path"])
        groups.append({"code": code, "files": files, "links": []})
    groups.sort(key=lambda item: item["code"])
    return groups


def library_overview(user_id: int) -> dict:
    stored = db.get_user_settings(user_id)
    counts: dict[str, int] = {}
    for row in db.list_local_videos(user_id):
        counts[row["root"]] = counts.get(row["root"], 0) + 1
    paths = []
    for path in stored.get("library_paths") or []:
        text = str(path)
        paths.append({"path": text, "count": counts.get(text, 0)})
    return {
        "paths": paths,
        "daily": stored.get("library_daily") or {},
        "duplicates": duplicate_groups(user_id),
    }


def add_library_path(user_id: int, path: str) -> dict:
    resolved = str(resolve_directory(path))
    paths = _library_paths(user_id)
    if resolved not in paths:
        paths.append(resolved)
        _save_library_paths(user_id, paths)
    return library_overview(user_id)


def remove_library_path(user_id: int, path: str) -> dict:
    # 只删配置和这个目录名下的记录，不删磁盘上的视频
    resolved = str(resolve_directory(path))
    paths = [item for item in _library_paths(user_id) if item != resolved]
    _save_library_paths(user_id, paths)
    db.delete_local_videos_for_root(user_id, resolved)
    return library_overview(user_id)


def iter_scan_library(user_id: int, path: str, *, reconcile: bool, stop=None):
    resolved = resolve_directory(path)
    root = str(resolved)
    if root not in _library_paths(user_id):
        raise ValueError("这个目录还没加入本地番号库")

    added = 0
    scanned = 0
    seen_paths: set[str] = set()
    seen_codes: list[str] = []
    yield {
        "type": "progress",
        "scanned": 0,
        "added": 0,
        "current": root,
    }
    for code, name, file_path in _video_rows(resolved):
        if stop is not None and stop.is_set():
            yield {"type": "cancelled"}
            return
        scanned += 1
        seen_paths.add(file_path)
        seen_codes.append(code)
        if db.upsert_local_video(user_id, code=code, name=name, path=file_path, root=root):
            added += 1
        if scanned % 200 == 0:
            yield {"type": "progress", "scanned": scanned, "added": added, "current": file_path}

    removed = db.delete_local_videos_missing(user_id, root, seen_paths) if reconcile else 0
    yield {
        "type": "done",
        "result": {
            "path": root,
            "scanned": scanned,
            "added": added,
            "removed": removed,
            "duplicates": duplicate_groups(user_id, seen_codes),
        },
    }


def scan_library(user_id: int, path: str, *, reconcile: bool) -> dict:
    result = None
    for event in iter_scan_library(user_id, path, reconcile=reconcile):
        if event.get("type") == "done":
            result = event["result"]
    if result is None:
        raise ValueError("扫描未完成")
    return result


def code_from_link(link: str) -> str:
    text = (link or "").strip()
    if is_ed2k_link(text):
        parsed = parse_ed2k_link(text)
        return extract_jav_code(parsed["name"]) if parsed else ""
    if is_magnet_link(text):
        name = unquote(parse_qs(urlsplit(text).query).get("dn", [""])[0])
        return extract_jav_code(name) or extract_jav_code(text)
    return extract_jav_code(text)


def lookup_library(user_id: int, codes: list[str], links: list[str]) -> list[dict]:
    # 链接在这里提取番号；提不出来的不拦截推送
    link_codes: dict[str, list[str]] = {}
    wanted: list[str] = []
    for code in codes:
        found = extract_jav_code(code) or (code or "").strip().upper()
        if found:
            wanted.append(found)
    for link in links:
        found = code_from_link(link)
        if not found:
            continue
        wanted.append(found)
        link_codes.setdefault(found, []).append(link)
    rows = db.list_local_videos_by_codes(user_id, wanted)
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["code"], []).append(
            {"name": row["name"], "path": row["path"], "root": row["root"]}
        )
    result = []
    for code, files in grouped.items():
        files.sort(key=lambda item: item["path"])
        result.append({"code": code, "files": files, "links": link_codes.get(code, [])})
    result.sort(key=lambda item: item["code"])
    return result


def run_due_daily_scans() -> None:
    today = datetime.now(_SHANGHAI).date().isoformat()
    for user_id in db.list_user_ids():
        stored = db.get_user_settings(user_id)
        paths = [str(path) for path in (stored.get("library_paths") or []) if str(path).strip()]
        if not paths:
            continue
        daily = stored.get("library_daily") or {}
        if str(daily.get("at") or "").startswith(today):
            continue
        added = 0
        removed = 0
        for path in paths:
            try:
                result = scan_library(user_id, path, reconcile=True)
            except Exception:
                continue
            added += int(result.get("added") or 0)
            removed += int(result.get("removed") or 0)
        stored = db.get_user_settings(user_id)
        stored["library_daily"] = {
            "at": datetime.now(_SHANGHAI).isoformat(timespec="seconds"),
            "added": added,
            "removed": removed,
        }
        db.save_user_settings(user_id, stored)
