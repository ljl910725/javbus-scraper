import re
from dataclasses import dataclass, field
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from app.config import settings


@dataclass
class ParsedMovie:
    code: str = ""
    title: str = ""
    actresses: list[str] = field(default_factory=list)
    cover_url: str = ""
    release_date: str = ""
    runtime: str = ""
    director: str = ""
    studio: str = ""
    label: str = ""
    genres: list[str] = field(default_factory=list)
    preview_images: list[str] = field(default_factory=list)
    gid: str = ""
    uc: str = "0"
    source_url: str = ""


def normalize_code(code: str) -> str:
    return code.strip().upper().replace(" ", "")


def build_detail_url(code: str, *, uncensored: bool = False) -> str:
    base = settings.base_url.rstrip("/")
    if uncensored:
        return f"{base}/{code.replace('-', '_')}"
    return f"{base}/{code}"


def build_search_url(code: str) -> str:
    base = settings.base_url.rstrip("/")
    return f"{base}/search/{code}&type=&parent=ce"


def extract_gid_uc(html: str) -> tuple[str, str]:
    gid_match = re.search(r"var\s+gid\s*=\s*(\d+)", html)
    uc_match = re.search(r"var\s+uc\s*=\s*(\d+)", html)
    gid = gid_match.group(1) if gid_match else ""
    uc = uc_match.group(1) if uc_match else "0"
    return gid, uc


def _info_panel(soup: BeautifulSoup) -> Tag | None:
    panel = soup.select_one("div.col-md-3.info")
    if panel:
        return panel
    return soup.select_one("div.info")


def _label_value(panel: Tag, label: str) -> str:
    for paragraph in panel.find_all("p"):
        text = paragraph.get_text(strip=True)
        if label not in text:
            continue

        link = paragraph.find("a")
        if link:
            return link.get_text(strip=True)

        parts = text.split(":", 1)
        if len(parts) == 2:
            value = parts[1].strip()
            if value:
                return value

        spans = paragraph.find_all("span")
        if len(spans) >= 2:
            return spans[-1].get_text(strip=True)

        return text.replace(label, "").strip(": ").strip()
    return ""


def parse_detail_page(html: str, *, source_url: str, expected_code: str) -> ParsedMovie:
    soup = BeautifulSoup(html, "lxml")
    movie = ParsedMovie(source_url=source_url, code=expected_code)

    title_el = soup.select_one("div.container h3")
    if title_el:
        movie.title = title_el.get_text(strip=True)

    cover_el = soup.select_one("a.bigImage")
    if cover_el and cover_el.get("href"):
        movie.cover_url = urljoin(source_url, cover_el["href"])

    panel = _info_panel(soup)
    if panel:
        code_text = _label_value(panel, "識別碼")
        if code_text:
            movie.code = code_text

        movie.release_date = _label_value(panel, "發行日期")
        movie.runtime = _label_value(panel, "長度")
        movie.director = _label_value(panel, "導演")
        movie.studio = _label_value(panel, "製作商")
        movie.label = _label_value(panel, "發行商")

    actresses = []
    for star in soup.select(".star-name"):
        name = star.get_text(strip=True)
        if name:
            actresses.append(name)
    movie.actresses = actresses

    genres = []
    for genre in soup.select(".genre"):
        if "onmouseout" in str(genre):
            continue
        text = genre.get_text(strip=True)
        if text:
            genres.append(text)
    movie.genres = genres

    preview_images = []
    for sample in soup.select("a.sample-box"):
        href = sample.get("href")
        if href:
            preview_images.append(urljoin(source_url, href))
    movie.preview_images = preview_images

    gid, uc = extract_gid_uc(html)
    movie.gid = gid
    movie.uc = uc

    return movie


def is_valid_detail(movie: ParsedMovie) -> bool:
    return bool(movie.title or movie.cover_url or movie.actresses)


def find_search_results(html: str, code: str) -> list[str]:
    pattern = re.compile(
        rf"{re.escape(code)}_\d{{4}}-\d{{2}}-\d{{2}}",
        re.IGNORECASE,
    )
    soup = BeautifulSoup(html, "lxml")
    results: list[str] = []
    seen: set[str] = set()

    for link in soup.find_all("a", href=True):
        href = link["href"]
        match = pattern.search(href)
        if match:
            slug = match.group(0)
            if slug not in seen:
                seen.add(slug)
                results.append(slug)

    if results:
        return results

    for link in soup.find_all("a", href=True):
        href = link["href"].strip("/")
        if href.lower().startswith(code.lower()):
            if href not in seen:
                seen.add(href)
                results.append(href)

    return results


def search_result_url(slug: str) -> str:
    base = settings.base_url.rstrip("/")
    return f"{base}/{slug}"
