"""Leaderboard routes for MindScore (FastAPI + SQLite)."""
import sqlite3
import time
from contextlib import closing
from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

DB_PATH = "leaderboard.db"
router = APIRouter()


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS scores (
               name_key   TEXT PRIMARY KEY,
               name       TEXT NOT NULL,
               score      REAL NOT NULL,
               updated_at REAL NOT NULL
           )"""
    )
    return conn


class ScoreIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=60)
    score: float = Field(..., ge=0, le=1000)


@router.post("/leaderboard")
def submit_score(body: ScoreIn):
    name = body.name.strip()
    with closing(_db()) as db:
        db.execute(
            """INSERT INTO scores (name_key, name, score, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(name_key) DO UPDATE SET
                   name = excluded.name,
                   score = excluded.score,
                   updated_at = excluded.updated_at""",
            (name.lower(), name, body.score, time.time()),
        )
        db.commit()
    return {"ok": True}


@router.get("/leaderboard")
def get_leaderboard(limit: int = Query(10, ge=1, le=50), name: Optional[str] = None):
    with closing(_db()) as db:
        rows = db.execute(
            "SELECT name, score FROM scores ORDER BY score DESC, updated_at ASC LIMIT ?",
            (limit,),
        ).fetchall()
        me = None
        if name and name.strip():
            row = db.execute(
                "SELECT name, score, updated_at FROM scores WHERE name_key = ?",
                (name.strip().lower(),),
            ).fetchone()
            if row:
                ahead = db.execute(
                    """SELECT COUNT(*) FROM scores
                       WHERE score > ? OR (score = ? AND updated_at < ?)""",
                    (row[1], row[1], row[2]),
                ).fetchone()[0]
                me = {"rank": ahead + 1, "name": row[0], "score": row[1]}
    return {"top": [{"name": n, "score": s} for n, s in rows], "me": me}
