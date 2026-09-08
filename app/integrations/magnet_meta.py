"""Resolve magnet metadata the way a BitTorrent client does.

Public torrent caches often return unrelated fake torrents. Real clients
announce to trackers, ask DHT for peers, then download metadata with BEP-9.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import random
import socket
import struct
from urllib.parse import parse_qs, urlparse

import httpx

DEFAULT_TRACKERS = (
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.openbittorrent.com:6969/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://explodie.org:6969/announce",
    "http://tracker.openbittorrent.com:80/announce",
    "http://tracker.opentrackr.org:1337/announce",
)

DHT_BOOTSTRAP = (
    ("router.bittorrent.com", 6881),
    ("dht.transmissionbt.com", 6881),
    ("router.utorrent.com", 6881),
    ("dht.libtorrent.org", 25401),
)

_PEER_ID = b"-JB0001-" + os.urandom(12)
_DHT_ID = hashlib.sha1(os.urandom(20)).digest()


class MagnetMetaError(Exception):
    pass


def bencode(value) -> bytes:
    if isinstance(value, bool):
        raise TypeError("bool")
    if isinstance(value, int):
        return b"i%de" % value
    if isinstance(value, bytes):
        return b"%d:%s" % (len(value), value)
    if isinstance(value, str):
        return bencode(value.encode("utf-8"))
    if isinstance(value, list):
        return b"l" + b"".join(bencode(item) for item in value) + b"e"
    if isinstance(value, dict):
        chunks = []
        for key in sorted(value.keys(), key=lambda item: item if isinstance(item, bytes) else str(item).encode()):
            raw_key = key if isinstance(key, bytes) else str(key).encode()
            chunks.append(bencode(raw_key) + bencode(value[key]))
        return b"d" + b"".join(chunks) + b"e"
    raise TypeError(type(value))


def bdecode_at(data: bytes, index: int = 0):
    if index >= len(data):
        raise ValueError("truncated")
    flag = data[index : index + 1]
    if flag == b"i":
        end = data.index(b"e", index)
        return int(data[index + 1 : end]), end + 1
    if flag == b"l":
        index += 1
        items = []
        while data[index : index + 1] != b"e":
            item, index = bdecode_at(data, index)
            items.append(item)
        return items, index + 1
    if flag == b"d":
        index += 1
        mapping = {}
        while data[index : index + 1] != b"e":
            key, index = bdecode_at(data, index)
            value, index = bdecode_at(data, index)
            mapping[key] = value
        return mapping, index + 1
    colon = data.index(b":", index)
    length = int(data[index:colon])
    start = colon + 1
    return data[start : start + length], start + length


def wrap_info_as_torrent(info_bytes: bytes) -> bytes:
    return b"d4:info" + info_bytes + b"e"


def magnet_trackers(magnet: str) -> list[str]:
    query = parse_qs(urlparse(magnet).query)
    found = []
    for values in query.get("tr", []):
        url = (values or "").strip()
        if url and url not in found:
            found.append(url)
    for url in DEFAULT_TRACKERS:
        if url not in found:
            found.append(url)
    return found


def _is_public_ip(ip: str) -> bool:
    if not ip or ip.startswith("127.") or ip.startswith("0."):
        return False
    if ip.startswith("10.") or ip.startswith("192.168.") or ip.startswith("169.254."):
        return False
    if ip.startswith("172."):
        try:
            second = int(ip.split(".")[1])
        except (IndexError, ValueError):
            return False
        if 16 <= second <= 31:
            return False
    return True


def parse_compact_peers(data: bytes) -> list[tuple[str, int]]:
    peers: list[tuple[str, int]] = []
    for offset in range(0, len(data) - 5, 6):
        ip = socket.inet_ntoa(data[offset : offset + 4])
        port = struct.unpack("!H", data[offset + 4 : offset + 6])[0]
        if port and _is_public_ip(ip):
            peers.append((ip, port))
    return peers


def parse_compact_nodes(data: bytes) -> list[tuple[bytes, str, int]]:
    nodes = []
    for offset in range(0, len(data) - 25, 26):
        node_id = data[offset : offset + 20]
        ip = socket.inet_ntoa(data[offset + 20 : offset + 24])
        port = struct.unpack("!H", data[offset + 24 : offset + 26])[0]
        if port and _is_public_ip(ip):
            nodes.append((node_id, ip, port))
    return nodes


async def _read_exact(reader: asyncio.StreamReader, size: int) -> bytes:
    buf = b""
    while len(buf) < size:
        chunk = await reader.read(size - len(buf))
        if not chunk:
            raise ConnectionError("peer closed")
        buf += chunk
    return buf


async def _udp_tracker_announce(host: str, port: int, info_hash: bytes, listen_port: int) -> list[tuple[str, int]]:
    loop = asyncio.get_running_loop()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setblocking(False)
    try:
        trans = random.randint(0, 0xFFFFFFFF)
        await loop.sock_sendto(sock, struct.pack("!QII", 0x41727101980, 0, trans), (host, port))
        data, _ = await asyncio.wait_for(loop.sock_recvfrom(sock, 2048), 4)
        if len(data) < 16:
            return []
        action, rtrans, conn_id = struct.unpack("!IIQ", data[:16])
        if action != 0 or rtrans != trans:
            return []
        trans = random.randint(0, 0xFFFFFFFF)
        packet = struct.pack("!QII", conn_id, 1, trans)
        packet += info_hash + _PEER_ID
        packet += struct.pack(
            "!QQQIIIiH",
            0,
            1,
            0,
            0,
            0,
            random.randint(0, 0xFFFFFFFF),
            80,
            listen_port,
        )
        await loop.sock_sendto(sock, packet, (host, port))
        data, _ = await asyncio.wait_for(loop.sock_recvfrom(sock, 4096), 6)
        if len(data) < 20:
            return []
        return parse_compact_peers(data[20:])
    finally:
        sock.close()


async def _http_tracker_announce(url: str, info_hash: bytes, listen_port: int) -> list[tuple[str, int]]:
    params = {
        "info_hash": info_hash,
        "peer_id": _PEER_ID,
        "port": str(listen_port),
        "uploaded": "0",
        "downloaded": "0",
        "left": "1",
        "compact": "1",
        "numwant": "80",
        "event": "started",
    }
    try:
        async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as client:
            response = await client.get(url, params=params)
            payload = response.content or b""
    except Exception:
        return []
    if not payload.startswith(b"d"):
        return []
    try:
        mapping, _ = bdecode_at(payload, 0)
    except Exception:
        return []
    peers = mapping.get(b"peers")
    if isinstance(peers, bytes):
        return parse_compact_peers(peers)
    return []


async def collect_tracker_peers(info_hash: bytes, magnet: str, listen_port: int) -> set[tuple[str, int]]:
    peers: set[tuple[str, int]] = set()

    async def one(url: str) -> None:
        parsed = urlparse(url)
        host = parsed.hostname
        port = parsed.port
        if not host:
            return
        try:
            if parsed.scheme == "udp":
                found = await asyncio.wait_for(
                    _udp_tracker_announce(host, port or 80, info_hash, listen_port),
                    8,
                )
            elif parsed.scheme in {"http", "https"}:
                found = await asyncio.wait_for(
                    _http_tracker_announce(url, info_hash, listen_port),
                    8,
                )
            else:
                return
            peers.update(found)
        except Exception:
            return

    await asyncio.gather(*(one(url) for url in magnet_trackers(magnet)[:10]), return_exceptions=True)
    return peers


async def collect_dht_peers(info_hash: bytes, limit: int = 40) -> set[tuple[str, int]]:
    loop = asyncio.get_running_loop()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setblocking(False)
    peers: set[tuple[str, int]] = set()
    pending: list[tuple[str, int]] = []
    seen: set[tuple[str, int]] = set()
    queries = 0

    for host, port in DHT_BOOTSTRAP:
        try:
            infos = await loop.getaddrinfo(host, port, type=socket.SOCK_DGRAM)
        except Exception:
            continue
        addr = infos[0][4]
        pending.append((addr[0], addr[1]))

    async def query(addr: tuple[str, int]) -> None:
        nonlocal queries
        if addr in seen or queries >= 64:
            return
        seen.add(addr)
        queries += 1
        tx = bytes([queries & 0xFF])
        message = {
            b"t": tx,
            b"y": b"q",
            b"q": b"get_peers",
            b"a": {b"id": _DHT_ID, b"info_hash": info_hash},
        }
        try:
            await loop.sock_sendto(sock, bencode(message), addr)
        except Exception:
            return

    for addr in list(pending):
        await query(addr)

    deadline = loop.time() + 6
    while loop.time() < deadline and len(peers) < limit:
        timeout = max(0.2, deadline - loop.time())
        try:
            data, addr = await asyncio.wait_for(loop.sock_recvfrom(sock, 2048), timeout)
        except asyncio.TimeoutError:
            break
        except Exception:
            continue
        try:
            mapping, _ = bdecode_at(data, 0)
        except Exception:
            continue
        reply = mapping.get(b"r") or {}
        values = reply.get(b"values")
        if isinstance(values, list):
            for item in values:
                if isinstance(item, bytes):
                    peers.update(parse_compact_peers(item))
        elif isinstance(values, bytes):
            peers.update(parse_compact_peers(values))
        nodes = reply.get(b"nodes")
        if isinstance(nodes, bytes):
            for _nid, ip, port in parse_compact_nodes(nodes)[:12]:
                await query((ip, port))
    sock.close()
    return peers


async def _ut_metadata(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, info_hash: bytes) -> bytes:
    reserved = bytearray(8)
    reserved[5] |= 0x10
    writer.write(bytes([19]) + b"BitTorrent protocol" + bytes(reserved) + info_hash + _PEER_ID)
    await writer.drain()
    handshake = await asyncio.wait_for(_read_exact(reader, 68), 10)
    if handshake[1:20] != b"BitTorrent protocol":
        raise MagnetMetaError("handshake")
    if handshake[28:48] != info_hash:
        raise MagnetMetaError("peer infohash mismatch")
    if not (handshake[25] & 0x10):
        raise MagnetMetaError("no extension protocol")
    payload = bytes([0]) + bencode({b"m": {b"ut_metadata": 1}})
    writer.write(struct.pack("!IB", len(payload) + 1, 20) + payload)
    await writer.drain()

    ut_id = None
    meta_size = None
    pieces: dict[int, bytes] = {}
    while True:
        header = await asyncio.wait_for(_read_exact(reader, 4), 12)
        (length,) = struct.unpack("!I", header)
        if length == 0:
            continue
        if length > 1024 * 1024:
            raise MagnetMetaError("peer message too large")
        body = await asyncio.wait_for(_read_exact(reader, length), 12)
        if body[0] != 20:
            continue
        ext_id = body[1]
        rest = body[2:]
        if ext_id == 0:
            mapping, _ = bdecode_at(rest, 0)
            table = mapping.get(b"m") or {}
            ut_id = table.get(b"ut_metadata")
            meta_size = mapping.get(b"metadata_size")
            if not ut_id or not meta_size:
                raise MagnetMetaError("peer has no metadata")
            count = (int(meta_size) + 16383) // 16384
            for index in range(count):
                piece = bytes([int(ut_id)]) + bencode({b"msg_type": 0, b"piece": index})
                writer.write(struct.pack("!IB", len(piece) + 1, 20) + piece)
            await writer.drain()
            continue
        if ut_id is None or ext_id != int(ut_id):
            continue
        mapping, offset = bdecode_at(rest, 0)
        if mapping.get(b"msg_type") != 1:
            continue
        pieces[int(mapping.get(b"piece") or 0)] = rest[offset:]
        count = (int(meta_size) + 16383) // 16384
        if len(pieces) >= count:
            raw = b"".join(pieces[index] for index in range(count))
            if hashlib.sha1(raw).digest() != info_hash:
                raise MagnetMetaError("metadata infohash mismatch")
            return raw


async def _connect_peer(ip: str, port: int, info_hash: bytes, result: dict) -> None:
    if result.get("info"):
        return
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), 8)
    except Exception:
        return
    try:
        info = await asyncio.wait_for(_ut_metadata(reader, writer, info_hash), 18)
        result["info"] = info
    except Exception:
        return
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass


async def fetch_magnet_info_bytes(info_hash: str, magnet: str = "", timeout: float = 22.0) -> bytes:
    digest = (info_hash or "").strip().lower()
    if len(digest) != 40:
        raise MagnetMetaError("infohash 无效")
    raw_hash = bytes.fromhex(digest)
    listen_port = random.randint(15000, 25000)
    result: dict = {"info": None}

    async def accept(reader, writer):
        try:
            info = await asyncio.wait_for(_ut_metadata(reader, writer, raw_hash), 18)
            result["info"] = info
        except Exception:
            return
        finally:
            writer.close()

    server = await asyncio.start_server(accept, "0.0.0.0", listen_port)
    try:
        tracker_peers, dht_peers = await asyncio.gather(
            collect_tracker_peers(raw_hash, magnet, listen_port),
            collect_dht_peers(raw_hash),
        )
        peers = list(tracker_peers | dht_peers)
        random.shuffle(peers)
        tasks = [asyncio.create_task(_connect_peer(ip, port, raw_hash, result)) for ip, port in peers[:24]]

        async def wait_info():
            while result.get("info") is None:
                await asyncio.sleep(0.15)

        try:
            await asyncio.wait_for(wait_info(), timeout)
        except asyncio.TimeoutError:
            pass
        for task in tasks:
            task.cancel()
    finally:
        server.close()
        try:
            await server.wait_closed()
        except Exception:
            pass

    info = result.get("info")
    if not info:
        raise MagnetMetaError("DHT/Tracker 未能在时限内获取种子元数据")
    return info


async def fetch_index_preview(magnet: str) -> dict | None:
    """HTTPS metadata index used by many Chinese clients as a magnet preview."""
    if not magnet:
        return None
    url = "https://whatslink.info/api/v1/link"
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            response = await client.get(
                url,
                params={"url": magnet},
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                    ),
                    "Accept": "application/json",
                },
            )
            if response.status_code != 200:
                return None
            data = response.json()
    except Exception:
        return None
    if not isinstance(data, dict) or data.get("error"):
        return None
    name = str(data.get("name") or "").strip()
    size = int(data.get("size") or 0)
    count = int(data.get("count") or 0)
    if not name:
        return None
    return {"name": name, "size": size, "count": count}
