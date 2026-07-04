import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "app.db"


def get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER PRIMARY KEY,
                settings_json TEXT NOT NULL DEFAULT '{}',
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS push_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                code TEXT NOT NULL DEFAULT '',
                magnet_link TEXT NOT NULL DEFAULT '',
                magnet_title TEXT NOT NULL DEFAULT '',
                backend TEXT NOT NULL DEFAULT '',
                folder_id TEXT NOT NULL DEFAULT '',
                folder_name TEXT NOT NULL DEFAULT '',
                folder_path TEXT NOT NULL DEFAULT '',
                success INTEGER NOT NULL DEFAULT 0,
                message TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_push_history_user_created
                ON push_history(user_id, created_at DESC);
            """
        )
        conn.commit()


def create_user(username: str, email: str, password_hash: str) -> dict:
    with get_connection() as conn:
        cursor = conn.execute(
            "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
            (username, email, password_hash),
        )
        user_id = cursor.lastrowid
        conn.execute(
            "INSERT INTO user_settings (user_id, settings_json) VALUES (?, '{}')",
            (user_id,),
        )
        conn.commit()
        return get_user_by_id(user_id)


def get_user_by_id(user_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, username, email, created_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        return dict(row) if row else None


def get_user_by_username(username: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, username, email, password_hash, created_at FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        return dict(row) if row else None


def get_user_settings(user_id: int) -> dict:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT settings_json FROM user_settings WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if not row:
            return {}
        try:
            return json.loads(row["settings_json"])
        except json.JSONDecodeError:
            return {}


def save_user_settings(user_id: int, settings: dict) -> dict:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO user_settings (user_id, settings_json, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(user_id) DO UPDATE SET
                settings_json = excluded.settings_json,
                updated_at = datetime('now')
            """,
            (user_id, json.dumps(settings, ensure_ascii=False)),
        )
        conn.commit()
    return get_user_settings(user_id)


def add_push_history(
    user_id: int,
    *,
    code: str = "",
    magnet_link: str = "",
    magnet_title: str = "",
    backend: str = "",
    folder_id: str = "",
    folder_name: str = "",
    folder_path: str = "",
    success: bool = False,
    message: str = "",
) -> dict:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO push_history (
                user_id, code, magnet_link, magnet_title, backend,
                folder_id, folder_name, folder_path, success, message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                code or "",
                magnet_link or "",
                magnet_title or "",
                backend or "",
                folder_id or "",
                folder_name or "",
                folder_path or "",
                1 if success else 0,
                message or "",
            ),
        )
        conn.commit()
        return get_push_history_item(cursor.lastrowid)


def get_push_history_item(history_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM push_history WHERE id = ?",
            (history_id,),
        ).fetchone()
        return _push_history_row(row) if row else None


def list_push_history(user_id: int, limit: int = 50) -> list[dict]:
    safe_limit = max(1, min(limit, 200))
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM push_history
            WHERE user_id = ?
            ORDER BY datetime(created_at) DESC, id DESC
            LIMIT ?
            """,
            (user_id, safe_limit),
        ).fetchall()
        return [_push_history_row(row) for row in rows]


def _push_history_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "code": row["code"],
        "magnet_link": row["magnet_link"],
        "magnet_title": row["magnet_title"],
        "backend": row["backend"],
        "folder_id": row["folder_id"],
        "folder_name": row["folder_name"],
        "folder_path": row["folder_path"],
        "success": bool(row["success"]),
        "message": row["message"],
        "created_at": row["created_at"],
    }
