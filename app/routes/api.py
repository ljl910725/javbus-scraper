from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.config import settings
from app.models import (
    BatchError,
    BatchRequest,
    BatchResponse,
    CD2ConnectRequest,
    CD2FoldersRequest,
    CD2FoldersResponse,
    CD2StatusResponse,
    ConfigResponse,
    MovieInfo,
    P115StatusResponse,
    Push115ItemResult,
    Push115Request,
    Push115Response,
    PushHistoryItem,
    PushHistoryResponse,
    PushStatusResponse,
)
from app.user_settings import merge_settings, proxy_active
from app import db
from app.deps import CurrentUser, OptionalUser
from app.scraper.client import get_client
from app.scraper.service import ScrapeError, scrape_movie, scrape_movies_batch
from app.integrations import cd2, p115, push as push_service
from app.integrations.cd2 import CD2Error, CD2NotConfiguredError
from app.integrations.p115 import P115Error, P115NotConfiguredError

router = APIRouter(prefix="/api")


def _guess_media_type(url: str) -> str:
    lower = url.lower().split("?")[0]
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".webp"):
        return "image/webp"
    return "image/jpeg"


@router.get("/cover/proxy")
async def proxy_cover(
    url: str = Query(..., description="封面图片 URL"),
    referer: str = Query("", description="来源页 Referer"),
    user: OptionalUser = None,
) -> Response:
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="无效的图片 URL")

    try:
        client = get_client(_user_settings(user))
        content = await client.download(
            url,
            referer=referer or settings.base_url.rstrip("/"),
        )
        return Response(
            content=content,
            media_type=_guess_media_type(url),
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"封面加载失败: {exc}") from exc


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/config", response_model=ConfigResponse)
async def get_config(user: OptionalUser = None) -> ConfigResponse:
    cfg = merge_settings(_user_settings(user))
    return ConfigResponse(
        base_url=settings.base_url,
        proxy_enabled=proxy_active(cfg),
        cover_dir=settings.cover_dir,
        p115_configured=bool(cfg.get("p115_cookie")),
        cd2_configured=settings.cd2_configured,
        push_backend=push_service.active_backend(_user_settings(user)),
    )


def _user_settings(user: dict | None) -> dict | None:
    if not user:
        return None
    return db.get_user_settings(user["id"])


def _folder_meta(user_cfg: dict | None, folder_id: str | None, backend: str) -> dict:
    if backend != "cd2" or not user_cfg:
        return {"folder_id": folder_id or "", "folder_name": "", "folder_path": ""}
    try:
        cfg = merge_settings(user_cfg)
        _, folder = cd2.resolve_push_folder(cfg, folder_id)
        return {
            "folder_id": folder.get("id", folder_id or ""),
            "folder_name": folder.get("name", ""),
            "folder_path": folder.get("path", ""),
        }
    except CD2Error:
        return {"folder_id": folder_id or "", "folder_name": "", "folder_path": ""}


def _record_push_history(
    user: dict | None,
    *,
    code: str = "",
    magnet_link: str = "",
    magnet_title: str = "",
    backend: str = "",
    folder_id: str = "",
    folder_name: str = "",
    folder_path: str = "",
    success: bool = False,
    message: str = "",
) -> None:
    if not user:
        return
    db.add_push_history(
        user["id"],
        code=code,
        magnet_link=magnet_link,
        magnet_title=magnet_title,
        backend=backend,
        folder_id=folder_id,
        folder_name=folder_name,
        folder_path=folder_path,
        success=success,
        message=message,
    )


def _magnet_title_for_link(movie, link: str) -> str:
    if not movie:
        return ""
    for magnet in movie.magnets:
        if magnet.link == link:
            return magnet.title
    return ""


@router.get("/push/status", response_model=PushStatusResponse)
async def push_status(user: OptionalUser) -> PushStatusResponse:
    data = await push_service.check_push_status(_user_settings(user))
    return PushStatusResponse(**data)


@router.get("/cd2/status", response_model=CD2StatusResponse)
async def cd2_status(user: OptionalUser) -> CD2StatusResponse:
    try:
        data = await cd2.check_cd2_status(_user_settings(user))
        return CD2StatusResponse(**data)
    except Exception as exc:
        return CD2StatusResponse(
            configured=settings.cd2_configured,
            connected=False,
            host=settings.cd2_host,
            auth_mode=settings.cd2_auth_mode,
            offline_folder=settings.cd2_offline_folder,
            message=str(exc),
        )


@router.post("/cd2/test", response_model=CD2StatusResponse)
async def cd2_test(body: CD2ConnectRequest, user: OptionalUser) -> CD2StatusResponse:
    cfg = cd2.build_cd2_config(_user_settings(user), body.model_dump(exclude_none=True))
    data = await cd2.check_cd2_status(cfg)
    return CD2StatusResponse(**data)


@router.post("/cd2/folders", response_model=CD2FoldersResponse)
async def cd2_folders(body: CD2FoldersRequest, user: OptionalUser) -> CD2FoldersResponse:
    cfg = cd2.build_cd2_config(_user_settings(user), body.model_dump(exclude_none=True))
    try:
        data = await cd2.list_cd2_folders(body.path, cfg)
        return CD2FoldersResponse(**data)
    except CD2NotConfiguredError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except CD2Error as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/p115/status", response_model=P115StatusResponse)
