import asyncio
import re
from pathlib import Path

import aiofiles

from app.config import settings
from app.models import MovieInfo
from app.scraper.client import JavBusClient, get_client
from app.scraper.magnets import fetch_magnets
from app.scraper.parser import (
    ParsedMovie,
    build_detail_url,
    build_search_url,
    find_search_results,
    is_valid_detail,
    normalize_code,
    parse_detail_page,
    search_result_url,
)


class ScrapeError(Exception):
    pass


async def _fetch_detail(
    client: JavBusClient,
    url: str,
    code: str,
) -> ParsedMovie:
    html = await client.get_text(url)
    return parse_detail_page(html, source_url=url, expected_code=code)


async def _resolve_detail(
    client: JavBusClient,
    code: str,
) -> ParsedMovie:
    url = build_detail_url(code)
    movie = await _fetch_detail(client, url, code)
    if is_valid_detail(movie):
        return movie

    uncensored_url = build_detail_url(code, uncensored=True)
    if uncensored_url != url:
        movie = await _fetch_detail(client, uncensored_url, code)
        if is_valid_detail(movie):
            return movie

    search_url = build_search_url(code)
    search_html = await client.get_text(search_url)
    results = find_search_results(search_html, code)
    if not results:
        raise ScrapeError(f"未找到番号 {code} 的匹配结果")

    result_url = search_result_url(results[0])
    movie = await _fetch_detail(client, result_url, code)
    if not is_valid_detail(movie):
        raise ScrapeError(f"番号 {code} 详情页解析失败")
    return movie


def _to_movie_info(movie: ParsedMovie) -> MovieInfo:
    return MovieInfo(
        code=movie.code or "",
        title=movie.title,
        actresses=movie.actresses,
        cover_url=movie.cover_url,
        release_date=movie.release_date,
        runtime=movie.runtime,
        director=movie.director,
        studio=movie.studio,
        label=movie.label,
        genres=movie.genres,
        preview_images=movie.preview_images,
        source_url=movie.source_url,
    )


async def _download_cover(
    client: JavBusClient,
    *,
    cover_url: str,
    code: str,
    referer: str,
) -> str | None:
    if not cover_url:
        return None

    cover_dir = settings.cover_path
    cover_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(cover_url.split("?")[0]).suffix or ".jpg"
    safe_code = re.sub(r"[^\w\-]", "_", code)
    file_path = cover_dir / f"{safe_code}{suffix}"

    content = await client.download(cover_url, referer=referer)
    async with aiofiles.open(file_path, "wb") as file:
        await file.write(content)

    return str(file_path)


async def scrape_movie(
    code: str,
    *,
    download_cover: bool = False,
    client: JavBusClient | None = None,
    user_settings: dict | None = None,
) -> MovieInfo:
    normalized = normalize_code(code)
    if not normalized:
        raise ScrapeError("番号不能为空")

    http_client = client or get_client(user_settings)
    parsed = await _resolve_detail(http_client, normalized)
    info = _to_movie_info(parsed)

    magnets = await fetch_magnets(
        http_client,
        gid=parsed.gid,
        uc=parsed.uc,
        referer=parsed.source_url,
    )
    info.magnets = magnets

    if download_cover and info.cover_url:
        try:
            info.cover_path = await _download_cover(
                http_client,
                cover_url=info.cover_url,
                code=info.code or normalized,
                referer=info.source_url,
            )
        except Exception:
            info.cover_path = None

    return info


async def scrape_movies_batch(
    codes: list[str],
    *,
    download_cover: bool = False,
    user_settings: dict | None = None,
) -> tuple[list[MovieInfo], list[tuple[str, str]]]:
    client = get_client(user_settings)
    results: list[MovieInfo] = []
    errors: list[tuple[str, str]] = []

    for index, code in enumerate(codes):
        normalized = normalize_code(code)
        if not normalized:
            continue

        try:
            movie = await scrape_movie(
                normalized,
                download_cover=download_cover,
                client=client,
            )
            results.append(movie)
        except ScrapeError as exc:
            errors.append((code.strip(), str(exc)))
        except Exception as exc:
            errors.append((code.strip(), f"请求失败: {exc}"))

        if index < len(codes) - 1:
            await asyncio.sleep(settings.request_delay)

    return results, errors
