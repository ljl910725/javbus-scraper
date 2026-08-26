import asyncio
import re
from pathlib import Path

import aiofiles
import httpx

from app.config import settings
from app.models import MovieInfo
from app.scraper.article_torrents import fetch_article_quality_map, fetch_article_torrents
from app.scraper.client import JavBusClient, get_client
from app.scraper.magnets import fetch_magnets, merge_magnets, sort_magnets
from app.scraper.parser import (
    ParsedMovie,
    build_detail_url,
    build_fuzzy_search_url,
    build_search_url,
    find_search_results,
    is_valid_detail,
    lookup_codes,
    normalize_code,
    parse_detail_page,
    parse_fuzzy_search_page,
    search_result_url,
)


class ScrapeError(Exception):
    pass


def _is_not_found(exc: Exception) -> bool:
    return (
        isinstance(exc, httpx.HTTPStatusError)
        and exc.response is not None
        and exc.response.status_code in {404, 410}
    )


async def _fetch_detail(
    client: JavBusClient,
    url: str,
    code: str,
) -> ParsedMovie:
    html = await client.get_text(url)
    return parse_detail_page(html, source_url=url, expected_code=code)


async def _try_detail(
    client: JavBusClient,
    url: str,
    code: str,
) -> ParsedMovie | None:
    try:
        movie = await _fetch_detail(client, url, code)
    except httpx.HTTPStatusError as exc:
        if _is_not_found(exc):
            return None
        raise
    return movie if is_valid_detail(movie) else None


async def _search_detail(
    client: JavBusClient,
    code: str,
) -> ParsedMovie | None:
    search_url = build_search_url(code)
    try:
        search_html = await client.get_text(search_url)
    except httpx.HTTPStatusError as exc:
        if _is_not_found(exc):
            return None
        raise

    slugs = find_search_results(search_html, code)
    for slug in slugs:
        movie = await _try_detail(client, search_result_url(slug), code)
        if movie:
            return movie

    wanted = {item.upper() for item in lookup_codes(code)}
    previews = parse_fuzzy_search_page(search_html, source_url=search_url)
    matches = [item for item in previews if item.code.upper() in wanted]
    if not matches and len(previews) == 1:
        matches = previews
    for preview in matches:
        movie = await _try_detail(client, preview.source_url, preview.code or code)
        if movie:
            return movie
    return None


async def _resolve_detail(
    client: JavBusClient,
    code: str,
) -> ParsedMovie:
    candidates = lookup_codes(code)
    if not candidates:
        raise ScrapeError("番号不能为空")

    for candidate in candidates:
        movie = await _try_detail(client, build_detail_url(candidate), candidate)
        if movie:
            return movie

        uncensored_url = build_detail_url(candidate, uncensored=True)
        if uncensored_url != build_detail_url(candidate):
            movie = await _try_detail(client, uncensored_url, candidate)
            if movie:
                return movie

        movie = await _search_detail(client, candidate)
        if movie:
            return movie

    raise ScrapeError(f"未找到番号 {code} 的匹配结果")


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


async def _scrape_javbus_movie(
    code: str,
    *,
    download_cover: bool = False,
    client: JavBusClient,
) -> MovieInfo:
    parsed = await _resolve_detail(client, code)
    info = _to_movie_info(parsed)
    info.magnets = await fetch_magnets(
        client,
        gid=parsed.gid,
        uc=parsed.uc,
        referer=parsed.source_url,
    )

    if download_cover and info.cover_url:
        try:
            info.cover_path = await _download_cover(
                client,
                cover_url=info.cover_url,
                code=info.code or code,
                referer=info.source_url,
            )
        except Exception:
            info.cover_path = None

    return info


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
    javbus_result, extra_magnets = await asyncio.gather(
        _scrape_javbus_movie(
            normalized,
            download_cover=download_cover,
            client=http_client,
        ),
        fetch_article_torrents(normalized),
        return_exceptions=True,
    )

    torrents = extra_magnets if isinstance(extra_magnets, list) else []

    if isinstance(javbus_result, MovieInfo):
        javbus_result.magnets = merge_magnets(javbus_result.magnets, torrents)
        return javbus_result

    if torrents:
        return MovieInfo(
            code=normalized,
            title=torrents[0].title,
            magnets=sort_magnets(torrents),
        )

    if isinstance(javbus_result, Exception):
        raise javbus_result
    raise ScrapeError(f"未找到番号 {code} 的匹配结果")


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
                user_settings=user_settings,
            )
            results.append(movie)
        except ScrapeError as exc:
            errors.append((code.strip(), str(exc)))
        except Exception as exc:
            errors.append((code.strip(), f"请求失败: {exc}"))

        if index < len(codes) - 1:
            await asyncio.sleep(settings.request_delay)

    return results, errors


async def fuzzy_search_movies(
    query: str,
    *,
    user_settings: dict | None = None,
) -> list[dict]:
    keywords = " ".join(query.split())
    if not keywords:
        raise ScrapeError("请输入搜索关键词")

    client = get_client(user_settings)
    search_url = build_fuzzy_search_url(keywords)
    html = await client.get_text(search_url)
    previews = parse_fuzzy_search_page(html, source_url=search_url)
    if not previews:
        raise ScrapeError(f"未找到与「{keywords}」相关的影片")

    quality_map = await fetch_article_quality_map([item.code for item in previews])
    results = []
    for item in previews:
        extra = quality_map.get(normalize_code(item.code) or (item.code or "").upper()) or {}
        results.append(
            {
                "code": item.code,
                "title": item.title,
                "cover_url": item.cover_url,
                "source_url": item.source_url,
                "release_date": item.release_date,
                "has_hd": bool(item.has_hd or extra.get("has_hd")),
                "has_ultra": bool(item.has_ultra or extra.get("has_ultra")),
                "has_subtitle": bool(item.has_subtitle or extra.get("has_subtitle")),
            }
        )
    return results
