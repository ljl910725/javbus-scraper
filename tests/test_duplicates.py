import pytest

from app.duplicates import duplicate_key, extract_jav_code, extract_part_tag, has_c_subtitle


@pytest.mark.parametrize(
    ("filename", "code"),
    [
        ("MEYD-921-C.mp4", "MEYD-921"),
        ("ssis001.mkv", "SSIS-001"),
        ("FC2-PPV-1234567.mp4", "FC2-PPV-1234567"),
        ("300MIUM-123.mp4", "300MIUM-123"),
        ("IPX-177-UC.mp4", "IPX-177"),
        ("SONE-100-ch.mp4", "SONE-100"),
        ("[thz.la]ipx-177.mp4", "IPX-177"),
        ("abc.mp4", None),
    ],
)
def test_extract_jav_code(filename, code):
    assert extract_jav_code(filename) == code


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("MEYD-921-C.mp4", True),
        ("ABP-123-cd1.mp4", False),
        ("IPX-177-UC.mp4", False),
        ("SONE-100-ch.mp4", False),
        ("ssis001.mkv", False),
    ],
)
def test_has_c_subtitle_only_matches_standalone_c(filename, expected):
    assert has_c_subtitle(filename) is expected


def test_part_tag_keeps_multi_disc_files_apart():
    assert extract_part_tag("ABP-123-cd1.mp4") == "CD1"
    assert duplicate_key("ABP-123-cd1.mp4") == "ABP-123#CD1"
    assert duplicate_key("ABP-123.mp4") == "ABP-123"
