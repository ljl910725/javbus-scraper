import asyncio
import re
from dataclasses import dataclass

from clouddrive2_client import CloudDriveClient
from clouddrive2_client.proto import clouddrive_pb2

from app.user_settings import merge_settings, normalize_push_folders


class CD2Error(Exception):
    pass


class CD2NotConfiguredError(CD2Error):
    pass


@dataclass
class CD2PushResult:
    link: str
    success: bool
    message: str = ""
    task_name: str = ""


def _normalize_host(host: str) -> str:
    value = (host or "").strip()
    if value.startswith("https://"):
        value = value[8:]
    elif value.startswith("http://"):
        value = value[7:]
    return value.rstrip("/")


def _cfg(user_settings: dict | None = None) -> dict:
    merged = merge_settings(user_settings)
    if merged.get("cd2_host"):
        merged = {**merged, "cd2_host": _normalize_host(merged["cd2_host"])}
    return merged


def _auth_mode(cfg: dict) -> str:
    return cfg.get("cd2_auth_mode") or "password"


def _is_configured(cfg: dict) -> bool:
    if not cfg.get("cd2_host"):
        return False
    if _auth_mode(cfg) == "token":
        return bool(cfg.get("cd2_token"))
    return bool(cfg.get("cd2_username") and cfg.get("cd2_password"))


def _normalize_folder_path(path: str) -> str:
    normalized = (path or "/").strip() or "/"
    if normalized != "/" and not normalized.startswith("/"):
        normalized = f"/{normalized}"
    return normalized.rstrip("/") or "/"


def _parent_path(path: str) -> str | None:
    normalized = _normalize_folder_path(path)
    if normalized == "/":
        return None
    parts = normalized.strip("/").split("/")
    if len(parts) <= 1:
        return "/"
    return "/" + "/".join(parts[:-1])


def _authenticate_client(client: CloudDriveClient, cfg: dict) -> None:
    if _auth_mode(cfg) == "token":
        token = (cfg.get("cd2_token") or "").strip()
        if not token:
            raise CD2Error("未填写 CD2 API 令牌")
        client.jwt_token = token
        try:
            client.get_service_capabilities()
        except Exception as exc:
            host = _normalize_host(cfg.get("cd2_host", ""))
            hint = "（地址请使用 host:port，勿加 http://）" if "http" in (cfg.get("cd2_host") or "") else ""
            raise CD2Error(f"CD2 令牌无效或无法连接 {host}: {exc}{hint}") from exc
        return

    username = cfg.get("cd2_username") or ""
    password = cfg.get("cd2_password") or ""
    if not username or not password:
        raise CD2Error("未填写 CD2 用户名或密码")
    if not client.authenticate(username, password):
        raise CD2Error("CD2 认证失败，请检查用户名和密码")


def _format_grpc_error(exc: Exception) -> str:
    text = str(exc)
    match = re.search(r'not found "([^"]+)" under "([^"]*)"', text, re.IGNORECASE)
    if match:
        name, parent = match.groups()
        parent_label = parent or "/"
        return f"路径节点「{name}」在「{parent_label}」下不存在"
    if "NOT_FOUND" in text:
        return "目录不存在"
    if "PERMISSION_DENIED" in text:
        return "权限不足"
    if "UNAVAILABLE" in text:
        return "无法连接到 CD2 服务"
    first_line = text.splitlines()[0] if text else "未知错误"
    return first_line[:200]


def _get_root_mount_hints(client: CloudDriveClient) -> str:
    try:
        mounts: list[str] = []
        for item in client.get_sub_files("/"):
            if not getattr(item, "isDirectory", False):
                continue
            full_path = getattr(item, "fullPathName", "") or ""
            name = getattr(item, "name", "") or full_path.strip("/")
            mounts.append(full_path or f"/{name}")
        if mounts:
            return f"请使用「浏览目录」选择，当前根目录挂载: {', '.join(mounts)}"
    except Exception:
        pass
    return "请使用「浏览目录」从根目录选择支持离线下载的推送路径"


def _create_client(user_settings: dict | None = None) -> CloudDriveClient:
    cfg = _cfg(user_settings)
    if not _is_configured(cfg):
        raise CD2NotConfiguredError("未配置 CD2，请在设置页填写 CD2 连接信息")

    client = CloudDriveClient(cfg["cd2_host"])
    try:
        _authenticate_client(client, cfg)
    except CD2Error:
        client.close()
        raise
    return client


def _check_offline_folder(client: CloudDriveClient, folder_path: str) -> tuple[bool, str]:
    folder = _normalize_folder_path(folder_path)
    if folder == "/":
        return False, "请指定具体的推送目录"

    try:
        info = client.find_file_by_path(folder)
    except Exception as exc:
        detail = _format_grpc_error(exc)
        hint = _get_root_mount_hints(client)
        return False, f"{detail}。{hint}"

    if not info or not getattr(info, "fullPathName", None):
        return False, f"目录不存在。{_get_root_mount_hints(client)}"

    if not getattr(info, "isDirectory", False):
        return False, "路径不是目录"

    if not getattr(info, "canOfflineDownload", False):
        return False, "该目录不支持离线下载，请选择标记为「可离线」的目录"

    return True, "目录可用"


