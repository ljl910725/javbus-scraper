import re

from bs4 import BeautifulSoup

from app.config import settings
from app.models import MagnetLink
from app.scraper.client import JavBusClient

_SIZE_UNITS = {"KB": 1024, "MB": 1024**2, "GB": 1024**3, "TB": 1024**4}


def _size_to_bytes(size: str) -> int:
    match = re.search(r"(\d+(?:\.\d+)?)\s*([KMGT]B)", size, re.IGNORECASE)
    if not match:
        return 0
    value = float(match.group(1))
    unit = match.group(2).upper()
    return int(value * _SIZE_UNITS.get(unit, 1))


def _date_sort_key(date: str) -> int:
    if not date:
        return 0
    try:
        return -int(date.replace("-", ""))
    except ValueError:
        return 0


def sort_magnets(magnets: list[MagnetLink]) -> list[MagnetLink]:
    """字幕 > 高清 > 大小降序 > 时间降序"""
    return sorted(
        magnets,
        key=lambda m: (
            0 if m.has_subtitle else 1,
            0 if m.is_hd else 1,
            -_size_to_bytes(m.size),
            _date_sort_key(m.date),
        ),
    )


def _parse_magnet_row(row, seen: set[str]) -> MagnetLink | None:
    link_el = row.select_one('a[href^="magnet:"]')
    if not link_el:
        return None

    link = link_el["href"]
    if link in seen:
        return None
    seen.add(link)

    title = link_el.get_text(strip=True) or link.split("dn=")[-1].split("&")[0]
    row_text = row.get_text(" ", strip=True)
    row_html = str(row).lower()

    size = ""
    size_match = re.search(r"(\d+(?:\.\d+)?\s*[KMGT]B)", row_text, re.IGNORECASE)
    if size_match:
        size = size_match.group(1)

    date = ""
    date_match = re.search(r"(\d{4}-\d{2}-\d{2})", row_text)
    if date_match:
        date = date_match.group(1)

    classes = " ".join(link_el.get("class", []))
    is_hd = (
        "hd" in classes.lower()
        or "高清" in row_text
        or "hdvideo" in row_html
        or "onclickhd" in row_html
    )
    has_subtitle = (
        "subtitle" in classes.lower()
        or "字幕" in row_text
        or "subtitle" in row_html
    )

    return MagnetLink(
        title=title,
        link=link,
        size=size,
        date=date,
        is_hd=is_hd,
        has_subtitle=has_subtitle,
    )


def parse_magnet_html(html: str) -> list[MagnetLink]:
    soup = BeautifulSoup(html, "lxml")
    magnets: list[MagnetLink] = []
    seen: set[str] = set()

    rows = soup.select("#magnet-table tr")
    if not rows:
        rows = soup.select("tr")

    for row in rows:
        magnet = _parse_magnet_row(row, seen)
        if magnet:
            magnets.append(magnet)

    return sort_magnets(magnets)


async def fetch_magnets(
    client: JavBusClient,
    *,
    gid: str,
    uc: str,
    referer: str,
) -> list[MagnetLink]:
    if not gid:
        return []

    base = settings.base_url.rstrip("/")
    url = f"{base}/ajax/uncledatoolsbyajax.php?gid={gid}&lang=zh&uc={uc}"
    html = await client.get_text(url, referer=referer)
    return parse_magnet_html(html)
