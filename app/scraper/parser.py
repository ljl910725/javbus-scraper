import re
from dataclasses import dataclass, field
from urllib.parse import quote, urljoin

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


def build_fuzzy_search_url(query: str) -> str:
    base = settings.base_url.rstrip("/")
    encoded = quote(query.strip(), safe="")
    return f"{base}/search/{encoded}&type=&parent=ce"


@dataclass
class SearchPreview:
    code: str
    title: str = ""
    cover_url: str = ""
    source_url: str = ""
    release_date: str = ""
    has_hd: bool = False
    has_ultra: bool = False
    has_subtitle: bool = False


def _parse_search_tags(box: Tag) -> dict[str, bool]:
    flags = {"has_hd": False, "has_ultra": False, "has_subtitle": False}
    for btn in box.select(".item-tag button"):
        text = btn.get_text(strip=True)
        title = btn.get("title", "") or ""
        combined = f"{text} {title}"

        if text == "超清" or "超清" in title:
            flags["has_ultra"] = True
            continue
        if text == "高清" or ("高清" in combined and "超清" not in combined) or "HD" in title.upper():
            flags["has_hd"] = True
            continue
        if text == "字幕" or "字幕" in combined:
            flags["has_subtitle"] = True
    return flags


def _parse_release_date(box: Tag) -> str:
    for date_el in box.select(".photo-info date"):
        text = date_el.get_text(strip=True)
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            return text
    return ""


def extract_code_from_slug(slug: str) -> str:
    slug = slug.strip("/").split("/")[-1]
    match = re.match(r"^([A-Za-z0-9]+[-_][A-Za-z0-9]+)", slug)
    if match:
        return match.group(1).upper().replace("_", "-")
    return slug.upper().replace("_", "-")


def _title_from_img(img_title: str, code: str) -> str:
    raw = img_title.strip()
    if not raw:
        return ""
    upper = raw.upper()
    code_upper = code.upper()
    if upper.startswith(code_upper):
        return raw[len(code) :].strip(" -:|")
    return raw


def parse_fuzzy_search_page(html: str, *, source_url: str) -> list[SearchPreview]:
    soup = BeautifulSoup(html, "lxml")
    results: list[SearchPreview] = []
    seen: set[str] = set()

    for box in soup.select("a.movie-box"):
        href = (box.get("href") or "").strip()
        if not href:
            continue

        code = extract_code_from_slug(href)
        if not code or code in seen:
            continue

        img = box.select_one("img")
        cover_url = ""
        title = ""
        if img:
            if img.get("src"):
                cover_url = urljoin(source_url, img["src"])
            title = _title_from_img(img.get("title", ""), code)

        if not title:
            span = box.select_one(".photo-info span")
            if span:
                span_text = span.get_text(strip=True)
                if span_text and span_text.upper() != code:
                    title = span_text

        detail_url = urljoin(source_url, href)
        tags = _parse_search_tags(box)
        seen.add(code)
        results.append(
            SearchPreview(
                code=code,
                title=title,
                cover_url=cover_url,
                source_url=detail_url,
                release_date=_parse_release_date(box),
                has_hd=tags["has_hd"],
                has_ultra=tags["has_ultra"],
                has_subtitle=tags["has_subtitle"],
            )
        )

    return results


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