def _get_push_folders(cfg: dict) -> list[dict]:
    return normalize_push_folders(cfg)


def resolve_push_folder(cfg: dict, folder_id: str | None = None) -> tuple[str, dict]:
    folders = _get_push_folders(cfg)
    if not folders:
        raise CD2Error("未配置推送目录，请在设置页添加目录映射")

    if folder_id:
        for folder in folders:
            if folder["id"] == folder_id:
                return folder["path"], folder
        raise CD2Error(f"未找到推送目录「{folder_id}」")

    if len(folders) == 1:
        return folders[0]["path"], folders[0]

    raise CD2Error("请选择推送目录")


def _validate_push_folders(client: CloudDriveClient, cfg: dict) -> list[dict]:
    results: list[dict] = []
    for folder in _get_push_folders(cfg):
        valid, message = _check_offline_folder(client, folder["path"])
        results.append(
            {
                "id": folder["id"],
                "name": folder["name"],
                "path": folder["path"],
                "valid": valid,
                "message": message if valid else message,
            }
        )
    return results


def _is_duplicate_offline_error(message: str) -> bool:
    text = message or ""
    markers = ("10008", "已存在", "重复", "already exists", "duplicate")
    return any(marker.lower() in text.lower() for marker in markers)


def _push_result_from_response(
    link: str,
    response,
    folder: dict,
    target_folder: str,
) -> CD2PushResult:
    if response.success:
        task_name = response.resultFilePaths[0] if response.resultFilePaths else link
        return CD2PushResult(
            link=link,
            success=True,
            task_name=task_name,
            message=f"已添加到 {folder['name']} ({target_folder})",
        )

    error_message = response.errorMessage or "CD2 推送失败"
    if _is_duplicate_offline_error(error_message):
        return CD2PushResult(
            link=link,
            success=True,
            message=f"任务已存在，此前已推送到 {folder['name']} ({target_folder})",
        )

    return CD2PushResult(
        link=link,
        success=False,
        message=error_message,
    )


def _push_magnet_sync(
    link: str,
    user_settings: dict | None = None,
    folder_id: str | None = None,
) -> CD2PushResult:
    if not link.startswith("magnet:"):
        raise CD2Error("仅支持 magnet 链接")

    cfg = _cfg(user_settings)
    target_folder, folder = resolve_push_folder(cfg, folder_id)
    client = _create_client(user_settings)
    try:
        request = clouddrive_pb2.AddOfflineFileRequest(
            urls=link,
            toFolder=target_folder,
        )
        try:
            response = client.stub.AddOfflineFiles(
                request,
                metadata=client._create_authorized_metadata(),
            )
            return _push_result_from_response(link, response, folder, target_folder)
        except Exception as exc:
            error_text = str(exc)
            if _is_duplicate_offline_error(error_text):
                return CD2PushResult(
                    link=link,
                    success=True,
                    message=f"任务已存在，此前已推送到 {folder['name']} ({target_folder})",
                )
            raise CD2Error(error_text) from exc
    finally:
        client.close()


def _push_magnets_sync(
    links: list[str],
    user_settings: dict | None = None,
    folder_id: str | None = None,
) -> list[CD2PushResult]:
    cfg = _cfg(user_settings)
    target_folder, folder = resolve_push_folder(cfg, folder_id)
    client = _create_client(user_settings)
    try:
        request = clouddrive_pb2.AddOfflineFileRequest(
            urls="\n".join(links),
            toFolder=target_folder,
        )
        try:
            response = client.stub.AddOfflineFiles(
                request,
                metadata=client._create_authorized_metadata(),
            )
        except Exception as exc:
            error_text = str(exc)
            if _is_duplicate_offline_error(error_text):
                return [
                    CD2PushResult(
                        link=link,
                        success=True,
                        message=f"任务已存在，此前已推送到 {folder['name']} ({target_folder})",
                    )
                    for link in links
                ]
            raise CD2Error(error_text) from exc

        if response.success:
            return [
                CD2PushResult(
                    link=link,
                    success=True,
                    message=f"已添加到 {folder['name']} ({target_folder})",
                )
                for link in links
            ]

        error_message = response.errorMessage or "CD2 批量推送失败"
        if _is_duplicate_offline_error(error_message):
            return [
                CD2PushResult(
                    link=link,
                    success=True,
                    message=f"任务已存在，此前已推送到 {folder['name']} ({target_folder})",
                )
                for link in links
            ]

        return [
            CD2PushResult(
                link=link,
                success=False,
                message=error_message,
            )
            for link in links
        ]
    finally:
        client.close()


