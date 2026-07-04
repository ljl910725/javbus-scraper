from __future__ import annotations

import re
from pathlib import Path

from app.config import settings

_INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


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
        return {
            "current_path": "",
            "parent_path": None,
            "folders": [
                {"name": root.name or str(root), "path": str(root)}
                for root in roots
            ],
            "selectable": False,
        }

    current = resolve_directory(value)
    folders: list[dict[str, str]] = []
    try:
        for entry in sorted(current.iterdir(), key=lambda item: item.name.lower()):
            if not entry.is_dir():
                continue
            if entry.name.startswith("."):
                continue
            folders.append({"name": entry.name, "path": str(entry.resolve())})
    except PermissionError as exc:
        raise ValueError("没有权限读取该目录") from exc

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
