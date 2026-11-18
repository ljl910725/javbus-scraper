from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt

from app.auth import create_access_token, decode_access_token
from app.config import settings
from app.routes.api import _cover_url_allowed
from app.subtitles.providers import avsubtitles, subtitlecat


@pytest.mark.parametrize(
    "url",
    [
        "https://www.javbus.com/pics/cover/abc_b.jpg",
        "https://pics.dmm.co.jp/digital/video/abc/abcpl.jpg",
    ],
)
def test_cover_proxy_allows_image_sites(url):
    assert _cover_url_allowed(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://192.168.1.135:9090/configs",
        "http://127.0.0.1:8000/api/health",
        "https://javbus.com.evil.example/a.jpg",
        "file:///etc/passwd",
        "",
    ],
)
def test_cover_proxy_blocks_other_addresses(url):
    assert not _cover_url_allowed(url)


@pytest.mark.parametrize(
    ("provider", "good"),
    [
        (avsubtitles, "https://www.avsubtitles.com/subtitles/zh/123"),
        (subtitlecat, "https://www.subtitlecat.com/subs/1/a-zh.srt"),
    ],
)
def test_subtitle_download_only_allows_its_own_site(provider, good):
    provider._require_site_url(good)
    for bad in ("http://192.168.1.135:18000/api/health", "https://example.com/a.srt", ""):
        with pytest.raises(ValueError):
            provider._require_site_url(bad)


def test_access_token_round_trip_and_expiry():
    future = datetime.now(timezone.utc) + timedelta(days=1)
    payload = decode_access_token(create_access_token(7, "tester", future))
    assert payload["sub"] == "7"
    assert payload["username"] == "tester"

    past = datetime.now(timezone.utc) - timedelta(seconds=5)
    assert decode_access_token(create_access_token(7, "tester", past)) is None


def test_old_refresh_token_cannot_call_api():
    token = jwt.encode(
        {
            "sub": "7",
            "username": "tester",
            "exp": datetime.now(timezone.utc) + timedelta(days=1),
            "typ": "refresh",
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    assert decode_access_token(token) is None
