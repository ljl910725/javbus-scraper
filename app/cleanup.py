from __future__ import annotations

import os
import re
import time
from collections import defaultdict
from pathlib import Path

from app.duplicates import VIDEO_EXTENSIONS
from app.subtitles.storage import (
    _path_within_roots,
    get_browse_roots,
    resolve_directory,
    resolve_file,
)

_MAX_SCAN_FILES = 80000
_SAMPLE_FILES = 200
_SAMPLE_DIRS = 50
SMALL_VIDEO_MAX_BYTES = 100 * 1024 * 1024
JUNK_HTML_EXTS = {".html", ".htm"}
JUNK_TXT_EXTS = {".txt"}
_EXTRA_SPLIT = re.compile(r"[\s,;，；]+")
_INVALID_EXT_CHARS = set('\\/\0*?<>:|"')


def normalize_extra_exts(raw: str) -> list[str]:
    items: list[str] = []
    seen: set[str] = set()
    for token in _EXTRA_SPLIT.split(raw or ""):
        token = token.strip().lower()
        if not token:
            continue
        if token.startswith("*."):
            token = token[1:]
        if not token.startswith("."):
            token = f".{token}"
        if token == ".":
            raise ValueError("后缀不能为空")
        if any(ch in _INVALID_EXT_CHARS for ch in token) or ".." in token:
            raise ValueError(f"非法后缀: {token}")
        if len(token) > 24:
            raise ValueError(f"后缀过长: {token}")
        if token in seen:
            continue
        seen.add(token)
        items.append(token)
        if len(items) > 50:
            raise ValueError("额外后缀最多 50 个")
    return items


def _matches_extra_ext(name: str, extra_exts: set[str]) -> bool:
    lower_name = name.lower()
    suffix = Path(name).suffix.lower()
    for ext in extra_exts:
        if ext.count(".") > 1:
            if lower_name.endswith(ext):
                return True
        elif suffix == ext:
            return True
    return False


def classify_junk(name: str, size: int, extra_exts: set[str]) -> str | None:
    suffix = Path(name).suffix.lower()
    if extra_exts and _matches_extra_ext(name, extra_exts):
        return "extra"
    if suffix in JUNK_HTML_EXTS:
        return "html"
    if suffix in JUNK_TXT_EXTS:
        return "txt"
    if suffix in VIDEO_EXTENSIONS and size < SMALL_VIDEO_MAX_BYTES:
        return "small_video"
    return None


def _empty_counts() -> dict[str, int]:
    return {"html": 0, "txt": 0, "small_video": 0, "extra": 0}


def _file_payload(path: Path, reason: str, size: int) -> dict:
    return {
        "name": path.name,
        "path": str(path),
        "parent_dir": str(path.parent),
        "size": str(size),
        "reason": reason,
    }


def _resolve_selected(folders: list[str]) -> list[Path]:
    if not folders:
        raise ValueError("请至少选择一个文件夹")
    selected: list[Path] = []
    seen: set[str] = set()
    for folder in folders:
        resolved = resolve_directory(folder)
        key = str(resolved)
        if key in seen:
            continue
        seen.add(key)
        selected.append(resolved)
    return selected


def _is_skipped_entry(path: Path) -> bool:
    try:
        return path.is_symlink()
    except OSError:
        return True


def _estimate_empty_dirs(
    visited_dirs: list[str],
    files_kept: dict[str, int],
    children: dict[str, list[str]],
    protected: set[str],
) -> list[str]:
    empty: list[str] = []
    empty_set: set[str] = set()
    for directory in sorted(visited_dirs, key=lambda item: item.count(os.sep), reverse=True):
        if directory in protected:
            continue
        if files_kept.get(directory, 0) > 0:
            continue
        leftover_children = [child for child in children.get(directory, []) if child not in empty_set]
        if leftover_children:
            continue
        empty.append(directory)
        empty_set.add(directory)
    return empty


