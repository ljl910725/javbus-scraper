from urllib.parse import urlsplit


def require_site_url(url: str, base_url: str, site_name: str) -> None:
    # 字幕地址由浏览器传上来，只认该字幕站自己的网址，防止别人借接口读内网页面
    parts = urlsplit(url or "")
    host = (parts.hostname or "").lower()
    site = (urlsplit(base_url).hostname or "").removeprefix("www.")
    if parts.scheme not in {"http", "https"} or not (host == site or host.endswith(f".{site}")):
        raise ValueError(f"字幕地址不是 {site_name} 的网址")
