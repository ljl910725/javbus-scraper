import asyncio
from typing import Any

import httpx

from app.config import settings
from app.user_settings import effective_proxies, merge_settings

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}


class JavBusClient:
    def __init__(
        self,
        *,
        http_proxy: str | None = None,
        https_proxy: str | None = None,
    ) -> None:
        headers = dict(DEFAULT_HEADERS)
        if settings.javbus_cookie:
            headers["Cookie"] = settings.javbus_cookie

        client_kwargs: dict[str, Any] = {
            "headers": headers,
            "timeout": settings.request_timeout,
            "follow_redirects": True,
        }

        if http_proxy and https_proxy and http_proxy != https_proxy:
            client_kwargs["mounts"] = {
                "http://": httpx.AsyncHTTPTransport(proxy=http_proxy),
                "https://": httpx.AsyncHTTPTransport(proxy=https_proxy),
            }
        else:
            proxy = https_proxy or http_proxy
            if proxy:
                client_kwargs["proxy"] = proxy

        self._client = httpx.AsyncClient(**client_kwargs)

    async def close(self) -> None:
        await self._client.aclose()

    async def get(
        self,
        url: str,
        *,
        referer: str | None = None,
        retries: int = 3,
    ) -> httpx.Response:
        headers: dict[str, str] = {}
        if referer:
            headers["Referer"] = referer

        last_error: Exception | None = None
        for attempt in range(retries):
            try:
                response = await self._client.get(url, headers=headers)
                response.raise_for_status()
                return response
            except (httpx.HTTPError, httpx.TimeoutException) as exc:
                last_error = exc
                if attempt < retries - 1:
                    await asyncio.sleep(0.5 * (attempt + 1))

        assert last_error is not None
        raise last_error

    async def get_text(
        self,
        url: str,
        *,
        referer: str | None = None,
        retries: int = 3,
    ) -> str:
        response = await self.get(url, referer=referer, retries=retries)
        return response.text

    async def download(
        self,
        url: str,
        *,
        referer: str | None = None,
    ) -> bytes:
        headers: dict[str, str] = {}
        if referer:
            headers["Referer"] = referer
        response = await self._client.get(url, headers=headers)
        response.raise_for_status()
        return response.content


_clients: dict[str, JavBusClient] = {}


def _client_cache_key(user_settings: dict | None) -> str:
    cfg = merge_settings(user_settings)
    http_proxy, https_proxy = effective_proxies(cfg)
    cookie = settings.javbus_cookie or ""
    return f"{http_proxy or ''}|{https_proxy or ''}|{cookie}"


def get_client(user_settings: dict | None = None) -> JavBusClient:
    key = _client_cache_key(user_settings)
    if key not in _clients:
        cfg = merge_settings(user_settings)
        http_proxy, https_proxy = effective_proxies(cfg)
        _clients[key] = JavBusClient(http_proxy=http_proxy, https_proxy=https_proxy)
    return _clients[key]


async def close_client() -> None:
    global _clients
    for client in _clients.values():
        await client.close()
    _clients = {}
