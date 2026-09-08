import asyncio
import base64
import gzip
import hashlib
import re
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.config import settings as app_settings
from app.scraper.magnets import (
    clean_magnet_link,
    is_ed2k_link,
    is_error_10004,
    is_magnet_link,
    is_offline_link,
    magnet_needs_amp_retry,
    parse_ed2k_link,
)
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


async def _add_offline_url(
    client: httpx.AsyncClient,
    link: str,
    uid: str,
    sign: str,
    offline_time: str,
    folder_cid: str,
) -> dict:
    payload = {
        "url": link,
        "uid": uid,
        "sign": sign,
        "time": offline_time,
    }
    if folder_cid:
        payload["wp_path_id"] = folder_cid
    response = await client.post(
        "https://115.com/lixian/",
        params={"ct": "lixian", "ac": "add_task_url"},
        data=payload,
    )
    try:
        return response.json()
    except Exception:
        return {}


def _p115_fail_message(data: dict, fallback: str = "推送失败") -> str:
    code = ""
    for key in ("errcode", "errno", "error_code", "code"):
        value = data.get(key)
        if value is not None and str(value).strip() != "":
            code = str(value).strip()
            break
    message = data.get("error_msg") or data.get("error") or fallback
    if code and code not in str(message):
        return f"{message} ({code})"
    return message


