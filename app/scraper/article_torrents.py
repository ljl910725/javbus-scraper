import httpx

from app.config import settings
from app.models import MagnetLink
from app.scraper.magnets import format_size_mb, sort_magnets


def _item_to_magnet(item: dict) -> MagnetLink | None:
    link = str(item.get("download_url") or "").strip()
    if not link.startswith("magnet:"):
        return None

    is_uhd = bool(item.get("uhd"))
    return MagnetLink(
        title=str(item.get("title") or "").strip() or link,
        link=link,
        size=format_size_mb(item.get("size_mb")),
        is_hd=is_uhd,
        is_uhd=is_uhd,
        has_subtitle=bool(item.get("chinese")),
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