async def p115_status(user: OptionalUser) -> P115StatusResponse:
    try:
        data = await p115.check_p115_status(_user_settings(user))
        return P115StatusResponse(**data)
    except Exception as exc:
        return P115StatusResponse(
            configured=settings.p115_configured,
            logged_in=False,
            message=str(exc),
        )


async def _handle_push(body: Push115Request, user: dict | None = None) -> Push115Response:
    user_cfg = _user_settings(user)
    backend = push_service.active_backend(user_cfg)
    folder_meta = _folder_meta(user_cfg, body.push_folder_id, backend)
    magnets = list(body.magnets)
    code = body.code or ""
    movie = None

    if body.code:
        movie = await scrape_movie(body.code, user_settings=user_cfg)
        code = body.code
        if body.push_best:
            if not movie.magnets:
                raise CD2Error(f"番号 {body.code} 没有可用磁力链接")
            magnets = [movie.magnets[0].link]
        elif not magnets:
            magnets = [m.link for m in movie.magnets]

    if not magnets:
        raise HTTPException(status_code=400, detail="请提供 magnets 或 code")

    if len(magnets) == 1:
        results = [await push_service.push_magnet(magnets[0], user_cfg, body.push_folder_id)]
    else:
        results = await push_service.push_magnets(magnets, user_cfg, body.push_folder_id)

    items = []
    for result in results:
        item = Push115ItemResult(
            link=result.link,
            success=result.success,
            message=result.message,
            task_name=result.task_name,
            backend=result.backend,
        )
        items.append(item)
        _record_push_history(
            user,
            code=code,
            magnet_link=result.link,
            magnet_title=_magnet_title_for_link(movie, result.link),
            backend=result.backend or backend,
            success=result.success,
            message=result.message,
            **folder_meta,
        )

    success_count = sum(1 for item in items if item.success)
    return Push115Response(
        success=success_count > 0,
        message=f"成功 {success_count}/{len(items)}",
        backend=backend,
        results=items,
    )


@router.get("/push/history", response_model=PushHistoryResponse)
async def push_history(user: CurrentUser, limit: int = 50) -> PushHistoryResponse:
    items = db.list_push_history(user["id"], limit=limit)
    return PushHistoryResponse(items=[PushHistoryItem(**item) for item in items])


@router.post("/push", response_model=Push115Response)
async def offline_push(body: Push115Request, user: OptionalUser) -> Push115Response:
    user_cfg = _user_settings(user)
    backend = push_service.active_backend(user_cfg)
    folder_meta = _folder_meta(user_cfg, body.push_folder_id, backend)
    code = body.code or ""
    magnet_link = body.magnets[0] if body.magnets else ""

    try:
        return await _handle_push(body, user)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        _record_push_history(
            user,
            code=code,
            magnet_link=magnet_link,
            backend=backend,
            success=False,
            message=detail,
            **folder_meta,
        )
        raise
    except (CD2NotConfiguredError, P115NotConfiguredError) as exc:
        _record_push_history(
            user,
            code=code,
            magnet_link=magnet_link,
            backend=backend,
            success=False,
            message=str(exc),
            **folder_meta,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ScrapeError as exc:
        _record_push_history(
            user,
            code=code,
            magnet_link=magnet_link,
            backend=backend,
            success=False,
            message=str(exc),
            **folder_meta,
        )
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (CD2Error, P115Error) as exc:
        _record_push_history(
            user,
            code=code,
            magnet_link=magnet_link,
            backend=backend,
            success=False,
            message=str(exc),
            **folder_meta,
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        _record_push_history(
            user,
            code=code,
            magnet_link=magnet_link,
            backend=backend,
            success=False,
            message=str(exc),
            **folder_meta,
        )
        raise HTTPException(status_code=502, detail=f"推送失败: {exc}") from exc


@router.post("/cd2/push", response_model=Push115Response)
async def cd2_push(body: Push115Request, user: OptionalUser) -> Push115Response:
    return await offline_push(body, user)


@router.post("/p115/push", response_model=Push115Response)
async def p115_push(body: Push115Request, user: OptionalUser) -> Push115Response:
    return await offline_push(body, user)


@router.get("/movie/{code}", response_model=MovieInfo)
async def get_movie(
    code: str,
    download_cover: bool = False,
    user: OptionalUser = None,
) -> MovieInfo:
    try:
        return await scrape_movie(
            code,
            download_cover=download_cover,
            user_settings=_user_settings(user),
        )
    except ScrapeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"抓取失败: {exc}") from exc


@router.post("/movies/batch", response_model=BatchResponse)
async def batch_movies(body: BatchRequest, user: OptionalUser = None) -> BatchResponse:
    if not body.codes:
        raise HTTPException(status_code=400, detail="codes 不能为空")

    results, errors = await scrape_movies_batch(
        body.codes,
        download_cover=body.download_cover,
        user_settings=_user_settings(user),
    )
    return BatchResponse(
        results=results,
        errors=[BatchError(code=code, message=msg) for code, msg in errors],
    )
