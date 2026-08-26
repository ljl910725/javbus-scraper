import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "app.db"


def get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
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

            CREATE TABLE IF NOT EXISTS ignored_missing_subs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                path TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                code TEXT NOT NULL DEFAULT '',
                part TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                size TEXT NOT NULL DEFAULT '',
                parent_dir TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'ignored',
                magnet_link TEXT NOT NULL DEFAULT '',
                magnet_title TEXT NOT NULL DEFAULT '',
                message TEXT NOT NULL DEFAULT '',
                last_checked_at TEXT,
                replaced_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE (user_id, path)
            );

            CREATE INDEX IF NOT EXISTS idx_ignored_missing_subs_user_status
                ON ignored_missing_subs(user_id, status, created_at DESC);

            CREATE TABLE IF NOT EXISTS nosub_replace_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                folders_json TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'running',
                scanned INTEGER NOT NULL DEFAULT 0,
                videos INTEGER NOT NULL DEFAULT 0,
                total INTEGER NOT NULL DEFAULT 0,
                replaced_count INTEGER NOT NULL DEFAULT 0,
                not_found_count INTEGER NOT NULL DEFAULT 0,
                push_failed_count INTEGER NOT NULL DEFAULT 0,
                error_count INTEGER NOT NULL DEFAULT 0,
                message TEXT NOT NULL DEFAULT '',
                started_at TEXT NOT NULL DEFAULT (datetime('now')),
                finished_at TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_nosub_replace_jobs_user
                ON nosub_replace_jobs(user_id, id DESC);

            CREATE TABLE IF NOT EXISTS nosub_replace_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                code TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL DEFAULT '',
                path TEXT NOT NULL DEFAULT '',
                message TEXT NOT NULL DEFAULT '',
                magnet_title TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (job_id) REFERENCES nosub_replace_jobs(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_nosub_replace_items_job
                ON nosub_replace_items(job_id, id);
            """
        )
        conn.commit()
    close_stale_nosub_replace_jobs()


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


def _ignored_missing_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "path": row["path"],
        "name": row["name"],
        "code": row["code"],
        "part": row["part"],
        "title": row["title"],
        "size": row["size"],
        "parent_dir": row["parent_dir"],
        "status": row["status"] or "ignored",
        "magnet_link": row["magnet_link"],
        "magnet_title": row["magnet_title"],
        "message": row["message"],
        "last_checked_at": row["last_checked_at"] or "",
        "replaced_at": row["replaced_at"] or "",
        "created_at": row["created_at"] or "",
        "user_id": row["user_id"],
    }


def add_ignored_missing_sub(
    user_id: int,
    *,
    path: str,
    name: str = "",
    code: str = "",
    part: str = "",
    title: str = "",
    size: str = "",
    parent_dir: str = "",
    message: str = "",
) -> dict:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO ignored_missing_subs (
                user_id, path, name, code, part, title, size, parent_dir, status, message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ignored', ?)
            ON CONFLICT(user_id, path) DO UPDATE SET
                name = excluded.name,
                code = excluded.code,
                part = excluded.part,
                title = excluded.title,
                size = excluded.size,
                parent_dir = excluded.parent_dir,
                status = 'ignored',
                magnet_link = '',
                magnet_title = '',
                message = excluded.message,
                replaced_at = NULL
            """,
            (
                user_id,
                path,
                name or "",
                code or "",
                part or "",
                title or "",
                size or "",
                parent_dir or "",
                message or "",
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM ignored_missing_subs WHERE user_id = ? AND path = ?",
            (user_id, path),
        ).fetchone()
        return _ignored_missing_row(row)


def get_ignored_missing_sub(item_id: int, user_id: int | None = None) -> dict | None:
    with get_connection() as conn:
        if user_id is None:
            row = conn.execute(
                "SELECT * FROM ignored_missing_subs WHERE id = ?",
                (item_id,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM ignored_missing_subs WHERE id = ? AND user_id = ?",
                (item_id, user_id),
            ).fetchone()
        return _ignored_missing_row(row) if row else None


def list_ignored_missing_subs(user_id: int) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM ignored_missing_subs
            WHERE user_id = ?
            ORDER BY CASE status WHEN 'ignored' THEN 0 ELSE 1 END,
                     datetime(created_at) DESC, id DESC
            """,
            (user_id,),
        ).fetchall()
        return [_ignored_missing_row(row) for row in rows]


def list_ignored_missing_paths(user_id: int) -> set[str]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT path FROM ignored_missing_subs WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        return {row["path"] for row in rows if row["path"]}


def list_pending_ignored_missing_subs(user_id: int | None = None) -> list[dict]:
    with get_connection() as conn:
        if user_id is None:
            rows = conn.execute(
                """
                SELECT * FROM ignored_missing_subs
                WHERE status = 'ignored'
                ORDER BY user_id, id
                """
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT * FROM ignored_missing_subs
                WHERE user_id = ? AND status = 'ignored'
                ORDER BY id
                """,
                (user_id,),
            ).fetchall()
        return [_ignored_missing_row(row) for row in rows]


def delete_ignored_missing_sub(item_id: int, user_id: int) -> bool:
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM ignored_missing_subs WHERE id = ? AND user_id = ?",
            (item_id, user_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def update_ignored_missing_sub(
    item_id: int,
    *,
    status: str | None = None,
    magnet_link: str | None = None,
    magnet_title: str | None = None,
    message: str | None = None,
    mark_checked: bool = False,
    mark_replaced: bool = False,
) -> dict | None:
    assignments = []
    values: list = []
    if status is not None:
        assignments.append("status = ?")
        values.append(status)
    if magnet_link is not None:
        assignments.append("magnet_link = ?")
        values.append(magnet_link)
    if magnet_title is not None:
        assignments.append("magnet_title = ?")
        values.append(magnet_title)
    if message is not None:
        assignments.append("message = ?")
        values.append(message)
    if mark_checked:
        assignments.append("last_checked_at = datetime('now')")
    if mark_replaced:
        assignments.append("status = 'replaced'")
        assignments.append("replaced_at = datetime('now')")
        assignments.append("last_checked_at = datetime('now')")
    if not assignments:
        return get_ignored_missing_sub(item_id)
    values.append(item_id)
    with get_connection() as conn:
        conn.execute(
            f"UPDATE ignored_missing_subs SET {', '.join(assignments)} WHERE id = ?",
            values,
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM ignored_missing_subs WHERE id = ?",
            (item_id,),
        ).fetchone()
        return _ignored_missing_row(row) if row else None


def list_user_ids_with_pending_ignored() -> list[int]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT DISTINCT user_id FROM ignored_missing_subs
            WHERE status = 'ignored'
            ORDER BY user_id
            """
        ).fetchall()
        return [int(row["user_id"]) for row in rows]


def get_ignored_missing_sub_by_path(user_id: int, path: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM ignored_missing_subs WHERE user_id = ? AND path = ?",
            (user_id, path),
        ).fetchone()
        return _ignored_missing_row(row) if row else None


def _replace_job_row(row: sqlite3.Row, items: list[dict] | None = None) -> dict:
    folders: list[str] = []
    try:
        raw = json.loads(row["folders_json"] or "[]")
        if isinstance(raw, list):
            folders = [str(item) for item in raw if item]
    except (TypeError, json.JSONDecodeError):
        folders = []
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "folders": folders,
        "status": row["status"] or "running",
        "scanned": int(row["scanned"] or 0),
        "videos": int(row["videos"] or 0),
        "total": int(row["total"] or 0),
        "replaced_count": int(row["replaced_count"] or 0),
        "not_found_count": int(row["not_found_count"] or 0),
        "push_failed_count": int(row["push_failed_count"] or 0),
        "error_count": int(row["error_count"] or 0),
        "message": row["message"] or "",
        "started_at": row["started_at"] or "",
        "finished_at": row["finished_at"] or "",
        "items": items or [],
    }


def _replace_item_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "job_id": row["job_id"],
        "status": row["status"],
        "code": row["code"] or "",
        "name": row["name"] or "",
        "path": row["path"] or "",
        "message": row["message"] or "",
        "magnet_title": row["magnet_title"] or "",
        "created_at": row["created_at"] or "",
    }


def create_nosub_replace_job(user_id: int, folders: list[str]) -> dict:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO nosub_replace_jobs (user_id, folders_json, status)
            VALUES (?, ?, 'running')
            """,
            (user_id, json.dumps(folders, ensure_ascii=False)),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM nosub_replace_jobs WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return _replace_job_row(row)


def add_nosub_replace_item(
    job_id: int,
    *,
    status: str,
    code: str = "",
    name: str = "",
    path: str = "",
    message: str = "",
    magnet_title: str = "",
) -> dict:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO nosub_replace_items (
                job_id, status, code, name, path, message, magnet_title
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (job_id, status, code or "", name or "", path or "", message or "", magnet_title or ""),
        )
        count_col = {
            "replaced": "replaced_count",
            "not_found": "not_found_count",
            "push_failed": "push_failed_count",
            "error": "error_count",
        }.get(status)
        if count_col:
            conn.execute(
                f"UPDATE nosub_replace_jobs SET {count_col} = {count_col} + 1 WHERE id = ?",
                (job_id,),
            )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM nosub_replace_items WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return _replace_item_row(row)


def update_nosub_replace_job(
    job_id: int,
    *,
    status: str | None = None,
    scanned: int | None = None,
    videos: int | None = None,
    total: int | None = None,
    message: str | None = None,
    mark_finished: bool = False,
) -> dict | None:
    assignments = []
    values: list = []
    if status is not None:
        assignments.append("status = ?")
        values.append(status)
    if scanned is not None:
        assignments.append("scanned = ?")
        values.append(int(scanned))
    if videos is not None:
        assignments.append("videos = ?")
        values.append(int(videos))
    if total is not None:
        assignments.append("total = ?")
        values.append(int(total))
    if message is not None:
        assignments.append("message = ?")
        values.append(message)
    if mark_finished:
        assignments.append("finished_at = datetime('now')")
        if status is None:
            assignments.append("status = 'done'")
    if not assignments:
        return get_nosub_replace_job(job_id)
    values.append(job_id)
    with get_connection() as conn:
        conn.execute(
            f"UPDATE nosub_replace_jobs SET {', '.join(assignments)} WHERE id = ?",
            values,
        )
        conn.commit()
    return get_nosub_replace_job(job_id)


def close_stale_nosub_replace_jobs(*, message: str = "服务中断，任务未完成") -> int:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            UPDATE nosub_replace_jobs
            SET status = 'interrupted',
                message = ?,
                finished_at = datetime('now')
            WHERE status = 'running'
            """,
            (message,),
        )
        conn.commit()
        return int(cursor.rowcount or 0)


def get_nosub_replace_job(job_id: int, user_id: int | None = None) -> dict | None:
    with get_connection() as conn:
        if user_id is None:
            row = conn.execute(
                "SELECT * FROM nosub_replace_jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM nosub_replace_jobs WHERE id = ? AND user_id = ?",
                (job_id, user_id),
            ).fetchone()
        if not row:
            return None
        items = conn.execute(
            """
            SELECT * FROM nosub_replace_items
            WHERE job_id = ?
            ORDER BY id
            """,
            (job_id,),
        ).fetchall()
        return _replace_job_row(row, [_replace_item_row(item) for item in items])


def list_nosub_replace_jobs(user_id: int, limit: int = 30) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM nosub_replace_jobs
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (user_id, max(1, min(int(limit or 30), 100))),
        ).fetchall()
        return [_replace_job_row(row) for row in rows]
