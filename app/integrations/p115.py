import time
from dataclasses import dataclass

import httpx

from app.config import settings as app_settings
from app.user_settings import effective_proxies, merge_settings

P115_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://115.com/?tab=offline&mode=wangpan",
}


class P115Error(Exception):
    pass


class P115NotConfiguredError(P115Error):
    pass


@dataclass
class P115PushResult:
    link: str
    success: bool
    message: str = ""
    task_name: str = ""


def _parse_cookies(cookie_str: str) -> dict[str, str]:
    cookies: dict[str, str] = {}
    for part in cookie_str.split(";"):
        part = part.strip()
        if "=" in part:
            key, value = part.split("=", 1)
            cookies[key.strip()] = value.strip()
    return cookies


def _cfg(user_settings: dict | None = None) -> dict:
    return merge_settings(user_settings)


def _build_client(user_settings: dict | None = None) -> httpx.AsyncClient:
    cfg = _cfg(user_settings)
    cookie = cfg.get("p115_cookie")
    if not cookie:
        raise P115NotConfiguredError("未配置 P115_COOKIE，请在设置页填写")

    cookies = _parse_cookies(cookie)
    client_kwargs: dict = {
        "headers": P115_HEADERS,
        "cookies": cookies,
        "timeout": app_settings.request_timeout,
        "follow_redirects": True,
    }

    http_proxy, https_proxy = effective_proxies(cfg)
    proxy = https_proxy or http_proxy
    if proxy:
        client_kwargs["proxy"] = proxy

    return httpx.AsyncClient(**client_kwargs)


def _extract_uid(cookies: dict[str, str]) -> str:
    for key in ("UID", "uid"):
        if key in cookies:
            return cookies[key]
    raise P115Error("Cookie 中缺少 UID，请重新从浏览器复制完整 Cookie")


async def _get_offline_signature(client: httpx.AsyncClient, uid: str) -> tuple[str, str]:
    timestamp = int(time.time() * 1000)
    response = await client.get(
        "https://115.com/",
        params={"ct": "offline", "ac": "space", "_": timestamp},
    )
    response.raise_for_status()
    data = response.json()
    if not data.get("state"):
        raise P115Error(data.get("error_msg") or data.get("error") or "获取 115 离线签名失败")
    return str(data["sign"]), str(data["time"])


async def check_p115_status(user_settings: dict | None = None) -> dict:
    cfg = _cfg(user_settings)
    if not cfg.get("p115_cookie"):
        return {"configured": False, "logged_in": False, "message": "未配置 Cookie"}

    async with _build_client(user_settings) as client:
        response = await client.get(
            "https://passport.115.com/",
            params={
                "ct": "ajax",
                "ac": "islogin",
                "is_ssl": "1",
                "_": int(time.time() * 1000),
            },
        )
        data = response.json()
        if data.get("state") and data.get("data", {}).get("is_login") == 1:
            user = data["data"]
            return {
                "configured": True,
                "logged_in": True,
                "user_id": user.get("USER_ID", ""),
                "user_name": user.get("USER_NAME", ""),
                "is_vip": user.get("IS_VIP") == 1,
                "message": "已登录",
            }
        return {
            "configured": True,
            "logged_in": False,
            "message": "Cookie 已过期，请重新登录 115 并更新 Cookie",
        }


async def push_magnet(link: str, user_settings: dict | None = None) -> P115PushResult:
    if not link.startswith("magnet:"):
        raise P115Error("仅支持 magnet 链接")

    async with _build_client(user_settings) as client:
        cfg = _cfg(user_settings)
        cookies = _parse_cookies(cfg["p115_cookie"])
        uid = _extract_uid(cookies)
        sign, offline_time = await _get_offline_signature(client, uid)

        response = await client.post(
            "https://115.com/lixian/",
            params={"ct": "lixian", "ac": "add_task_url"},
            data={
                "url": link,
                "uid": uid,
                "sign": sign,
                "time": offline_time,
            },
        )
        data = response.json()

        if data.get("state"):
            return P115PushResult(
                link=link,
                success=True,
                task_name=data.get("name", ""),
                message="推送成功",
            )

        return P115PushResult(
            link=link,
            success=False,
            message=data.get("error_msg") or data.get("error") or "推送失败",
        )


async def push_magnets(links: list[str], user_settings: dict | None = None) -> list[P115PushResult]:
    if not links:
        raise P115Error("磁力链接列表不能为空")

    unique_links: list[str] = []
    seen: set[str] = set()
    for link in links:
        if link not in seen:
            seen.add(link)
            unique_links.append(link)

    results: list[P115PushResult] = []
    for chunk_start in range(0, len(unique_links), 15):
        chunk = unique_links[chunk_start : chunk_start + 15]
        if len(chunk) == 1:
            results.append(await push_magnet(chunk[0], user_settings))
            continue

        async with _build_client(user_settings) as client:
            cfg = _cfg(user_settings)
            cookies = _parse_cookies(cfg["p115_cookie"])
            uid = _extract_uid(cookies)
            sign, offline_time = await _get_offline_signature(client, uid)

            payload: dict[str, str] = {
                "uid": uid,
                "sign": sign,
                "time": offline_time,
            }
            for index, link in enumerate(chunk):
                payload[f"url[{index}]"] = link

            response = await client.post(
                "https://115.com/lixian/",
                params={"ct": "lixian", "ac": "add_task_urls"},
                data=payload,
            )
            data = response.json()

            if not data.get("state"):
                for link in chunk:
                    results.append(
                        P115PushResult(
                            link=link,
                            success=False,
                            message=data.get("error_msg") or "批量推送失败",
                        )
                    )
                continue

            for item in data.get("result", []):
                link = item.get("url", "")
                if item.get("state"):
                    results.append(
                        P115PushResult(
                            link=link,
                            success=True,
                            task_name=item.get("name", ""),
                            message="推送成功",
                        )
                    )
                else:
                    results.append(
                        P115PushResult(
                            link=link,
                            success=False,
                            message=item.get("error_msg") or "推送失败",
                        )
                    )

    return results
