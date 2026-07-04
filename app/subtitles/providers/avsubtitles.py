from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from app.scraper.client import JavBusClient

BASE_URL = "https://www.avsubtitles.com"
MOVIE_LINK_RE = re.compile(r"^/movie\d+/.+")
SUBTITLE_PATH_RE = re.compile(r"/subtitles/([a-z]{2,3})/(\d+)$", re.I)

LANGUAGE_LABELS = {
    "en": "英语",
    "zh": "中文",
    "cn": "中文",
    "chs": "简体中文",
    "cht": "繁体中文",
    "ko": "韩语",
    "ja": "日语",
    "th": "泰语",
    "vi": "越南语",
    "es": "西班牙语",
    "fr": "法语",
}


@dataclass
class AvSubtitleItem:
    provider: str
    sub_id: str
    rev_id: str
    language: str
    language_code: str
    title: str
    uploader: str
    downloads: int
    detail_url: str


def _language_label(code: str) -> str:
    key = (code or "").lower()
    return LANGUAGE_LABELS.get(key, code.upper() if code else "未知")


def _parse_download_count(text: str) -> int:
    match = re.search(r"(\d+)\s*downloads?", text, re.I)
    return int(match.group(1)) if match else 0


def normalize_subtitle_code(code: str) -> str:
    return code.strip().upper().replace("_", "-")


def _absolute(path: str) -> str:
    return urljoin(BASE_URL, path)


async def _get_html(client: JavBusClient, url: str, *, referer: str | None = None) -> str:
    response = await client.get(url, referer=referer or BASE_URL)
    return response.text


async def _find_movie_path(client: JavBusClient, code: str) -> str | None:
    search_url = _absolute(f"/search_results.php?search={normalize_subtitle_code(code)}&scope=code")
    html = await _get_html(client, search_url)
    soup = BeautifulSoup(html, "lxml")
    code_key = normalize_subtitle_code(code).replace("-", "")

    for link in soup.select("a[href]"):
        href = (link.get("href") or "").strip()
        if not MOVIE_LINK_RE.match(href):
            continue
        text_key = link.get_text(" ", strip=True).upper().replace("-", "")
        if code_key in text_key or code_key in href.upper().replace("-", ""):
            return href.split("?")[0]

    for link in soup.select("a[href]"):
        href = (link.get("href") or "").strip()
        if MOVIE_LINK_RE.match(href):
            return href.split("?")[0]
    return None


def _parse_movie_subtitles(movie_path: str, html: str) -> list[AvSubtitleItem]:
    soup = BeautifulSoup(html, "lxml")
    items: list[AvSubtitleItem] = []
    seen: set[str] = set()

    for link in soup.select("a[href*='/subtitles/']"):
        href = (link.get("href") or "").strip()
        match = SUBTITLE_PATH_RE.search(href)
        if not match:
            continue
        lang_code, sub_id = match.group(1).lower(), match.group(2)
        if sub_id in seen:
            continue
        seen.add(sub_id)

        row = link.find_parent("tr")
        title = ""
        uploader = ""
        language = _language_label(lang_code)
        if row:
            cells = row.select("td")
            if cells:
                language = cells[0].get_text(" ", strip=True) or language
            if len(cells) > 2:
                title = cells[2].get_text(" ", strip=True)
            if len(cells) > 6:
                uploader = cells[6].get_text(" ", strip=True)

        detail_path = href if href.startswith("/") else f"{movie_path}/subtitles/{lang_code}/{sub_id}"
        items.append(
            AvSubtitleItem(
                provider="avsubtitles",
                sub_id=sub_id,
                rev_id="",
                language=language,
                language_code=lang_code,
                title=title,
                uploader=uploader,
                downloads=0,
                detail_url=_absolute(detail_path),
            )
        )
    return items


async def _load_rev_id(client: JavBusClient, detail_url: str) -> tuple[str, int]:
    html = await _get_html(client, detail_url, referer=BASE_URL)
    soup = BeautifulSoup(html, "lxml")
    rev_id = ""
    form = soup.select_one('form[action="/download_page.php"]')
    if form:
        rev_input = form.select_one('input[name="revid"]')
        if rev_input and rev_input.get("value"):
            rev_id = rev_input["value"]

    downloads = 0
    for link in soup.select("a"):
        text = link.get_text(" ", strip=True)
        if "download" in text.lower():
            downloads = _parse_download_count(text)
            if downloads:
                break
    return rev_id, downloads


async def search_avsubtitles(client: JavBusClient, code: str) -> tuple[str, list[AvSubtitleItem]]:
    movie_path = await _find_movie_path(client, code)
    if not movie_path:
        return normalize_subtitle_code(code), []

    movie_url = _absolute(movie_path)
    html = await _get_html(client, movie_url, referer=BASE_URL)
    items = _parse_movie_subtitles(movie_path, html)

    enriched: list[AvSubtitleItem] = []
    for item in items:
        rev_id, downloads = await _load_rev_id(client, item.detail_url)
        item.rev_id = rev_id
        item.downloads = downloads
        enriched.append(item)

    enriched.sort(
        key=lambda s: (
            0 if s.language_code in {"zh", "cn", "chs", "cht"} else 1,
            -s.downloads,
            s.language,
        )
    )
    return normalize_subtitle_code(code), enriched


def _extract_srt_from_zip(content: bytes) -> tuple[bytes, str]:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        srt_names = [name for name in archive.namelist() if name.lower().endswith(".srt")]
        if not srt_names:
            raise ValueError("压缩包内未找到 .srt 文件")
        target = sorted(srt_names, key=len)[0]
        return archive.read(target), target.split("/")[-1]


async def download_avsubtitle(
    client: JavBusClient,
    *,
    sub_id: str,
    rev_id: str,
    detail_url: str,
    code: str,
    language_code: str,
) -> tuple[bytes, str]:
    if not rev_id:
        rev_id, _ = await _load_rev_id(client, detail_url)
    if not rev_id:
        raise ValueError("无法获取字幕版本信息")

    page_url = _absolute(f"/download_page.php?subid={sub_id}&revid={rev_id}")
    await _get_html(client, detail_url, referer=BASE_URL)
    await _get_html(client, page_url, referer=detail_url)

    download_url = _absolute(f"/download_sub.php?subid={sub_id}&revid={rev_id}")
    response = await client.get(download_url, referer=page_url)
    content = response.content
    content_type = (response.headers.get("content-type") or "").lower()

    safe_code = normalize_subtitle_code(code or "subtitle")
    lang = (language_code or "sub").lower()

    if content[:2] == b"PK" or "zip" in content_type:
        srt_bytes, srt_name = _extract_srt_from_zip(content)
        filename = srt_name or f"{safe_code}.{lang}.srt"
        return srt_bytes, filename

    if content.strip().startswith(b"{") or b"<html" in content[:200].lower():
        raise ValueError("字幕下载失败，请稍后重试")

    return content, f"{safe_code}.{lang}.srt"