def _collect_junk(folders: list[str], extra_raw: str, *, stop=None):
    extra_exts = set(normalize_extra_exts(extra_raw))
    selected = _resolve_selected(folders)
    protected = {str(path) for path in selected}
    junk: list[dict] = []
    visited_dirs: list[str] = []
    files_kept: dict[str, int] = defaultdict(int)
    children: dict[str, list[str]] = defaultdict(list)
    counts = _empty_counts()
    bytes_total = 0
    scanned = 0
    dirs = 0
    truncated = False
    last_emit = 0.0
    current_dir = ""
    folder_index = 0

    def snapshot(*, phase: str, force: bool = False) -> dict | None:
        nonlocal last_emit
        now = time.monotonic()
        if not force and now - last_emit < 0.3:
            return None
        last_emit = now
        percent = None
        if selected:
            percent = min(99, int(((folder_index + (0 if phase == "scanning" else 1)) / len(selected)) * 100))
        return {
            "type": "progress",
            "phase": phase,
            "scanned": scanned,
            "matched": len(junk),
            "dirs": dirs,
            "folder_index": folder_index,
            "folder_total": len(selected),
            "current_dir": current_dir,
            "bytes": bytes_total,
            "counts": dict(counts),
            "percent": percent,
            "truncated": truncated,
        }

    yield {
        "type": "progress",
        "phase": "starting",
        "scanned": 0,
        "matched": 0,
        "dirs": 0,
        "folder_index": 0,
        "folder_total": len(selected),
        "current_dir": str(selected[0]) if selected else "",
        "bytes": 0,
        "counts": _empty_counts(),
        "percent": 0,
        "truncated": False,
    }

    for folder_index, root in enumerate(selected):
        if stop is not None and stop.is_set():
            yield {"type": "cancelled"}
            return
        current_dir = str(root)
        event = snapshot(phase="scanning", force=True)
        if event:
            yield event
        for dirpath, dirnames, filenames in os.walk(
            root, topdown=True, followlinks=False, onerror=lambda _exc: None
        ):
            if stop is not None and stop.is_set():
                yield {"type": "cancelled"}
                return
            current = Path(dirpath)
            kept_dirnames: list[str] = []
            for name in dirnames:
                child = current / name
                if name.startswith(".") or _is_skipped_entry(child):
                    files_kept[dirpath] += 1
                    continue
                kept_dirnames.append(name)
                children[dirpath].append(str(child))
            dirnames[:] = kept_dirnames
            dirnames.sort()
            visited_dirs.append(dirpath)
            dirs += 1
            current_dir = dirpath
            event = snapshot(phase="scanning")
            if event:
                yield event
            for name in filenames:
                entry = current / name
                if name.startswith(".") or _is_skipped_entry(entry) or not entry.is_file():
                    files_kept[dirpath] += 1
                    continue
                scanned += 1
                if scanned > _MAX_SCAN_FILES:
                    truncated = True
                    break
                try:
                    size = entry.stat().st_size
                except OSError:
                    files_kept[dirpath] += 1
                    continue
                reason = classify_junk(name, size, extra_exts)
                if not reason:
                    files_kept[dirpath] += 1
                    continue
                counts[reason] += 1
                bytes_total += size
                junk.append(_file_payload(entry, reason, size))
            if truncated:
                break
        if truncated:
            break

    if stop is not None and stop.is_set():
        yield {"type": "cancelled"}
        return

    empty_dirs = _estimate_empty_dirs(visited_dirs, files_kept, children, protected)
    yield {
        "collected": True,
        "selected": selected,
        "protected": protected,
        "visited_dirs": visited_dirs,
        "junk": junk,
        "empty_dirs": empty_dirs,
        "counts": counts,
        "bytes": bytes_total,
        "scanned": scanned,
        "dirs": dirs,
        "truncated": truncated,
        "extra_exts": sorted(extra_exts),
        "snapshot": snapshot(phase="summarizing", force=True),
    }


def iter_scan_cleanup(folders: list[str], extra_exts: str = "", *, stop=None):
    collected = None
    for event in _collect_junk(folders, extra_exts, stop=stop):
        if event.get("type") in {"progress", "cancelled"}:
            yield event
            if event.get("type") == "cancelled":
                return
            continue
        if event.get("collected"):
            collected = event
    if collected is None:
        raise ValueError("扫描未完成")
    if collected.get("snapshot"):
        yield collected["snapshot"]
    junk = collected["junk"]
    empty_dirs = collected["empty_dirs"]
    yield {
        "type": "done",
        "result": {
            "files": junk[:_SAMPLE_FILES],
            "empty_dirs": [
                {"name": Path(path).name or path, "path": path} for path in empty_dirs[:_SAMPLE_DIRS]
            ],
            "scanned": collected["scanned"],
            "dirs": collected["dirs"],
            "matched": len(junk),
            "empty_dir_count": len(empty_dirs),
            "bytes": collected["bytes"],
            "counts": collected["counts"],
            "truncated": collected["truncated"],
            "extra_exts": collected["extra_exts"],
            "sample_truncated": len(junk) > _SAMPLE_FILES or len(empty_dirs) > _SAMPLE_DIRS,
        },
    }


