from app.scraper.magnets import (
    clean_magnet_link,
    is_ed2k_link,
    is_offline_link,
    magnet_infohash,
    parse_ed2k_link,
)

ED2K_HASH = "66C7AED9941BEEE43B809402FE7F5E92"


def test_parse_ed2k_link_keeps_spaces_in_name():
    link = f"ed2k://|file|欢迎 来龙餐馆.mp4|3957027997|{ED2K_HASH}|/"
    assert parse_ed2k_link(link) == {
        "link": link,
        "name": "欢迎 来龙餐馆.mp4",
        "size": 3957027997,
        "hash": ED2K_HASH,
    }


def test_parse_ed2k_link_decodes_percent_name_and_uppercases_hash():
    parsed = parse_ed2k_link(f"ed2k://|file|foo%20bar.mp4|123|{ED2K_HASH.lower()}|/")
    assert parsed["name"] == "foo bar.mp4"
    assert parsed["size"] == 123
    assert parsed["hash"] == ED2K_HASH


def test_parse_ed2k_link_rejects_broken_link():
    assert parse_ed2k_link("ed2k://|file|bad|x|y|/") is None


def test_magnet_infohash_is_uppercase():
    link = "magnet:?xt=urn:btih:91afc79c6155e0b6f0bf502f72443881e3cab635&amp;dn=x"
    assert magnet_infohash(link) == "91AFC79C6155E0B6F0BF502F72443881E3CAB635"


def test_clean_magnet_link_removes_html_escaped_ampersand():
    assert clean_magnet_link("magnet:?xt=urn:btih:ABC&amp;dn=x&amp;tr=y") == "magnet:?xt=urn:btih:ABC&dn=x&tr=y"


def test_offline_link_detection():
    assert is_ed2k_link(f" ED2K://|file|a|1|{ED2K_HASH}|/")
    assert is_offline_link("magnet:?xt=urn:btih:abc")
    assert not is_offline_link("http://example.com/a.torrent")
