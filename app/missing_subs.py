from __future__ import annotations

import os
import time
from pathlib import Path
from xml.etree import ElementTree

from app.duplicates import VIDEO_EXTENSIONS, extract_jav_code, extract_part_tag, has_c_subtitle
from app.subtitles.storage import resolve_directory

_MAX_SCAN_FILES = 80000
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
_NFO_TEXT_TAGS = {
    "title": ("title", "originaltitle", "sorttitle"),
    "plot": ("plot", "outline", "tagline"),
    "date": ("premiered", "releasedate", "year"),
    "studio": ("studio", "maker", "publisher"),
    "num": ("num", "id", "uniqueid"),
}


def _text(node) -> str:
    if node is None or node.text is None:
        return ""
    return " ".join(node.text.split())


def parse_nfo(path: Path) -> dict:
    info = {"title": "", "plot": "", "date": "", "studio": "", "actors": [], "num": ""}
    try:
        raw = path.read_bytes()
    except OSError:
        return info
    xml_text = None
    for encoding in ("utf-8", "utf-8-sig", "gb18030", "cp936"):
        try:
            xml_text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if xml_text is None:
        xml_text = raw.decode("utf-8", "ignore")
    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError:
        return info

    def first(*tags: str) -> str:
        for tag in tags:
            value = _text(root.find(tag))
            if value:
                return value
            value = _text(root.find(f".//{tag}"))
            if value:
                return value
        return ""

    info["title"] = first(*_NFO_TEXT_TAGS["title"])
    info["plot"] = first(*_NFO_TEXT_TAGS["plot"])
    info["date"] = first(*_NFO_TEXT_TAGS["date"])
    info["studio"] = first(*_NFO_TEXT_TAGS["studio"])
    info["num"] = first(*_NFO_TEXT_TAGS["num"])
    actors: list[str] = []
    for actor in root.findall(".//actor"):
        name = _text(actor.find("name")) or _text(actor)
        if name and name not in actors:
            actors.append(name)
    info["actors"] = actors[:8]
    return info


def _pick_nfo(dirpath: str, names: list[str], stem: str) -> str:
    lower_map = {name.lower(): name for name in names}
    for candidate in (f"{stem}.nfo", "movie.nfo", "tvshow.nfo"):
        real = lower_map.get(candidate.lower())
        if real:
            return str(Path(dirpath) / real)
    for name in names:
        if name.lower().endswith(".nfo"):
            return str(Path(dirpath) / name)
    return ""


def _pick_images(dirpath: str, names: list[str], stem: str) -> list[str]:
    lower_map = {name.lower(): name for name in names}
    wanted = [
        f"{stem}.jpg",
        f"{stem}.jpeg",
        f"{stem}.png",
        f"{stem}.webp",
        f"{stem}-poster.jpg",
        f"{stem}-poster.png",
        f"{stem}-fanart.jpg",
        f"{stem}-thumb.jpg",
        "poster.jpg",
        "poster.png",
        "folder.jpg",
        "folder.png",
        "fanart.jpg",
        "cover.jpg",
        "backdrop.jpg",
    ]
    images: list[str] = []
    seen: set[str] = set()
    for candidate in wanted:
        real = lower_map.get(candidate.lower())
        if not real:
            continue
        path = str(Path(dirpath) / real)
        if path in seen:
            continue
        seen.add(path)
        images.append(path)
        if len(images) >= 4:
            return images
    for name in names:
        suffix = Path(name).suffix.lower()
        if suffix not in IMAGE_EXTS:
            continue
        path = str(Path(dirpath) / name)
        if path in seen:
            continue
        seen.add(path)
        images.append(path)
        if len(images) >= 4:
            break
    return images


def _list_dir_names(dirpath: str, cache: dict[str, list[str]]) -> list[str]:
    if dirpath in cache:
        return cache[dirpath]
    try:
        names = [name for name in os.listdir(dirpath) if not name.startswith(".")]
    except OSError:
        names = []
    cache[dirpath] = names
    return names


def iter_scan_missing_subs(folders: list[str], *, stop=None, limit: int = 10, offset: int = 0):
    if not folders:
        raise ValueError("请至少选择一个文件夹")

    page_size = max(1, min(int(limit or 10), 100))
    skip = max(0, int(offset or 0))

    selected: list[Path] = []
    seen: set[str] = set()
    for folder in folders:
        resolved = resolve_directory(folder)
        key = str(resolved)
        if key in seen:
            continue
        seen.add(key)
        selected.append(resolved)

    dir_cache: dict[str, list[str]] = {}
    items: list[dict] = []
    scanned = 0
    videos = 0
    dirs = 0
    matched = 0
    truncated = False
    has_more = False
    last_emit = 0.0
    current_dir = ""
    folder_index = 0
    page_full = False

    def snapshot(*, phase: str, force: bool = False) -> dict | None:
        nonlocal last_emit
        now = time.monotonic()
        if not force and now - last_emit < 0.3:
            return None
        last_emit = now
        percent = None
        if page_size:
            percent = min(99, int((len(items) / page_size) * 100))
        return {
            "type": "progress",
            "phase": phase,
            "scanned": scanned,
            "videos": videos,
            "dirs": dirs,
            "folder_index": folder_index,
            "folder_total": len(selected),
            "current_dir": current_dir,
            "found": skip + len(items),
            "page_found": len(items),
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
        "found": skip,
        "page_found": 0,
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
            visible = [name for name in filenames if not name.startswith(".")]
            visible.sort()
            dir_cache[dirpath] = visible
            event = snapshot(phase="scanning")
            if event:
                yield event
            for name in visible:
                scanned += 1
                if scanned > _MAX_SCAN_FILES:
                    truncated = True
                    break
                if Path(name).suffix.lower() not in VIDEO_EXTENSIONS:
                    continue
                videos += 1
                if has_c_subtitle(name):
                    continue
                matched += 1
                if matched <= skip:
                    continue
                names = _list_dir_names(dirpath, dir_cache)
                stem = Path(name).stem
                nfo_path = _pick_nfo(dirpath, names, stem)
                nfo = parse_nfo(Path(nfo_path)) if nfo_path else {
                    "title": "", "plot": "", "date": "", "studio": "", "actors": [], "num": "",
                }
                code = extract_jav_code(name) or extract_jav_code(nfo.get("num") or "") or nfo.get("num") or ""
                path = Path(dirpath) / name
                try:
                    stat = path.stat()
                    size = str(stat.st_size)
                    mtime = str(int(stat.st_mtime))
                except OSError:
                    size = "0"
                    mtime = "0"
                items.append(
                    {
                        "code": code,
                        "part": extract_part_tag(name),
                        "name": name,
                        "path": str(path),
                        "parent_dir": dirpath,
                        "size": size,
                        "mtime": mtime,
                        "nfo_path": nfo_path,
                        "title": nfo.get("title") or "",
                        "plot": nfo.get("plot") or "",
                        "date": nfo.get("date") or "",
                        "studio": nfo.get("studio") or "",
                        "actors": nfo.get("actors") or [],
                        "images": _pick_images(dirpath, names, stem),
                    }
                )
                if len(items) >= page_size:
                    has_more = True
                    page_full = True
                    break
            if truncated or page_full:
                break
        if truncated or page_full:
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
        "found": skip + len(items),
        "page_found": len(items),
        "percent": 99,
        "truncated": truncated,
    }
    yield {
        "type": "done",
        "result": {
            "items": items,
            "scanned": scanned,
            "videos": videos,
            "found": len(items),
            "offset": skip,
            "limit": page_size,
            "has_more": has_more or truncated,
            "truncated": truncated,
        },
    }