async def push_magnet(link: str, user_settings: dict | None = None) -> P115PushResult:
    if not is_offline_link(link):
        raise P115Error("仅支持 magnet / ed2k 链接")

    async with _build_client(user_settings) as client:
        cfg = _cfg(user_settings)
        cookies = _parse_cookies(cfg["p115_cookie"])
        uid = _extract_uid(cookies)
        sign, offline_time = await _get_offline_signature(client, uid)
        folder_cid = str(cfg.get("p115_folder_cid") or "").strip()
        data = await _add_offline_url(client, link, uid, sign, offline_time, folder_cid)

        if data.get("state"):
            return P115PushResult(
                link=link,
                success=True,
                task_name=data.get("name", ""),
                message="推送成功",
            )

        if is_error_10004(data) and magnet_needs_amp_retry(link):
            cleaned = clean_magnet_link(link)
            data = await _add_offline_url(client, cleaned, uid, sign, offline_time, folder_cid)
            if data.get("state"):
                return P115PushResult(
                    link=cleaned,
                    success=True,
                    task_name=data.get("name", ""),
                    message="推送成功",
                )
            link = cleaned

        return P115PushResult(
            link=link,
            success=False,
            message=_p115_fail_message(data),
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
            folder_cid = str(cfg.get("p115_folder_cid") or "").strip()
            if folder_cid:
                payload["wp_path_id"] = folder_cid
            for index, link in enumerate(chunk):
                payload[f"url[{index}]"] = link

            response = await client.post(
                "https://115.com/lixian/",
                params={"ct": "lixian", "ac": "add_task_urls"},
                data=payload,
            )
            data = response.json()

            if not data.get("state"):
                if is_error_10004(data):
                    for link in chunk:
                        results.append(await push_magnet(link, user_settings))
                    continue
                for link in chunk:
                    results.append(
                        P115PushResult(
                            link=link,
                            success=False,
                            message=_p115_fail_message(data, "批量推送失败"),
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
                elif is_error_10004(item) and magnet_needs_amp_retry(link):
                    results.append(await push_magnet(link, user_settings))
                else:
                    results.append(
                        P115PushResult(
                            link=link,
                            success=False,
                            message=_p115_fail_message(item),
                        )
                    )

    return results


_INFOHASH_RE = re.compile(r"xt=urn:btih:([a-zA-Z0-9]+)", re.I)
_VIDEO_EXTS = {
    ".mp4", ".mkv", ".avi", ".wmv", ".mov", ".flv", ".webm", ".m4v", ".ts",
    ".mpg", ".mpeg", ".iso", ".rmvb", ".rm", ".vob", ".m2ts", ".asf",
}
_TORRENT_CACHE_URLS = (
    "https://itorrents.org/torrent/{hash}.torrent",
    "https://btcache.me/torrent/{hash}",
    "https://torrage.info/torrent.php?h={hash}",
    "https://torrage.info/download?h={hash}",
    "https://watercache.nanobyte.org/torrent/{hash}",
)


def _folder_cid(user_settings: dict | None = None) -> str:
    cid = str(_cfg(user_settings).get("p115_folder_cid") or "").strip()
    return cid or "0"


def extract_infohash(magnet: str) -> str:
    match = _INFOHASH_RE.search(magnet or "")
    if not match:
        raise P115Error("无法从磁力链接解析 infohash")
    value = match.group(1).strip()
    if len(value) == 32:
        padding = (-len(value)) % 8
        decoded = base64.b32decode(value.upper() + ("=" * padding))
        return decoded.hex()
    if len(value) == 40:
        return value.lower()
    raise P115Error("磁力 infohash 格式无效")


def _bdecode_at(data: bytes, index: int = 0) -> tuple[object, int]:
    if index >= len(data):
        raise ValueError("种子内容不完整")
    flag = data[index : index + 1]
    if flag == b"i":
        end = data.index(b"e", index)
        return int(data[index + 1 : end]), end + 1
    if flag == b"l":
        index += 1
        items = []
        while data[index : index + 1] != b"e":
            item, index = _bdecode_at(data, index)
            items.append(item)
        return items, index + 1
    if flag == b"d":
        index += 1
        mapping = {}
        while data[index : index + 1] != b"e":
            key, index = _bdecode_at(data, index)
            value, index = _bdecode_at(data, index)
            mapping[key] = value
        return mapping, index + 1
    colon = data.index(b":", index)
    length = int(data[index:colon])
    start = colon + 1
    return data[start : start + length], start + length


def _bdecode(data: bytes):
    value, _ = _bdecode_at(data, 0)
    return value


def torrent_infohash(raw: bytes) -> str:
    marker = b"4:info"
    idx = raw.find(marker)
    if idx < 0:
        raise P115Error("种子缺少 info")
    start = idx + len(marker)
    _, end = _bdecode_at(raw, start)
    return hashlib.sha1(raw[start:end]).hexdigest()


def _maybe_decompress_torrent(data: bytes) -> bytes:
    if data.startswith(b"\x1f\x8b"):
        try:
            return gzip.decompress(data)
        except Exception as exc:
            raise P115Error("种子 gzip 解压失败") from exc
    return data


def _decode_torrent_text(value) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return str(value)


def _info_text(mapping: dict, *keys: bytes) -> str:
    for key in keys:
        if key in mapping:
            text = _decode_torrent_text(mapping[key]).strip()
            if text:
                return text
    return ""


def parse_torrent_files(raw: bytes) -> tuple[str, list[dict]]:
    if not raw.startswith(b"d"):
        raise P115Error("不是有效的种子文件")
    try:
        meta = _bdecode(raw)
        info = meta[b"info"]
    except Exception as exc:
        raise P115Error(f"解析种子失败: {exc}") from exc
    name = _info_text(info, b"name.utf-8", b"name")
    files: list[dict] = []
    if b"files" in info:
        for item in info[b"files"]:
            parts = item.get(b"path.utf-8") or item.get(b"path") or []
            rel = "/".join(_decode_torrent_text(part) for part in parts)
            path = f"{name}/{rel}" if name else rel
            files.append({"path": path, "size": int(item.get(b"length") or 0)})
    else:
        files.append({"path": name or "file", "size": int(info.get(b"length") or 0)})
    return name or "magnet", files


def _default_wanted(files: list[dict]) -> list[bool]:
    flags = []
    for item in files:
        suffix = Path(item["path"]).suffix.lower()
        size = int(item.get("size") or 0)
        flags.append(suffix in _VIDEO_EXTS and size >= 50 * 1024 * 1024)
    if not any(flags):
        flags = [Path(item["path"]).suffix.lower() in _VIDEO_EXTS for item in files]
    if not any(flags):
        flags = [True] * len(files)
    return flags


def _magnet_parse_result(
    link: str,
    info_hash: str,
    folder: dict,
    *,
    name: str,
    files: list[dict],
    selectable: bool,
    message: str = "",
) -> dict:
    wanted_flags = _default_wanted(files) if selectable else [True] * len(files)
    return {
        "magnet": link,
        "info_hash": info_hash,
        "name": name,
        "parsed": True,
        "selectable": selectable,
        "message": message,
        **folder,
        "files": [
            {
                "index": index,
                "path": item["path"],
                "size": int(item.get("size") or 0),
                "wanted": wanted_flags[index] if index < len(wanted_flags) else True,
            }
            for index, item in enumerate(files)
        ],
    }


async def _fetch_cached_torrent_bytes(info_hash: str) -> bytes:
    expected = (info_hash or "").strip().lower()
    if not expected:
        raise P115Error("缺少 infohash")
    last_error = "未找到种子缓存"
    fake_count = 0
    seen_urls: set[str] = set()
    async with httpx.AsyncClient(
        headers={
            "User-Agent": P115_HEADERS["User-Agent"],
            "Accept": "*/*",
        },
        timeout=5.0,
        follow_redirects=True,
    ) as client:
        for template in _TORRENT_CACHE_URLS:
            for digest in (expected.upper(), expected):
                url = template.format(hash=digest)
                if url in seen_urls:
                    continue
                seen_urls.add(url)
                try:
                    response = await client.get(url)
                    if response.status_code != 200:
                        last_error = f"{url} HTTP {response.status_code}"
                        continue
                    data = _maybe_decompress_torrent(response.content or b"")
                    if not (data.startswith(b"d") and b"4:info" in data):
                        last_error = f"{url} 返回的不是种子"
                        continue
                    got = torrent_infohash(data)
                    if got != expected:
                        fake_count += 1
                        last_error = f"{url} 返回假种子（infohash 不匹配）"
                        break
                    return data
                except P115Error as exc:
                    last_error = str(exc)
                    continue
                except Exception as exc:
                    last_error = str(exc)
                    continue
            if fake_count:
                break
    if fake_count:
        raise P115Error(f"公共缓存为假种子：{last_error}")
    raise P115Error(f"无法根据磁力获取种子文件: {last_error}")


async def _fetch_torrent_bytes(info_hash: str, magnet: str = "") -> bytes:
    from app.integrations.magnet_meta import MagnetMetaError, fetch_magnet_info_bytes, wrap_info_as_torrent

    expected = (info_hash or "").strip().lower()
    try:
        return await _fetch_cached_torrent_bytes(expected)
    except P115Error as cache_error:
        cache_message = str(cache_error)
    try:
        info_bytes = await fetch_magnet_info_bytes(
            expected,
            magnet or f"magnet:?xt=urn:btih:{expected}",
            timeout=16,
        )
        return wrap_info_as_torrent(info_bytes)
    except MagnetMetaError as exc:
        raise P115Error(f"{cache_message}；{exc}") from exc
    except Exception as exc:
        raise P115Error(f"{cache_message}；{exc}") from exc


async def parse_magnet(link: str, user_settings: dict | None = None) -> dict:
    if is_ed2k_link(link):
        ed2k = parse_ed2k_link(link)
        cfg = _cfg(user_settings)
        folder = {
            "folder_cid": _folder_cid(user_settings),
            "folder_path": cfg.get("p115_folder_path") or "",
        }
        if not ed2k:
            return {
                "magnet": (link or "").strip(),
                "info_hash": "",
                "name": "",
                "parsed": False,
                "selectable": False,
                "message": "无法解析 ed2k 链接，请确认格式为 ed2k://|file|文件名|大小|哈希|/",
                **folder,
                "files": [],
            }
        return _magnet_parse_result(
            ed2k["link"],
            ed2k["hash"].lower(),
            folder,
            name=ed2k["name"],
            files=[{"path": ed2k["name"], "size": ed2k["size"]}],
            selectable=False,
            message="ed2k 为单文件，确认后将整条推送",
        )
    if not is_magnet_link(link):
        raise P115Error("仅支持 magnet / ed2k 链接")
    info_hash = extract_infohash(link)
    cfg = _cfg(user_settings)
    folder = {
        "folder_cid": _folder_cid(user_settings),
        "folder_path": cfg.get("p115_folder_path") or "",
    }
    try:
        raw = await _fetch_cached_torrent_bytes(info_hash)
    except P115Error:
        raw = None
    if raw is None:
        from app.integrations.magnet_meta import (
            MagnetMetaError,
            fetch_crawler_filelist,
            fetch_index_preview,
            fetch_magnet_info_bytes,
            wrap_info_as_torrent,
        )

        dht_task = asyncio.create_task(fetch_magnet_info_bytes(info_hash, link, timeout=16))
        crawler_task = asyncio.create_task(fetch_crawler_filelist(info_hash))
        preview_task = asyncio.create_task(fetch_index_preview(link))
        pending = {dht_task, crawler_task, preview_task}
        info_bytes = None
        crawler = None
        preview = None
        dht_error: Exception | None = None
        deadline = asyncio.get_running_loop().time() + 18
        while pending:
            timeout = max(0.05, deadline - asyncio.get_running_loop().time())
            done, pending = await asyncio.wait(
                pending,
                timeout=timeout,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if not done:
                break
            for task in done:
                try:
                    value = task.result()
                except Exception as exc:
                    if task is dht_task:
                        dht_error = exc
                    continue
                if task is dht_task and isinstance(value, bytes):
                    info_bytes = value
                elif task is crawler_task and isinstance(value, dict) and value.get("files"):
                    crawler = value
                elif task is preview_task and isinstance(value, dict) and value:
                    preview = value
            if info_bytes or crawler:
                for task in pending:
                    task.cancel()
                break
        if pending:
            for task in pending:
                task.cancel()

        if info_bytes:
            raw = wrap_info_as_torrent(info_bytes)
        elif crawler:
            return _magnet_parse_result(
                link,
                info_hash,
                folder,
                name=crawler["name"],
                files=crawler["files"],
                selectable=True,
                message="",
            )
        elif preview:
            count = int(preview.get("count") or 0)
            name = preview["name"]
            path = name if count <= 1 else f"{name}/（共 {count} 个文件）"
            return _magnet_parse_result(
                link,
                info_hash,
                folder,
                name=name,
                files=[{"path": path, "size": int(preview.get("size") or 0)}],
                selectable=False,
                message="已从磁力索引得到任务名；未能列出内部文件，确认后将整条推送",
            )
        message = "未能解析磁力"
        if isinstance(dht_error, MagnetMetaError):
            message = str(dht_error)
        elif dht_error:
            message = str(dht_error)
        return {
            "magnet": link,
            "info_hash": info_hash,
            "name": "",
            "parsed": False,
            "selectable": False,
            "message": message,
            **folder,
            "files": [],
        }
    try:
        name, files = parse_torrent_files(raw)
    except P115Error as exc:
        return {
            "magnet": link,
            "info_hash": info_hash,
            "name": "",
            "parsed": False,
            "selectable": False,
            "message": str(exc),
            **folder,
            "files": [],
        }
    return _magnet_parse_result(
        link,
        info_hash,
        folder,
        name=name,
        files=files,
        selectable=True,
        message="",
    )


async def push_magnet_files(
    link: str,
    *,
    info_hash: str = "",
    wanted: list[int] | None = None,
    user_settings: dict | None = None,
) -> P115PushResult:
    if not is_offline_link(link):
        raise P115Error("仅支持 magnet / ed2k 链接")
    if is_ed2k_link(link):
        return await push_magnet(link, user_settings)
    digest = (info_hash or extract_infohash(link)).lower()
    selected = sorted({int(index) for index in (wanted or []) if int(index) >= 0})
    cfg = _cfg(user_settings)
    folder_cid = _folder_cid(user_settings)

    async with _build_client(user_settings) as client:
        cookies = _parse_cookies(cfg["p115_cookie"])
        uid = _extract_uid(cookies)
        sign, offline_time = await _get_offline_signature(client, uid)
        payload = {
            "info_hash": digest,
            "wanted": ",".join(str(index) for index in selected) if selected else "",
            "savepath": "",
            "wp_path_id": folder_cid,
            "uid": uid,
            "sign": sign,
            "time": offline_time,
        }

        if selected:
            response = await client.post(
                "https://115.com/lixian/",
                params={"ct": "lixian", "ac": "add_task_bt"},
                data=payload,
            )
            try:
                data = response.json()
            except Exception:
                data = {}
            if data.get("state"):
                return P115PushResult(
                    link=link,
                    success=True,
                    task_name=data.get("name") or digest,
                    message="推送成功",
                )
            alt = await client.post(
                "https://clouddownload.115.com/lixianssp/",
                params={"ac": "add_task_bt"},
                data=payload,
            )
            try:
                alt_data = alt.json()
            except Exception:
                alt_data = {}
            if alt_data.get("state"):
                return P115PushResult(
                    link=link,
                    success=True,
                    task_name=alt_data.get("name") or digest,
                    message="推送成功",
                )
            fallback_message = (
                data.get("error_msg")
                or alt_data.get("error_msg")
                or alt_data.get("message")
                or "按文件推送失败，将尝试整条磁力"
            )
            whole = await push_magnet(link, user_settings)
            if whole.success:
                whole.message = f"已整条推送（{fallback_message}）"
            return whole

        return await push_magnet(link, user_settings)


async def list_folders(cid: str = "0", user_settings: dict | None = None) -> dict:
    current = str(cid or "0").strip() or "0"
    async with _build_client(user_settings) as client:
        response = await client.get(
            "https://webapi.115.com/files",
            params={
                "aid": 1,
                "cid": current,
                "o": "user_ptime",
                "asc": 0,
                "offset": 0,
                "show_dir": 1,
                "limit": 200,
                "natsort": 1,
                "format": "json",
            },
        )
        try:
            data = response.json()
        except Exception as exc:
            raise P115Error("读取 115 目录失败") from exc
        if not data.get("state"):
            raise P115Error(data.get("error") or data.get("message") or "读取 115 目录失败")

        folders = []
        for item in data.get("data") or []:
            if "fid" in item:
                continue
            item_cid = str(item.get("cid") or "")
            if not item_cid:
                continue
            name = item.get("n") or item.get("name") or item_cid
            folders.append({"name": name, "cid": item_cid})

        path_parts = data.get("path") or []
        names = [
            part.get("name") or part.get("n") or ""
            for part in path_parts
            if str(part.get("cid", "0")) != "0"
        ]
        current_path = "/" + "/".join(name for name in names if name) if names else "/"
        parent_cid = None
        if len(path_parts) > 1:
            parent_cid = str(path_parts[-2].get("cid") or "0")
        elif current != "0":
            parent_cid = "0"
        return {
            "current_cid": current,
            "current_path": current_path,
            "parent_cid": parent_cid,
            "folders": folders,
        }
