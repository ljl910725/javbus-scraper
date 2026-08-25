from __future__ import annotations

import os
import re
from collections import defaultdict
from pathlib import Path

_MAX_SCAN_FILES = 80000
VIDEO_EXTENSIONS = {
    ".mp4", ".mkv", ".avi", ".wmv", ".mov", ".flv", ".webm", ".m4v", ".ts",
    ".mpg", ".mpeg", ".iso", ".rmvb", ".rm", ".vob", ".m2ts", ".asf",
}

_TRAILING_SUFFIX = re.compile(
    r"(?i)(?:[-_.\s]*(?:uncensored|leaked|leak|hdr10|2160p|1080p|720p|"
    r"uc|ch|us|eu|4k|8k|hdr|uhd|fhd|hd|cd\d+|part\d+|disc\d+|c|u))+$"
)

_CODE_RE = re.compile(
    r"(?ix)"
    r"(?:^|[^A-Z0-9])"
    r"("
    r"FC2[-_]?PPV[-_]?\d{5,8}"
    r"|\d{3}[A-Z]{2,8}[-_]?\d{2,6}"
    r"|[A-Z]{1,4}\d{1,3}[-_]\d{2,7}"
    r"|[A-Z]{2,10}[-_]\d{2,7}"
    r"|[A-Z]{2,10}\d{3,7}"
    r")"
    r"(?:$|[^A-Z0-9])"
)


def _strip_video_extension(name: str) -> str:
    lower = name.lower()
    for ext in sorted(VIDEO_EXTENSIONS, key=len, reverse=True):
        if lower.endswith(ext):
            return name[: -len(ext)]
    return name


def _normalize_code(raw: str) -> str:
    value = raw.upper().replace("_", "-")
    value = re.sub(r"-{2,}", "-", value)
    fc2 = re.fullmatch(r"FC2-?PPV-?(\d+)", value)
    if fc2:
        return f"FC2-PPV-{fc2.group(1)}"
    numbered_studio = re.fullmatch(r"(\d{3}[A-Z]{2,8})-?(\d+)", value)
    if numbered_studio:
        return f"{numbered_studio.group(1)}-{numbered_studio.group(2)}"
    letter_num = re.fullmatch(r"([A-Z]{2,10})(\d{3,7})", value)
    if letter_num:
        return f"{letter_num.group(1)}-{letter_num.group(2)}"
    return value


def extract_jav_code(filename: str) -> str | None:
    """Extract a 番号 from a video filename, ignoring -C/-U/-ch and extensions."""
    stem = _strip_video_extension(Path(filename).name)
    stem = _TRAILING_SUFFIX.sub("", stem).strip(" .-_")
    if not stem:
        return None
    blob = f" {stem.upper().replace('.', ' ')} "
    match = _CODE_RE.search(blob)
    if not match:
        return None
    return _normalize_code(match.group(1))


def _file_payload(path: Path, code: str) -> dict:
    try:
        stat = path.stat()
        size = str(stat.st_size)
        mtime = str(int(stat.st_mtime))
    except OSError:
        size = "0"
        mtime = "0"
    return {
        "code": code,
        "name": path.name,
        "path": str(path),
        "parent_dir": str(path.parent),
        "size": size,
        "mtime": mtime,
    }


def scan_duplicate_videos(folders: list[str]) -> dict:
    from app.subtitles.storage import resolve_directory

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

    grouped: dict[str, list[dict]] = defaultdict(list)
    scanned = 0
    videos = 0
    truncated = False

    for root in selected:
        for dirpath, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
            dirnames[:] = [name for name in dirnames if not name.startswith(".")]
            dirnames.sort()
            for name in filenames:
                if name.startswith("."):
                    continue
                scanned += 1
                if scanned > _MAX_SCAN_FILES:
                    truncated = True
                    break
                suffix = Path(name).suffix.lower()
                if suffix not in VIDEO_EXTENSIONS:
                    continue
                videos += 1
                code = extract_jav_code(name)
                if not code:
                    continue
                grouped[code].append(_file_payload(Path(dirpath) / name, code))
            if truncated:
                break
        if truncated:
            break

    groups = []
    for code, files in grouped.items():
        if len(files) < 2:
            continue
        files.sort(key=lambda item: (item["parent_dir"], item["name"]))
        groups.append({"code": code, "count": len(files), "files": files})
    groups.sort(key=lambda item: (-item["count"], item["code"]))

    return {
        "groups": groups,
        "scanned": scanned,
        "videos": videos,
        "duplicate_codes": len(groups),
        "duplicate_files": sum(item["count"] for item in groups),
        "truncated": truncated,
    }


def delete_video_file(path: str) -> dict:
    from app.subtitles.storage import resolve_file

    target = resolve_file(path)
    if target.suffix.lower() not in VIDEO_EXTENSIONS:
        raise ValueError("只能删除视频文件")
    try:
        target.unlink()
    except OSError as exc:
        raise ValueError(f"删除失败: {exc}") from exc
    return {"path": str(target), "deleted": True}
