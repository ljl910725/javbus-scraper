from pathlib import Path

import pytest

from app import db
from app.library import (
    add_library_path,
    code_from_link,
    duplicate_groups,
    lookup_library,
    scan_library,
)


@pytest.fixture
def library_db(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "library.db")
    db.init_db()
    monkeypatch.setattr("app.library.resolve_directory", lambda path: Path(path))
    return tmp_path


def _video(folder: Path, name: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(b"video")


def test_manual_scan_appends_and_lists_same_code(library_db):
    first = library_db / "first"
    second = library_db / "second"
    _video(first, "MEYD-921-C.mp4")
    _video(second, "MEYD-921.mkv")
    _video(first, "readme.txt")
    add_library_path(1, str(first))
    add_library_path(1, str(second))

    first_result = scan_library(1, str(first), reconcile=False)
    assert first_result["added"] == 1
    assert first_result["duplicates"] == []

    second_result = scan_library(1, str(second), reconcile=False)
    assert second_result["added"] == 1
    assert [group["code"] for group in second_result["duplicates"]] == ["MEYD-921"]
    assert len(second_result["duplicates"][0]["files"]) == 2

    # 再扫一次只更新，不重复追加
    again = scan_library(1, str(first), reconcile=False)
    assert again["added"] == 0
    assert len(db.list_local_videos(1)) == 2


def test_daily_scan_removes_records_for_missing_files(library_db):
    folder = library_db / "videos"
    kept = folder / "SSIS-001.mp4"
    gone = folder / "ABP-123.mp4"
    _video(folder, kept.name)
    _video(folder, gone.name)
    add_library_path(1, str(folder))
    scan_library(1, str(folder), reconcile=False)
    gone.unlink()

    result = scan_library(1, str(folder), reconcile=True)
    assert result["removed"] == 1
    assert [row["name"] for row in db.list_local_videos(1)] == ["SSIS-001.mp4"]
    assert duplicate_groups(1) == []


def test_lookup_finds_existing_code_from_number_or_link(library_db):
    folder = library_db / "videos"
    _video(folder, "IPX-177.mp4")
    add_library_path(1, str(folder))
    scan_library(1, str(folder), reconcile=False)

    by_code = lookup_library(1, ["IPX-177"], [])
    assert by_code[0]["code"] == "IPX-177"
    assert by_code[0]["files"][0]["name"] == "IPX-177.mp4"
    assert by_code[0]["files"][0]["size"] == 5

    link = "magnet:?xt=urn:btih:abc&dn=IPX-177-C.mkv"
    assert code_from_link(link) == "IPX-177"
    by_link = lookup_library(1, [], [link])
    assert by_link[0]["links"] == [link]
    assert lookup_library(1, ["SSIS-001"], []) == []
