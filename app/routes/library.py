import asyncio

from fastapi import APIRouter, HTTPException, Query, Request

from app.deps import CurrentUser
from app.library import (
    add_library_path,
    iter_scan_library,
    library_overview,
    lookup_library,
    remove_library_path,
)
from app.models import LibraryLookupRequest, LibraryPathRequest
from app.routes.streaming import stream_thread_events

router = APIRouter(prefix="/api/library")


@router.get("")
async def get_library(user: CurrentUser) -> dict:
    return await asyncio.to_thread(library_overview, user["id"])


@router.post("/paths")
async def create_library_path(body: LibraryPathRequest, user: CurrentUser) -> dict:
    try:
        return await asyncio.to_thread(add_library_path, user["id"], body.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/paths")
async def delete_library_path(user: CurrentUser, path: str = Query(...)) -> dict:
    try:
        return await asyncio.to_thread(remove_library_path, user["id"], path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/scan/stream")
async def scan_library_stream(body: LibraryPathRequest, request: Request, user: CurrentUser):
    return stream_thread_events(
        request,
        lambda stop: iter_scan_library(user["id"], body.path, reconcile=False, stop=stop),
        error_prefix="扫描失败",
    )


@router.post("/lookup")
async def lookup(body: LibraryLookupRequest, user: CurrentUser) -> dict:
    groups = await asyncio.to_thread(lookup_library, user["id"], body.codes, body.links)
    return {"groups": groups}
