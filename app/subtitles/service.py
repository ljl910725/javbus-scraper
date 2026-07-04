import asyncio

from app import db
from app.scraper.client import get_client
from app.subtitles.providers.avsubtitles import (
    AvSubtitleItem,
    download_avsubtitle,
    normalize_subtitle_code,
    search_avsubtitles,
)
from app.subtitles.providers.subtitlecat import (
    SubtitleCatItem,
    download_subtitlecat,
    search_subtitlecat,
)

ProviderItem = AvSubtitleItem | SubtitleCatItem


def _to_dict(item: ProviderItem) -> dict:
    return {
        "provider": item.provider,
        "sub_id": item.sub_id,
        "rev_id": item.rev_id,
        "language": item.language,
        "language_code": item.language_code,
        "title": item.title,
        "uploader": item.uploader,
        "downloads": item.downloads,
        "detail_url": item.detail_url,
    }


def _sort_key(item: ProviderItem) -> tuple:
    lang = (item.language_code or "").lower()
    zh_rank = 0 if lang in {"zh", "zh-cn", "chs"} else 1 if lang in {"zh-tw", "cht"} else 2
    provider_rank = 0 if item.provider == "subtitlecat" else 1
    return (zh_rank, provider_rank, -item.downloads, item.language, item.title)


def _dedupe_key(item: ProviderItem) -> str:
    lang = (item.language_code or "").lower()
    title = (item.title or "").strip().lower()
    return f"{item.provider}|{lang}|{title}"


async def search_subtitles(code: str, *, user_settings: dict | None = None) -> dict:
    normalized = normalize_subtitle_code(code)
    client = get_client(user_settings)

    av_task = search_avsubtitles(client, normalized)
    sc_task = search_subtitlecat(client, normalized)
    av_result, sc_result = await asyncio.gather(av_task, sc_task, return_exceptions=True)

    providers: list[str] = []
    merged: list[ProviderItem] = []

    if isinstance(av_result, Exception):
        pass
    else:
        _, av_items = av_result
        if av_items:
            providers.append("avsubtitles")
        merged.extend(av_items)

    if isinstance(sc_result, Exception):
        pass
    else:
        _, sc_items = sc_result
        if sc_items:
            providers.append("subtitlecat")
        merged.extend(sc_items)

    if not providers:
        if isinstance(av_result, Exception) and isinstance(sc_result, Exception):
            raise sc_result
        providers = ["avsubtitles", "subtitlecat"]

    seen: set[str] = set()
    unique: list[ProviderItem] = []
    for item in sorted(merged, key=_sort_key):
        key = _dedupe_key(item)
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)

    found_code = normalized
    if isinstance(av_result, tuple) and av_result[0]:
        found_code = av_result[0]
    elif isinstance(sc_result, tuple) and sc_result[0]:
        found_code = sc_result[0]

    return {
        "code": found_code,
        "results": [_to_dict(item) for item in unique],
        "providers": providers,
    }


async def download_subtitle_file(
    *,
    provider: str,
    sub_id: str,
    rev_id: str,
    detail_url: str,
    code: str,
    language_code: str,
    user_settings: dict | None = None,
) -> tuple[bytes, str]:
    client = get_client(user_settings)
    if provider == "avsubtitles":
        return await download_avsubtitle(
            client,
            sub_id=sub_id,
            rev_id=rev_id,
            detail_url=detail_url,
            code=code,
            language_code=language_code,
        )
    if provider == "subtitlecat":
        return await download_subtitlecat(
            client,
            detail_url=detail_url,
            code=code,
            language_code=language_code,
        )
    raise ValueError(f"不支持的字幕来源: {provider}")


async def save_subtitle_to_path(
    *,
    provider: str,
    sub_id: str,
    rev_id: str,
    detail_url: str,
    code: str,
    language_code: str,
    target_dir: str,
    filename: str,
    user_settings: dict | None = None,
) -> dict:
    from app.subtitles.storage import save_subtitle_to_disk

    content, _ = await download_subtitle_file(
        provider=provider,
        sub_id=sub_id,
        rev_id=rev_id,
        detail_url=detail_url,
        code=code,
        language_code=language_code,
        user_settings=user_settings,
    )
    fallback = f"{normalize_subtitle_code(code or 'subtitle')}.{(language_code or 'sub').lower()}.srt"
    return save_subtitle_to_disk(
        target_dir=target_dir,
        filename=filename or fallback,
        content=content,
    )


def user_settings_from_id(user: dict | None) -> dict | None:
    if not user:
        return None
    return db.get_user_settings(user["id"])
