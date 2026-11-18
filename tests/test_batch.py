import asyncio

from app.models import MovieInfo
from app.scraper import service


def test_batch_runs_several_at_once_and_keeps_input_order(monkeypatch):
    running = 0
    peak = 0

    async def fake_scrape(code, **_kwargs):
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        # 后面的番号先查完，用来确认结果仍按输入顺序返回
        await asyncio.sleep(0.05 if code.endswith("1") else 0.01)
        running -= 1
        if code == "BAD-002":
            raise service.ScrapeError("未找到")
        return MovieInfo(code=code, title=code)

    monkeypatch.setattr(service, "scrape_movie", fake_scrape)
    monkeypatch.setattr(service, "get_client", lambda _settings=None: object())
    monkeypatch.setattr(service.settings, "request_delay", 0)

    codes = ["ABC-001", "BAD-002", "ABC-003", "ABC-004", " ", "ABC-005"]
    results, errors = asyncio.run(service.scrape_movies_batch(codes))

    assert [movie.code for movie in results] == ["ABC-001", "ABC-003", "ABC-004", "ABC-005"]
    assert errors == [("BAD-002", "未找到")]
    assert peak == service.BATCH_CONCURRENCY