def _check_status_sync(user_settings: dict | None = None) -> dict:
    cfg = _cfg(user_settings)
    if not _is_configured(cfg):
        return {
            "configured": False,
            "connected": False,
            "auth_mode": _auth_mode(cfg),
            "message": "未配置 CD2",
        }

    client: CloudDriveClient | None = None
    try:
        client = _create_client(user_settings)
        info = client.get_system_info()
        folder_results = _validate_push_folders(client, cfg)
        folder_valid = any(item["valid"] for item in folder_results)
        valid_count = sum(1 for item in folder_results if item["valid"])
        total_count = len(folder_results)
        offline_folder = cfg.get("cd2_offline_folder") or ""

        message = "已连接"
        if not folder_results:
            message = f"已连接，请配置推送目录。{_get_root_mount_hints(client)}"
        elif not folder_valid:
            message = f"已连接，但 {total_count} 个推送目录均不可用，请检查配置"
        elif valid_count < total_count:
            message = f"已连接，{valid_count}/{total_count} 个推送目录可用"
        else:
            message = f"已连接，{valid_count} 个推送目录可用"

        return {
            "configured": True,
            "connected": True,
            "host": cfg["cd2_host"],
            "auth_mode": _auth_mode(cfg),
            "offline_folder": offline_folder,
            "push_folders": folder_results,
            "version": getattr(info, "version", "") or "",
            "folder_valid": folder_valid,
            "message": message,
        }
    except CD2Error as exc:
        return {
            "configured": True,
            "connected": False,
            "host": cfg["cd2_host"],
            "auth_mode": _auth_mode(cfg),
            "offline_folder": cfg.get("cd2_offline_folder") or "",
            "push_folders": [],
            "folder_valid": False,
            "message": str(exc),
        }
    except Exception as exc:
        return {
            "configured": True,
            "connected": False,
            "host": cfg["cd2_host"],
            "auth_mode": _auth_mode(cfg),
            "offline_folder": cfg.get("cd2_offline_folder") or "",
            "push_folders": [],
            "folder_valid": False,
            "message": f"CD2 连接失败: {exc}",
        }
    finally:
        if client is not None:
            client.close()


def _list_folders_sync(path: str, user_settings: dict | None = None) -> dict:
    cfg = _cfg(user_settings)
    if not _is_configured(cfg):
        raise CD2NotConfiguredError("未配置 CD2")

    current_path = _normalize_folder_path(path)
    list_path = current_path if current_path.endswith("/") else f"{current_path}/"

    client = _create_client(user_settings)
    try:
        folders: list[dict] = []
        for item in client.get_sub_files(list_path):
            if not getattr(item, "isDirectory", False):
                continue
            full_path = getattr(item, "fullPathName", "") or ""
            name = getattr(item, "name", "") or full_path.rstrip("/").split("/")[-1]
            folders.append(
                {
                    "name": name,
                    "path": full_path,
                    "can_offline": bool(getattr(item, "canOfflineDownload", False)),
                }
            )
        folders.sort(key=lambda row: row["name"].lower())
        return {
            "current_path": current_path,
            "parent_path": _parent_path(current_path),
            "folders": folders,
            "message": "ok",
        }
    except CD2Error as exc:
        raise
    except Exception as exc:
        raise CD2Error(f"读取目录失败: {_format_grpc_error(exc)}") from exc
    finally:
        client.close()


def build_cd2_config(base_settings: dict | None, overrides: dict | None = None) -> dict:
    cfg = merge_settings(base_settings)
    if not overrides:
        return cfg

    secret_fields = {"cd2_password", "cd2_token", "p115_cookie", "ai_translate_api_key"}
    for key, value in overrides.items():
        if value is None:
            continue
        if key in secret_fields and value in ("", "***"):
            continue
        cfg[key] = value
    cfg["cd2_push_folders"] = normalize_push_folders(cfg)
    if cfg["cd2_push_folders"]:
        cfg["cd2_offline_folder"] = cfg["cd2_push_folders"][0]["path"]
    return cfg


async def check_cd2_status(user_settings: dict | None = None) -> dict:
    return await asyncio.to_thread(_check_status_sync, user_settings)


async def list_cd2_folders(path: str, user_settings: dict | None = None) -> dict:
    return await asyncio.to_thread(_list_folders_sync, path, user_settings)


async def push_magnet(
    link: str,
    user_settings: dict | None = None,
    folder_id: str | None = None,
) -> CD2PushResult:
    return await asyncio.to_thread(_push_magnet_sync, link, user_settings, folder_id)


async def push_magnets(
    links: list[str],
    user_settings: dict | None = None,
    folder_id: str | None = None,
) -> list[CD2PushResult]:
    unique_links: list[str] = []
    seen: set[str] = set()
    for link in links:
        if link not in seen:
            seen.add(link)
            unique_links.append(link)

    if not unique_links:
        raise CD2Error("磁力链接列表不能为空")

    if len(unique_links) == 1:
        return [await push_magnet(unique_links[0], user_settings, folder_id)]

    return await asyncio.to_thread(_push_magnets_sync, unique_links, user_settings, folder_id)
