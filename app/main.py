from contextlib import asynccontextmanager
from pathlib import Path
import asyncio

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.db import init_db
from app.ignored_replace import scheduler_loop
from app.routes.api import router as api_router
from app.routes.auth import router as auth_router
from app.routes.cleanup import router as cleanup_router
from app.routes.duplicates import router as duplicates_router
from app.routes.missing_subs import router as missing_subs_router
from app.routes.subtitles import router as subtitles_router
from app.routes.settings import router as settings_router
from app.routes.translate import router as translate_router
from app.scraper.client import close_client


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    scheduler_task = asyncio.create_task(scheduler_loop())
    try:
        yield
    finally:
        scheduler_task.cancel()
        try:
            await scheduler_task
        except asyncio.CancelledError:
            pass
        await close_client()


app = FastAPI(
    title="JavBus Scraper",
    description="输入番号抓取 JavBus 元数据与磁力链接",
    version="2.0.0",
    lifespan=lifespan,
)

app.include_router(api_router)
app.include_router(auth_router)
app.include_router(settings_router)
app.include_router(subtitles_router)
app.include_router(translate_router)
app.include_router(duplicates_router)
app.include_router(missing_subs_router)
app.include_router(cleanup_router)

static_dir = Path(__file__).resolve().parent.parent / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

cover_dir = Path(__file__).resolve().parent.parent / "downloads" / "covers"
cover_dir.mkdir(parents=True, exist_ok=True)
app.mount("/covers", StaticFiles(directory=str(cover_dir)), name="covers")


def _html_page(name: str) -> FileResponse:
    return FileResponse(
        static_dir / name,
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@app.get("/")
async def index() -> FileResponse:
    return _html_page("index.html")


@app.get("/history")
async def history_page() -> FileResponse:
    return _html_page("history.html")


@app.get("/settings")
async def settings_page() -> FileResponse:
    return _html_page("settings.html")
