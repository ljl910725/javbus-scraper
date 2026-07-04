from app.config import settings


DEFAULT_USER_SETTINGS = {
    "push_backend": "cd2",
    "cd2_host": "localhost:19798",
    "cd2_auth_mode": "password",
    "cd2_username": "",
    "cd2_password": "",
    "cd2_token": "",
    "cd2_offline_folder": "",
    "cd2_push_folders": [],
    "p115_cookie": "",
    "proxy_enabled": False,
    "http_proxy": "",
    "https_proxy": "",
    "translate_engine": "free",
    "translate_target_lang": "zh-CN",
    "ai_translate_base_url": "https://api.openai.com/v1",
    "ai_translate_api_key": "",
    "ai_translate_model": "gpt-4o-mini",
}

USER_SETTING_KEYS = frozenset(DEFAULT_USER_SETTINGS.keys())
SECRET_SETTING_KEYS = frozenset(
    {"cd2_password", "cd2_token", "p115_cookie", "ai_translate_api_key"}
)
PROXY_SETTING_KEYS = frozenset({"proxy_enabled", "http_proxy", "https_proxy"})


def proxy_active(settings_data: dict) -> bool:
    if not settings_data.get("proxy_enabled"):
        return False
    return bool((settings_data.get("http_proxy") or "").strip() or (settings_data.get("https_proxy") or "").strip())


def effective_proxies(settings_data: dict) -> tuple[str | None, str | None]:
    if not proxy_active(settings_data):
        return None, None
    http = (settings_data.get("http_proxy") or "").strip() or None
    https = (settings_data.get("https_proxy") or "").strip() or None
    return http, https


def normalize_push_folders(settings_data: dict) -> list[dict]:
    folders = settings_data.get("cd2_push_folders")
    if isinstance(folders, list) and folders:
        normalized: list[dict] = []
        for index, item in enumerate(folders):
            if not isinstance(item, dict):
                continue
            path = (item.get("path") or "").strip()
            if not path:
                continue
            folder_id = (item.get("id") or "").strip() or f"folder-{index + 1}"
            name = (item.get("name") or "").strip() or path.rstrip("/").split("/")[-1] or f"目录{index + 1}"
            normalized.append({"id": folder_id, "name": name, "path": path})
        return normalized

    legacy = (settings_data.get("cd2_offline_folder") or "").strip()
    if legacy:
        return [{"id": "default", "name": "默认", "path": legacy}]
    return []


def env_defaults() -> dict:
    return {
        "push_backend": settings.push_backend,
        "cd2_host": settings.cd2_host,
        "cd2_auth_mode": settings.cd2_auth_mode,
        "cd2_username": settings.cd2_username,
        "cd2_password": settings.cd2_password,
        "cd2_token": settings.cd2_token,
        "cd2_offline_folder": settings.cd2_offline_folder,
        "cd2_push_folders": [],
        "p115_cookie": settings.p115_cookie or "",
        "proxy_enabled": settings.proxy_enabled,
        "http_proxy": settings.http_proxy or "",
        "https_proxy": settings.https_proxy or "",
        "translate_engine": settings.translate_engine,
        "translate_target_lang": settings.translate_target_lang,
        "ai_translate_base_url": settings.ai_translate_base_url,
        "ai_translate_api_key": settings.ai_translate_api_key or "",
        "ai_translate_model": settings.ai_translate_model,
    }


def apply_settings_update(current: dict | None, updates: dict) -> dict:
    stored = dict(current or {})

    for key, value in updates.items():
        if key not in USER_SETTING_KEYS:
            continue
        if key in SECRET_SETTING_KEYS and (value == "***" or value == ""):
            continue
        if key == "cd2_push_folders" and isinstance(value, list):
            stored[key] = value
            continue
        if value is not None:
            stored[key] = value

    stored["cd2_push_folders"] = normalize_push_folders(stored)
    if stored["cd2_push_folders"]:
        stored["cd2_offline_folder"] = stored["cd2_push_folders"][0]["path"]
    else:
        stored["cd2_offline_folder"] = (stored.get("cd2_offline_folder") or "").strip()

    return stored


def merge_settings(user_settings: dict | None = None) -> dict:
    merged = {**DEFAULT_USER_SETTINGS, **env_defaults()}
    if user_settings:
        for key, value in user_settings.items():
            if key not in USER_SETTING_KEYS:
                continue
            if value is None:
                continue
            if key == "cd2_push_folders" and isinstance(value, list):
                merged[key] = value
                continue
            if key in PROXY_SETTING_KEYS:
                merged[key] = value
                continue
            if value != "":
                merged[key] = value
    merged["cd2_push_folders"] = normalize_push_folders(merged)
    if merged["cd2_push_folders"]:
        merged["cd2_offline_folder"] = merged["cd2_push_folders"][0]["path"]
    else:
        merged["cd2_offline_folder"] = (merged.get("cd2_offline_folder") or "").strip()
    return merged


def public_settings(settings_data: dict) -> dict:
    result = {}
    for key in USER_SETTING_KEYS:
        value = settings_data.get(key, DEFAULT_USER_SETTINGS.get(key, ""))
        if key in SECRET_SETTING_KEYS and value:
            result[key] = "***"
        else:
            result[key] = value
    result["cd2_push_folders"] = normalize_push_folders(settings_data)
    return result