def _safe_unlink(path: Path) -> None:
    if path.is_symlink():
        raise ValueError("跳过符号链接")
    target = resolve_file(str(path))
    if target.is_symlink():
        raise ValueError("跳过符号链接")
    target.unlink()


def _safe_rmdir(path: Path, protected: set[str], roots: list[Path]) -> bool:
    try:
        resolved = path.resolve()
    except OSError:
        return False
    if str(resolved) in protected:
        return False
    if not _path_within_roots(resolved, roots):
        return False
    if resolved.is_symlink() or not resolved.is_dir():
        return False
    try:
        next(resolved.iterdir())
        return False
    except StopIteration:
        pass
    except OSError:
        return False
    try:
        resolved.rmdir()
        return True
    except OSError:
        return False


def iter_run_cleanup(folders: list[str], extra_exts: str = "", *, stop=None):
    collected = None
    for event in _collect_junk(folders, extra_exts, stop=stop):
        if event.get("type") in {"progress", "cancelled"}:
            yield event
            if event.get("type") == "cancelled":
                return
            continue
        if event.get("collected"):
            collected = event
    if collected is None:
        raise ValueError("扫描未完成")

    junk = collected["junk"]
    protected = collected["protected"]
    visited_dirs = collected["visited_dirs"]
    roots = get_browse_roots()
    deleted_files = 0
    deleted_bytes = 0
    deleted_dirs = 0
    failed: list[dict] = []
    last_emit = 0.0
    current_path = ""

    def delete_snapshot(*, phase: str, force: bool = False, percent: int | None = None) -> dict | None:
        nonlocal last_emit
        now = time.monotonic()
        if not force and now - last_emit < 0.3:
            return None
        last_emit = now
        return {
            "type": "progress",
            "phase": phase,
            "scanned": collected["scanned"],
            "matched": len(junk),
            "deleted_files": deleted_files,
            "deleted_dirs": deleted_dirs,
            "failed": len(failed),
            "dirs": collected["dirs"],
            "folder_index": max(len(collected["selected"]) - 1, 0),
            "folder_total": len(collected["selected"]),
            "current_dir": current_path,
            "bytes": deleted_bytes,
            "counts": collected["counts"],
            "percent": percent,
            "truncated": collected["truncated"],
        }

    total = max(len(junk), 1)
    for index, item in enumerate(junk):
        if stop is not None and stop.is_set():
            yield {"type": "cancelled"}
            return
        current_path = item["path"]
        event = delete_snapshot(phase="deleting", percent=min(99, int((index / total) * 90)))
        if event:
            yield event
        try:
            path = Path(item["path"])
            _safe_unlink(path)
            deleted_files += 1
            deleted_bytes += int(item.get("size") or 0)
        except (ValueError, OSError, TypeError) as exc:
            failed.append({"path": item["path"], "message": str(exc)})

    dir_total = max(len(visited_dirs), 1)
    for index, directory in enumerate(sorted(visited_dirs, key=lambda item: item.count(os.sep), reverse=True)):
        if stop is not None and stop.is_set():
            yield {"type": "cancelled"}
            return
        current_path = directory
        event = delete_snapshot(
            phase="pruning",
            percent=min(99, 90 + int((index / dir_total) * 9)),
        )
        if event:
            yield event
        if _safe_rmdir(Path(directory), protected, roots):
            deleted_dirs += 1

    yield delete_snapshot(phase="summarizing", force=True, percent=99) or {
        "type": "progress",
        "phase": "summarizing",
        "scanned": collected["scanned"],
        "matched": len(junk),
        "deleted_files": deleted_files,
        "deleted_dirs": deleted_dirs,
        "failed": len(failed),
        "dirs": collected["dirs"],
        "folder_index": max(len(collected["selected"]) - 1, 0),
        "folder_total": len(collected["selected"]),
        "current_dir": current_path,
        "bytes": deleted_bytes,
        "counts": collected["counts"],
        "percent": 99,
        "truncated": collected["truncated"],
    }
    yield {
        "type": "done",
        "result": {
            "scanned": collected["scanned"],
            "dirs": collected["dirs"],
            "matched": len(junk),
            "deleted_files": deleted_files,
            "deleted_dirs": deleted_dirs,
            "bytes": deleted_bytes,
            "counts": collected["counts"],
            "failed": failed[:50],
            "failed_count": len(failed),
            "truncated": collected["truncated"],
            "extra_exts": collected["extra_exts"],
        },
    }
