import asyncio
import re

import httpx

from app.config import settings
from app.models import MagnetLink
from app.scraper.magnets import format_size_mb, sort_magnets

_UHD_RE = re.compile(r"4k|uhd|超清", re.IGNORECASE)
_SUB_RE = re.compile(
    r"字幕|中字|中文|chs|cht|zh-?cn|chinese|自提征用|(?:^|[-_\s])c(?:$|[-_\s])",
    re.IGNORECASE,
)


def _flag_true(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    text = str(value or "").strip().lower()
    return text in {"1", "true", "yes", "y", "cn", "chinese", "zh", "中文"}


def title_has_subtitle(title: str) -> bool:
    return bool(_SUB_RE.search(title or ""))


def _item_to_magnet(item: dict) -> MagnetLink | None:
    link = str(item.get("download_url") or "").strip()
    if not link.startswith("magnet:"):
        return None

    title = str(item.get("title") or "").strip() or link
    is_uhd = _flag_true(item.get("uhd")) or bool(_UHD_RE.search(title))
    has_subtitle = (
        _flag_true(item.get("chinese"))
        or _flag_true(item.get("subtitle"))
        or _flag_true(item.get("has_subtitle"))
        or title_has_subtitle(title)
    )
    return MagnetLink(
        title=title,
        link=link,
        size=format_size_mb(item.get("size_mb")),
        is_hd=True,
        is_uhd=is_uhd,
        has_subtitle=has_subtitle,
        site=str(item.get("site") or "").strip(),
    )


async def fetch_article_torrents(keyword: str) -> list[MagnetLink]:
    url = (settings.torrents_api_url or "").strip()
    api_key = (settings.torrents_api_key or "").strip()
    if not url or not api_key or not keyword:
        return []

    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout, follow_redirects=True) as client:
            response = await client.get(
                url,
                params={"keyword": keyword},
                headers={"X-API-Key": api_key},
            )
            response.raise_for_status()
            payload = response.json()
    except Exception:
        return []

    if not isinstance(payload, dict) or payload.get("code") not in {0, "0", None}:
        return []

    items = payload.get("data") or []
    if not isinstance(items, list):
        return []

    magnets: list[MagnetLink] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        magnet = _item_to_magnet(item)
        if not magnet or magnet.link in seen:
            continue
        seen.add(magnet.link)
        magnets.append(magnet)
    return sort_magnets(magnets)


def quality_flags_from_magnets(magnets: list[MagnetLink]) -> dict[str, bool]:
    return {
        "has_ultra": any(m.is_uhd for m in magnets),
        "has_hd": any(m.is_hd or m.is_uhd for m in magnets),
        "has_subtitle": any(m.has_subtitle or title_has_subtitle(m.title) for m in magnets),
    }


def magnets_matching_code(code: str, magnets: list[MagnetLink]) -> list[MagnetLink]:
    from app.scraper.parser import normalize_code

    normalized = normalize_code(code or "") or (code or "").strip().upper()
    compact = re.sub(r"[^A-Z0-9]", "", normalized)
    if not compact:
        return []
    matched: list[MagnetLink] = []
    for magnet in magnets:
        blob = re.sub(r"[^A-Z0-9]", "", (magnet.title or "").upper())
        if compact in blob:
            matched.append(magnet)
    return matched


def merge_quality_flags(*groups: dict[str, bool]) -> dict[str, bool]:
    merged = {"has_ultra": False, "has_hd": False, "has_subtitle": False}
    for group in groups:
        if not group:
            continue
        merged["has_ultra"] = merged["has_ultra"] or bool(group.get("has_ultra"))
        merged["has_hd"] = merged["has_hd"] or bool(group.get("has_hd"))
        merged["has_subtitle"] = merged["has_subtitle"] or bool(group.get("has_subtitle"))
    if merged["has_ultra"]:
        merged["has_hd"] = True
    return merged


async def fetch_article_quality_map(codes: list[str]) -> dict[str, dict[str, bool]]:
    from app.scraper.parser import normalize_code

    unique: list[str] = []
    seen: set[str] = set()
    for raw in codes:
        code = normalize_code(raw or "") or (raw or "").strip().upper()
        if not code or code in seen:
            continue
        seen.add(code)
        unique.append(code)
    if not unique:
        return {}

    url = (settings.torrents_api_url or "").strip()
    api_key = (settings.torrents_api_key or "").strip()
    if not url or not api_key:
        return {}

    flags: dict[str, dict[str, bool]] = {}
    sem = asyncio.Semaphore(8)

    async with httpx.AsyncClient(timeout=settings.request_timeout, follow_redirects=True) as client:
        async def one(code: str) -> None:
            async with sem:
                try:
                    response = await client.get(
                        url,
                        params={"keyword": code},
                        headers={"X-API-Key": api_key},
                    )
                    response.raise_for_status()
                    payload = response.json()
                except Exception:
                    return
                if not isinstance(payload, dict) or payload.get("code") not in {0, "0", None}:
                    return
                items = payload.get("data") or []
                if not isinstance(items, list):
                    return
                magnets: list[MagnetLink] = []
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    magnet = _item_to_magnet(item)
                    if magnet:
                        magnets.append(magnet)
                flags[code] = quality_flags_from_magnets(magnets)
                compact = re.sub(r"[^A-Z0-9]", "", code)
                if compact and compact not in flags:
                    flags[compact] = flags[code]

        await asyncio.gather(*(one(code) for code in unique))
    return flags
