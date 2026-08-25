from __future__ import annotations

import os
import re
import time
from collections import defaultdict
from pathlib import Path

_MAX_SCAN_FILES = 80000
VIDEO_EXTENSIONS = {
    ".mp4", ".mkv", ".avi", ".wmv", ".mov", ".flv", ".webm", ".m4v", ".ts",
    ".mpg", ".mpeg", ".iso", ".rmvb", ".rm", ".vob", ".m2ts", ".asf",
}

_TRAILING_SUFFIX = re.compile(
    r"(?i)(?:[-_.\s]*(?:uncensored|leaked|leak|hdr10|2160p|1080p|720p|"
    r"uc|ch|us|eu|4k|8k|hdr|uhd|fhd|hd|c|u))+$"
)
_C_SUBTITLE_RE = re.compile(r"(?i)(?:^|[-_.\s])C(?:[-_.\s]|$)")
_PART_RE = re.compile(r"(?i)(?:^|[-_.\s])((?:cd|part|disc|dvd)[-_]?\d+)(?=$|[-_.\s])")

_CODE_RE = re.compile(
    r"(?ix)"
    r"(?:^|[^A-Z0-9])"
    r"("
    r"FC2[-_]?PPV[-_]?\d{5,8}"
    r"|\d{3}[A-Z]{2,8}[-_]?\d{2,6}"
    r"|[A-Z]{1,4}\d{1,3}[-_]\d{2,7}"
    r"|1?[A-Z]{2,10}[-_]\d{2,7}"
    r"|1?[A-Z]{2,10}\d{3,7}"
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
    fanza_prefix = re.fullmatch(r"1([A-Z]{2,10}-\d{2,7})", value)
    if fanza_prefix:
        value = fanza_prefix.group(1)
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


def has_c_subtitle(filename: str) -> bool:
    """True when the name has a standalone -C token, not -CD1/-CH/-UC."""
    stem = _strip_video_extension(Path(filename).name)
    return bool(_C_SUBTITLE_RE.search(stem.replace(".", " ")))


def extract_part_tag(filename: str) -> str:
    stem = _TRAILING_SUFFIX.sub("", _strip_video_extension(Path(filename).name)).strip(" .-_")
    blob = f" {stem.replace('.', ' ')} "
    found = _PART_RE.findall(blob)
    if not found:
        return ""
    raw = re.sub(r"[-_]", "", found[-1].upper())
    match = re.fullmatch(r"(CD|PART|DISC|DVD)(\d+)", raw)
    if not match:
        return raw
    return f"{match.group(1)}{match.group(2)}"


def duplicate_key(filename: str) -> str | None:
    code = extract_jav_code(filename)
    if not code:
        return None
    part = extract_part_tag(filename)
    return f"{code}#{part}" if part else code


def split_duplicate_key(key: str) -> tuple[str, str]:
    code, sep, part = key.partition("#")
    return (code, part) if sep else (key, "")


def _file_payload(dirpath: str, name: str, code: str, part: str = "") -> dict:
    path = Path(dirpath) / name
    try:
        stat = path.stat()
        size = str(stat.st_size)
        mtime = str(int(stat.st_mtime))
    except OSError:
        size = "0"
        mtime = "0"
    return {
        "code": code,
        "part": part,
        "name": name,
        "path": str(path),
        "parent_dir": dirpath,
        "size": size,
        "mtime": mtime,
    }


def _build_groups(grouped: dict[str, list[tuple[str, str]]]) -> list[dict]:
    groups = []
    for key, items in grouped.items():
        if len(items) < 2:
            continue
        code, part = split_duplicate_key(key)
        files = [_file_payload(dirpath, name, code, part) for dirpath, name in items]
        files.sort(key=lambda item: (item["parent_dir"].lower(), item["name"].lower()))
        groups.append({"code": code, "part": part, "count": len(files), "files": files})
    groups.sort(key=lambda item: (-item["count"], item["code"], item["part"]))
    return groups


def _duplicate_stats(grouped: dict[str, list[tuple[str, str]]]) -> tuple[int, int]:
    codes = 0
    files = 0
    for items in grouped.values():
        if len(items) < 2:
            continue
        codes += 1
        files += len(items)
    return codes, files


def iter_scan_duplicate_videos(folders: list[str], *, stop=None):
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

    grouped: dict[str, list[tuple[str, str]]] = defaultdict(list)
    scanned = 0
    videos = 0
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
        dup_codes, dup_files = _duplicate_stats(grouped)
        percent = None
        if selected:
            percent = min(99, int(((folder_index + (0 if phase == "scanning" else 1)) / len(selected)) * 100))
        return {
            "type": "progress",
            "phase": phase,
            "scanned": scanned,
            "videos": videos,
            "dirs": dirs,
            "folder_index": folder_index,
            "folder_total": len(selected),
            "current_dir": current_dir,
            "duplicate_codes": dup_codes,
            "duplicate_files": dup_files,
            "percent": percent,
            "truncated": truncated,
        }

    yield {
        "type": "progress",
        "phase": "starting",
        "scanned": 0,
        "videos": 0,
        "dirs": 0,
        "folder_index": 0,
        "folder_total": len(selected),
        "current_dir": str(selected[0]) if selected else "",
        "duplicate_codes": 0,
        "duplicate_files": 0,
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
            dirnames[:] = [name for name in dirnames if not name.startswith(".")]
            dirnames.sort()
            dirs += 1
            current_dir = dirpath
            event = snapshot(phase="scanning")
            if event:
                yield event
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
                key = duplicate_key(name)
                if not key:
                    continue
                grouped[key].append((dirpath, name))
            if truncated:
                break
        if truncated:
            break

    if stop is not None and stop.is_set():
        yield {"type": "cancelled"}
        return

    yield snapshot(phase="summarizing", force=True) or {
        "type": "progress",
        "phase": "summarizing",
        "scanned": scanned,
        "videos": videos,
        "dirs": dirs,
        "folder_index": max(folder_index, 0),
        "folder_total": len(selected),
        "current_dir": current_dir,
        "duplicate_codes": _duplicate_stats(grouped)[0],
        "duplicate_files": _duplicate_stats(grouped)[1],
        "percent": 99,
        "truncated": truncated,
    }
    groups = _build_groups(grouped)
    yield {
        "type": "done",
        "result": {
            "groups": groups,
            "scanned": scanned,
            "videos": videos,
            "duplicate_codes": len(groups),
            "duplicate_files": sum(item["count"] for item in groups),
            "truncated": truncated,
        },
    }


def scan_duplicate_videos(folders: list[str]) -> dict:
    result = None
    for event in iter_scan_duplicate_videos(folders):
        if event.get("type") == "done":
            result = event["result"]
    if result is None:
        raise ValueError("扫描未完成")
    return result


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
