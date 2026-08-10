import json
import sqlite3
from pathlib import Path

from backend.config import settings


class SQLiteStore:
    def __init__(self, db_path: str | None = None):
        self.db_path = db_path or settings.sqlite_path
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn: sqlite3.Connection | None = None

    def connect(self):
        self._conn = sqlite3.connect(self.db_path)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute("PRAGMA busy_timeout=5000;")
        self._init_tables()

    def _init_tables(self):
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS profile (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                verified INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS resumes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                embedding BLOB,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                company TEXT,
                role TEXT,
                url TEXT,
                status TEXT DEFAULT 'active',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS answers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                question TEXT NOT NULL,
                original_answer TEXT,
                final_answer TEXT NOT NULL,
                company TEXT,
                role TEXT,
                embedding TEXT,
                embedding_id TEXT,
                approved INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );
        """)
        self._conn.commit()

    def get_profile(self) -> dict[str, str]:
        cursor = self._conn.execute("SELECT key, value FROM profile WHERE verified = 1")
        return {row["key"]: row["value"] for row in cursor.fetchall()}

    def get_profile_key(self, key: str) -> str | None:
        cursor = self._conn.execute(
            "SELECT value FROM profile WHERE key = ? AND verified = 1", (key,)
        )
        row = cursor.fetchone()
        return row["value"] if row else None

    def set_profile(self, key: str, value: str):
        self._conn.execute(
            "INSERT INTO profile (key, value, verified) VALUES (?, ?, 1) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')",
            (key, value),
        )
        self._conn.commit()

    def delete_profile(self, key: str):
        self._conn.execute("DELETE FROM profile WHERE key = ?", (key,))
        self._conn.commit()

    def get_all_fields(self) -> list[dict]:
        cursor = self._conn.execute("SELECT key, value, verified, created_at, updated_at FROM profile")
        return [dict(row) for row in cursor.fetchall()]

    def add_resume(self, name: str, path: str) -> int:
        cursor = self._conn.execute(
            "INSERT INTO resumes (name, path) VALUES (?, ?)", (name, path)
        )
        self._conn.commit()
        return cursor.lastrowid

    def get_resumes(self) -> list[dict]:
        cursor = self._conn.execute("SELECT id, name, path, created_at FROM resumes")
        return [dict(row) for row in cursor.fetchall()]

    def delete_resume(self, resume_id: int):
        self._conn.execute("DELETE FROM resumes WHERE id = ?", (resume_id,))
        self._conn.commit()

    def save_session(self, session_id: str, company: str = "", role: str = "", url: str = ""):
        self._conn.execute(
            "INSERT INTO sessions (id, company, role, url) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET company=excluded.company, role=excluded.role, url=excluded.url, updated_at=datetime('now')",
            (session_id, company, role, url),
        )
        self._conn.commit()

    def save_answer(
        self,
        session_id: str,
        question: str,
        final_answer: str,
        company: str = "",
        role: str = "",
        original_answer: str | None = None,
        embedding_json: str | None = None,
    ):
        self._conn.execute(
            "INSERT INTO answers (session_id, question, original_answer, final_answer, company, role, embedding, approved) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
            (session_id, question, original_answer, final_answer, company, role, embedding_json),
        )
        self._conn.commit()

    def close(self):
        if self._conn:
            self._conn.close()


sqlite_store = SQLiteStore()
