from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient

from app.deps import get_current_user, get_optional_user
from app.main import app
from app.routes import subtitles as subtitle_routes

FAKE_USER = {"id": 1, "username": "tester", "email": "t@example.com"}


@pytest.fixture
def client():
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_register_is_closed(client):
    res = client.post("/api/auth/register", json={})
    assert res.status_code == 403


def test_cover_proxy_requires_login(client):
    res = client.get("/api/cover/proxy", params={"url": "https://www.javbus.com/pics/a.jpg"})
    assert res.status_code == 401


def test_cover_proxy_blocks_internal_address_when_logged_in(client):
    app.dependency_overrides[get_optional_user] = lambda: FAKE_USER
    res = client.get("/api/cover/proxy", params={"url": "http://192.168.1.135:18000/api/health"})
    assert res.status_code == 400


def test_subtitle_download_requires_login(client):
    res = client.get(
        "/api/subtitles/download",
        params={"provider": "subtitlecat", "sub_id": "1", "detail_url": "https://www.subtitlecat.com/subs/1/a.srt"},
    )
    assert res.status_code == 401


def test_subtitle_download_sends_chinese_filename(client, monkeypatch):
    async def fake_download(**_kwargs):
        return b"1\n00:00:01,000 --> 00:00:02,000\nhi\n", "中文 字幕.srt"

    monkeypatch.setattr(subtitle_routes, "download_subtitle_file", fake_download)
    monkeypatch.setattr(subtitle_routes, "user_settings_from_id", lambda _user: None)
    app.dependency_overrides[get_current_user] = lambda: FAKE_USER
    res = client.get(
        "/api/subtitles/download",
        params={"provider": "subtitlecat", "sub_id": "1", "detail_url": "https://www.subtitlecat.com/subs/1/a.srt"},
    )
    assert res.status_code == 200
    disposition = res.headers["content-disposition"]
    assert disposition.startswith("attachment; filename*=UTF-8''")
    assert unquote(disposition.split("''", 1)[1]) == "中文 字幕.srt"
