from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import unquote, urljoin

from bs4 import BeautifulSoup

from app.scraper.client import JavBusClient
from app.subtitles.providers.avsubtitles import LANGUAGE_LABELS, normalize_subtitle_code

BASE_URL = "https://www.subtitlecat.com"
PREFERRED_LANGS = {"zh", "zh-cn", "zh-tw", "en", "ko", "ja", "th"}
MAX_ITEMS = 24
SEARCH_LINK_RE = re.compile(r"(?:^|/)subs/(\d+)/([^/?#]+)\.html$", re.I)
SRT_LINK_RE = re.compile(r"(?:^|/)subs/(\d+)/([^/?#]+\.srt)$", re.I)
LANG_SUFFIX_RE = re.compile(r"-([a-z]{2}(?:-[A-Z]{2})?)\.srt$", re.I)


@dataclass
class SubtitleCatItem:
    provider: str
    sub_id: str
    rev_id: str
    language: str
    language_code: str
    title: str
    uploader: str
    downloads: int
    detail_url: str


def _absolute(path: str) -> str:
    path = (path or "").strip()
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if path.startswith("//"):
        return f"https:{path}"
    return urljoin(f"{BASE_URL}/", path.lstrip("/"))


def _language_label(code: str) -> str:
    key = (code or "").lower()
    if key in {"zh-tw", "zh-hk"}:
        return "繁体中文"
    if key in {"zh-cn", "zh"}:
        return "简体中文"
    return LANGUAGE_LABELS.get(key, code.upper() if code else "未知")


def _code_key(code: str) -> str:
    return normalize_subtitle_code(code).replace("-", "").upper()


def _matches_code(code: str, *parts: str) -> bool:
    key = _code_key(code)
    for part in parts:
        if key in (part or "").upper().replace("-", "").replace("_", ""):
            return True
    return False


def _infer_language_code(name: str) -> str:
    lowered = name.lower()
    for token in (".zh-tw.", ".zh-cn.", ".zh.", ".eng.", ".en.", ".ko.", ".ja.", ".th."):
        if token in lowered:
            return token.strip(".").replace("eng", "en")
    match = LANG_SUFFIX_RE.search(lowered)
    if match:
        return match.group(1).lower()
    if ".zh" in lowered:
        return "zh"
    if ".eng" in lowered or ".en." in lowered:
        return "en"
    return "unk"


def _parse_search_pages(html: str, code: str) -> list[tuple[str, str, str]]:
    soup = BeautifulSoup(html, "lxml")
    pages: list[tuple[str, str, str]] = []
    seen: set[str] = set()

    for link in soup.select("a[href*='subs/']"):
        href = (link.get("href") or "").strip()
        if not href.endswith(".html"):
            continue
        match = SEARCH_LINK_RE.search(href)
        if not match:
            continue
        sub_id, slug = match.group(1), unquote(match.group(2))
        if sub_id in seen:
            continue
        title = link.get_text(" ", strip=True) or slug
        if not _matches_code(code, slug, title, href):
            continue
        seen.add(sub_id)
        pages.append((sub_id, slug, title))
    return pages


def _parse_detail_srts(detail_html: str, *, sub_id: str, page_title: str) -> list[SubtitleCatItem]:
    soup = BeautifulSoup(detail_html, "lxml")
    items: list[SubtitleCatItem] = []
    seen: set[str] = set()

    for link in soup.select("a[href$='.srt']"):
        href = (link.get("href") or "").strip()
        match = SRT_LINK_RE.search(href)
        if not match:
            continue
        srt_id, filename = match.group(1), unquote(match.group(2))
        if href in seen:
            continue
        seen.add(href)

        lang_code = _infer_language_code(filename)
        if lang_code == "unk":
            lang_code = _infer_language_code(page_title)
        items.append(
            SubtitleCatItem(
                provider="subtitlecat",
                sub_id=srt_id or sub_id,
                rev_id="",
                language=_language_label(lang_code),
                language_code=lang_code,
                title=page_title or filename.replace(".srt", ""),
                uploader="SubtitleCat",
                downloads=0,
                detail_url=_absolute(href),
            )
        )
    return items


async def search_subtitlecat(client: JavBusClient, code: str) -> tuple[str, list[SubtitleCatItem]]:
    normalized = normalize_subtitle_code(code)
    search_url = _absolute(f"/?search={normalized}")
    html = await client.get_text(search_url, referer=BASE_URL)
    pages = _parse_search_pages(html, normalized)
    if not pages:
        return normalized, []

    items: list[SubtitleCatItem] = []
    seen_urls: set[str] = set()
    for sub_id, slug, title in pages:
        detail_url = _absolute(f"/subs/{sub_id}/{slug}.html")
        detail_html = await client.get_text(detail_url, referer=search_url)
        for item in _parse_detail_srts(detail_html, sub_id=sub_id, page_title=title):
            if item.detail_url in seen_urls:
                continue
            seen_urls.add(item.detail_url)
            items.append(item)

    items = [
        item
        for item in items
        if (item.language_code or "").lower() in PREFERRED_LANGS
    ]
    items.sort(
        key=lambda s: (
            0 if s.language_code in {"zh", "zh-cn", "chs"} else 1,
            0 if s.language_code in {"zh-tw", "cht"} else 1,
            s.language,
            s.title,
        )
    )
    return normalized, items[:MAX_ITEMS]


async def download_subtitlecat(
    client: JavBusClient,
    *,
    detail_url: str,
    code: str,
    language_code: str,
) -> tuple[bytes, str]:
    if not detail_url:
        raise ValueError("缺少字幕下载地址")

    response = await client.get(detail_url, referer=BASE_URL)
    content = response.content
    if content.strip().startswith(b"{") or b"<html" in content[:200].lower():
        raise ValueError("字幕下载失败，请稍后重试")

    safe_code = normalize_subtitle_code(code or "subtitle")
    lang = (language_code or "sub").lower()
    filename = detail_url.rsplit("/", 1)[-1]
    if not filename.lower().endswith(".srt"):
        filename = f"{safe_code}.{lang}.srt"
    return content, filename
