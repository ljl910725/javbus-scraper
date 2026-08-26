from dataclasses import dataclass

from app.config import settings as app_settings
from app.integrations import cd2, p115
from app.user_settings import merge_settings


@dataclass
class PushResult:
    link: str
    success: bool
    message: str = ""
    task_name: str = ""
    backend: str = ""


def _resolve_settings(user_settings: dict | None = None) -> dict:
    return merge_settings(user_settings)


def active_backend(user_settings: dict | None = None) -> str:
    cfg = _resolve_settings(user_settings)
    if cfg.get("push_backend") == "cd2" and _cd2_configured(cfg):
        return "cd2"
    if cfg.get("push_backend") == "p115" and _p115_configured(cfg):
        return "p115"
    if _cd2_configured(cfg):
        return "cd2"
    if _p115_configured(cfg):
        return "p115"
    return ""


def _cd2_configured(cfg: dict) -> bool:
    if not cfg.get("cd2_host"):
        return False
    if cfg.get("cd2_auth_mode") == "token":
        return bool(cfg.get("cd2_token"))
    return bool(cfg.get("cd2_username") and cfg.get("cd2_password"))


def _p115_configured(cfg: dict) -> bool:
    return bool(cfg.get("p115_cookie"))


def backend_label(user_settings: dict | None = None) -> str:
    backend = active_backend(user_settings)
    if backend == "cd2":
        return "CD2"
    if backend == "p115":
        return "115"
    return "网盘"


def default_folder_id(user_settings: dict | None = None) -> str | None:
    cfg = _resolve_settings(user_settings)
    if active_backend(cfg) != "cd2":
        return None
    folders = cfg.get("cd2_push_folders") or []
    if not folders:
        return None
    folder_id = str(folders[0].get("id") or "").strip()
    return folder_id or None


def folder_meta(user_settings: dict | None = None, folder_id: str | None = None) -> dict:
    cfg = _resolve_settings(user_settings)
    backend = active_backend(cfg)
    target_id = folder_id or default_folder_id(cfg)
    if backend == "p115":
        path = cfg.get("p115_folder_path") or ""
        return {
            "folder_id": cfg.get("p115_folder_cid") or target_id or "",
            "folder_name": path.rstrip("/").split("/")[-1] if path else "",
            "folder_path": path,
        }
    if backend == "cd2":
        try:
            _, folder = cd2.resolve_push_folder(cfg, target_id)
            return {
                "folder_id": folder.get("id") or target_id or "",
                "folder_name": folder.get("name") or "",
                "folder_path": folder.get("path") or "",
            }
        except cd2.CD2Error:
            return {"folder_id": target_id or "", "folder_name": "", "folder_path": ""}
    return {"folder_id": target_id or "", "folder_name": "", "folder_path": ""}


async def check_push_status(user_settings: dict | None = None) -> dict:
    cfg = _resolve_settings(user_settings)
    p115_info = {
        "p115_ready": False,
        "p115_user_name": "",
        "p115_folder_cid": cfg.get("p115_folder_cid") or "",
        "p115_folder_path": cfg.get("p115_folder_path") or "",
    }
    if _p115_configured(cfg):
        try:
            status = await p115.check_p115_status(user_settings)
            p115_info["p115_ready"] = bool(status.get("logged_in", False))
            p115_info["p115_user_name"] = status.get("user_name") or ""
        except Exception:
            p115_info["p115_ready"] = False

    backend = active_backend(user_settings)
    if backend == "cd2":
        status = await cd2.check_cd2_status(user_settings)
        status["backend"] = "cd2"
        status["ready"] = bool(
            status.get("connected", False) and status.get("folder_valid", False)
        )
        status.update(p115_info)
        return status
    if backend == "p115":
        status = await p115.check_p115_status(user_settings)
        return {
            "backend": "p115",
            "ready": status.get("logged_in", False),
            "configured": status.get("configured", False),
            "user_name": status.get("user_name", ""),
            "message": status.get("message", ""),
            "push_folders": [],
            **p115_info,
            "p115_ready": bool(status.get("logged_in", False)),
            "p115_user_name": status.get("user_name") or "",
        }
    return {
        "backend": "",
        "ready": False,
        "configured": False,
        "message": "未配置推送方式，请在设置页配置 CD2 或 115 Cookie",
        "push_folders": [],
        **p115_info,
    }


async def push_magnet(
    link: str,
    user_settings: dict | None = None,
    folder_id: str | None = None,
) -> PushResult:
    backend = active_backend(user_settings)
    if backend == "cd2":
        result = await cd2.push_magnet(link, user_settings, folder_id)
        return PushResult(
            link=result.link,
            success=result.success,
            message=result.message,
            task_name=result.task_name,
            backend="cd2",
        )
    if backend == "p115":
        result = await p115.push_magnet(link, user_settings)
        return PushResult(
            link=result.link,
            success=result.success,
            message=result.message,
            task_name=result.task_name,
            backend="p115",
        )
    raise cd2.CD2NotConfiguredError("未配置推送方式")


async def push_magnets(
    links: list[str],
    user_settings: dict | None = None,
    folder_id: str | None = None,
) -> list[PushResult]:
    backend = active_backend(user_settings)
    if backend == "cd2":
        results = await cd2.push_magnets(links, user_settings, folder_id)
        return [
            PushResult(
                link=r.link,
                success=r.success,
                message=r.message,
                task_name=r.task_name,
                backend="cd2",
            )
            for r in results
        ]
    if backend == "p115":
        results = await p115.push_magnets(links, user_settings)
        return [
            PushResult(
                link=r.link,
                success=r.success,
                message=r.message,
                task_name=r.task_name,
                backend="p115",
            )
            for r in results
        ]
    raise cd2.CD2NotConfiguredError("未配置推送方式")
