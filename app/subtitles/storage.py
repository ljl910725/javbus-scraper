from __future__ import annotations

import os
import re
from pathlib import Path

from app.config import settings

_INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_VIDEO_EXTENSIONS = {
    ".mp4", ".mkv", ".avi", ".wmv", ".mov", ".flv", ".webm", ".m4v", ".ts", ".mpg", ".mpeg",
}
_MAX_SEARCH_RESULTS = 50
_MAX_SCAN_ENTRIES = 8000


def _safe_mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def _file_info(entry: Path) -> dict[str, str | bool]:
    suffix = entry.suffix.lower()
    try:
        stat = entry.stat()
        size = str(stat.st_size)
        mtime = str(int(stat.st_mtime))
    except OSError:
        size = "0"
        mtime = "0"
    return {
        "name": entry.name,
        "path": str(entry.resolve()),
        "parent_dir": str(entry.parent.resolve()),
        "is_video": suffix in _VIDEO_EXTENSIONS,
        "size": size,
        "mtime": mtime,
    }


def _resolve_root(raw: str) -> Path | None:
    value = (raw or "").strip()
    if not value:
        return None
    path = Path(value)
    if not path.is_absolute():
        path = Path(__file__).resolve().parent.parent.parent / path
    try:
        resolved = path.resolve()
    except OSError:
        return None
    if not resolved.exists() or not resolved.is_dir():
        return None
    return resolved


def get_browse_roots() -> list[Path]:
    roots: list[Path] = []
    seen: set[str] = set()
    for raw in settings.subtitle_browse_roots.split(","):
        resolved = _resolve_root(raw)
        if not resolved:
            continue
        key = str(resolved)
        if key in seen:
            continue
        seen.add(key)
        roots.append(resolved)
    if roots:
        return roots
    fallback = _resolve_root("downloads")
    return [fallback] if fallback else []


def _path_within_roots(path: Path, roots: list[Path]) -> bool:
    for root in roots:
        try:
            path.relative_to(root)
            return True
        except ValueError:
            continue
    return False


def resolve_directory(path: str | None) -> Path:
    roots = get_browse_roots()
    if not roots:
        raise ValueError("未配置可浏览的字幕保存目录，请在环境变量 SUBTITLE_BROWSE_ROOTS 中设置")

    value = (path or "").strip()
    if not value:
        return roots[0]

    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = Path(__file__).resolve().parent.parent.parent / candidate
    resolved = candidate.resolve()
    if not resolved.exists() or not resolved.is_dir():
        raise ValueError("目录不存在或不可访问")
    if not _path_within_roots(resolved, roots):
        raise ValueError("只能访问已挂载的字幕保存目录")
    return resolved


def sanitize_filename(filename: str, *, fallback: str = "subtitle.srt") -> str:
    name = (filename or "").strip()
    if not name:
        name = fallback
    name = _INVALID_FILENAME.sub("_", name)
    name = name.replace("..", "_").strip().strip(".")
    if not name:
        name = fallback
    if not name.lower().endswith(".srt"):
        name = f"{name}.srt"
    return name


def list_directory(path: str | None = None) -> dict:
    roots = get_browse_roots()
    if not roots:
        raise ValueError("未配置可浏览的字幕保存目录")

    value = (path or "").strip()
    if not value:
        root_folders = [
            {"name": root.name or str(root), "path": str(root)}
            for root in sorted(roots, key=_safe_mtime, reverse=True)
        ]
        return {
            "current_path": "",
            "parent_path": None,
            "folders": root_folders,
            "files": [],
            "selectable": False,
        }

    current = resolve_directory(value)
    folder_entries: list[Path] = []
    file_entries: list[Path] = []
    try:
        for entry in current.iterdir():
            if entry.name.startswith("."):
                continue
            if entry.is_dir():
                folder_entries.append(entry)
            elif entry.is_file():
                file_entries.append(entry)
    except PermissionError as exc:
        raise ValueError("没有权限读取该目录") from exc

    folder_entries.sort(key=_safe_mtime, reverse=True)
    file_entries.sort(key=_safe_mtime, reverse=True)
    folders = [{"name": entry.name, "path": str(entry.resolve())} for entry in folder_entries]
    files = [_file_info(entry) for entry in file_entries]

    parent_path: str | None = None
    parent = current.parent
    if parent != current and _path_within_roots(parent, roots):
        parent_path = str(parent.resolve())
    elif current not in roots:
        for root in roots:
            if current == root:
                break
        else:
            parent_path = ""

    return {
        "current_path": str(current),
        "parent_path": parent_path,
        "folders": folders,
        "files": files,
        "selectable": True,
    }


def save_subtitle_to_disk(*, target_dir: str, filename: str, content: bytes) -> dict:
    if not content:
        raise ValueError("字幕内容为空")

    directory = resolve_directory(target_dir)
    safe_name = sanitize_filename(filename)
    target = (directory / safe_name).resolve()

    if not _path_within_roots(target.parent, get_browse_roots()):
        raise ValueError("保存路径不在允许范围内")
    if target.exists() and target.is_dir():
        raise ValueError("目标路径是目录，无法写入文件")

    try:
        target.write_bytes(content)
    except OSError as exc:
        raise ValueError(f"写入失败: {exc}") from exc

    return {
        "path": str(target),
        "filename": safe_name,
        "size": len(content),
    }


def search_files(query: str, *, limit: int = _MAX_SEARCH_RESULTS) -> dict:
    keyword = (query or "").strip().lower()
    if len(keyword) < 2:
        raise ValueError("搜索关键词至少 2 个字符")

    roots = get_browse_roots()
    if not roots:
        raise ValueError("未配置可浏览的字幕保存目录")

    max_results = max(1, min(limit, _MAX_SEARCH_RESULTS))
    results: list[dict[str, str | bool]] = []
    scanned = 0
    truncated = False

    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
            dirnames[:] = [name for name in dirnames if not name.startswith(".")]
            for name in filenames:
                if name.startswith("."):
                    continue
                scanned += 1
                if scanned > _MAX_SCAN_ENTRIES:
                    truncated = True
                    break
                if keyword not in name.lower():
                    continue
                entry = Path(dirpath) / name
                if not entry.is_file():
                    continue
                results.append(_file_info(entry))
            if truncated or len(results) >= max_results:
                break
        if truncated or len(results) >= max_results:
            break

    results.sort(key=lambda item: int(str(item.get("mtime", "0"))), reverse=True)
    if len(results) > max_results:
        results = results[:max_results]
        truncated = True

    return {
        "query": query.strip(),
        "results": results,
        "truncated": truncated,
        "scanned": scanned,
    }
