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
        # check_same_thread=False: FastAPI's TestClient (and any sync endpoint
        # dispatched to starlette's threadpool) can call in from a different
        # thread than the one that opened the connection. Safe here since
        # WAL mode + busy_timeout already serialize concurrent access.
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
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
                question_type TEXT,
                approved INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
        """)
        self._migrate_answers_table()
        self._conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_answers_embedding_id ON answers(embedding_id)"
        )
        self._conn.commit()

    def _migrate_answers_table(self):
        """Add columns introduced after the initial release to an existing DB file."""
        cols = {row["name"] for row in self._conn.execute("PRAGMA table_info(answers)")}
        if "question_type" not in cols:
            self._conn.execute("ALTER TABLE answers ADD COLUMN question_type TEXT")
        if "updated_at" not in cols:
            self._conn.execute("ALTER TABLE answers ADD COLUMN updated_at TEXT")
            self._conn.execute("UPDATE answers SET updated_at = created_at WHERE updated_at IS NULL")

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
        embedding_id: str | None = None,
        question_type: str | None = None,
    ):
        """Insert an approved answer, or update it in place if the same
        (question, company, role) was already approved before — this is what
        keeps repeated accepts of the same question from piling up duplicate
        memories while still letting the same question get a fresh
        per-company/per-role entry.
        """
        if embedding_id:
            self._conn.execute(
                """
                INSERT INTO answers
                    (session_id, question, original_answer, final_answer, company, role,
                     embedding, embedding_id, question_type, approved, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
                ON CONFLICT(embedding_id) DO UPDATE SET
                    session_id = excluded.session_id,
                    original_answer = excluded.original_answer,
                    final_answer = excluded.final_answer,
                    embedding = excluded.embedding,
                    question_type = excluded.question_type,
                    updated_at = datetime('now')
                """,
                (session_id, question, original_answer, final_answer, company, role,
                 embedding_json, embedding_id, question_type),
            )
        else:
            self._conn.execute(
                "INSERT INTO answers (session_id, question, original_answer, final_answer, company, role, "
                "embedding, question_type, approved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
                (session_id, question, original_answer, final_answer, company, role, embedding_json, question_type),
            )
        self._conn.commit()

    def close(self):
        if self._conn:
            self._conn.close()


sqlite_store = SQLiteStore()
