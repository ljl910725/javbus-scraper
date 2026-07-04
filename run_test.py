"""End-to-end scraper test script."""
import asyncio
import json
import sys

import httpx

from app.config import settings
from app.scraper.client import close_client, get_client
from app.scraper.service import scrape_movie


async def test_direct_scrape(code: str) -> dict:
    print(f"\n=== 直接爬取: {code} ===")
    print(f"BASE_URL: {settings.base_url}")
    print(f"代理: {'已启用' if settings.proxy_enabled else '未启用'}")

    try:
        movie = await scrape_movie(code, download_cover=False)
        result = movie.model_dump()
        print("成功!")
        print(f"  标题: {result['title']}")
        print(f"  演员: {', '.join(result['actresses'][:5])}")
        print(f"  封面: {result['cover_url'][:80]}..." if result['cover_url'] else "  封面: 无")
        print(f"  发行日期: {result['release_date']}")
        print(f"  磁力数: {len(result['magnets'])}")
        if result['magnets']:
            m = result['magnets'][0]
            print(f"  首个磁力: {m['title']} | {m['size']} | HD={m['is_hd']}")
        return {"ok": True, "data": result}
    except Exception as exc:
        print(f"失败: {exc}")
        return {"ok": False, "error": str(exc)}
    finally:
        await close_client()


def test_api(code: str) -> dict:
    print(f"\n=== API 测试: {code} ===")
    try:
        with httpx.Client(timeout=60) as client:
            r = client.get(f"http://127.0.0.1:8000/api/movie/{code}")
            print(f"状态码: {r.status_code}")
            if r.status_code == 200:
                data = r.json()
                print(f"  标题: {data.get('title')}")
                print(f"  磁力数: {len(data.get('magnets', []))}")
                return {"ok": True, "data": data}
            else:
                detail = r.json().get("detail", r.text[:200])
                print(f"  错误: {detail}")
                return {"ok": False, "error": detail}
    except Exception as exc:
        print(f"失败: {exc}")
        return {"ok": False, "error": str(exc)}


def test_batch_api(codes: list[str]) -> dict:
    print(f"\n=== 批量 API 测试: {codes} ===")
    try:
        with httpx.Client(timeout=120) as client:
            r = client.post(
                "http://127.0.0.1:8000/api/movies/batch",
                json={"codes": codes, "download_cover": False},
            )
            print(f"状态码: {r.status_code}")
            data = r.json()
            print(f"  成功: {len(data.get('results', []))}")
            print(f"  失败: {len(data.get('errors', []))}")
            for err in data.get("errors", []):
                print(f"    - {err['code']}: {err['message']}")
            return {"ok": r.status_code == 200, "data": data}
    except Exception as exc:
        print(f"失败: {exc}")
        return {"ok": False, "error": str(exc)}


async def test_network() -> bool:
    print("\n=== 网络连通性测试 ===")
    client = get_client()
    try:
        url = settings.base_url.rstrip("/")
        r = await client.get(url)
        print(f"访问 {url} -> HTTP {r.status_code}, 长度 {len(r.text)}")
        return r.status_code == 200 and len(r.text) > 1000
    except Exception as exc:
        print(f"无法访问: {exc}")
        return False
    finally:
        await close_client()


async def main():
    code = "SSNI-730"
    codes = ["SSNI-730", "IPX-177"]

    network_ok = await test_network()
    direct = await test_direct_scrape(code)
    api = test_api(code)
    batch = test_batch_api(codes)

    summary = {
        "network": network_ok,
        "direct_scrape": direct["ok"],
        "api_single": api["ok"],
        "api_batch": batch["ok"],
    }
    print("\n=== 测试汇总 ===")
    for k, v in summary.items():
        print(f"  {k}: {'PASS' if v else 'FAIL'}")

    if not network_ok:
        print("\n提示: JavBus 无法直连，请在 .env 中配置 HTTP_PROXY")

    return 0 if all(summary.values()) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
