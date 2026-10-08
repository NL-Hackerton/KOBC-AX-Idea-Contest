"""운영 DB (SQLite 한 파일).

- calls: 항차별 최신 신고 (키: 항만코드|입항연도|입항횟수|호출부호). row_json 은 parse_calls.parse_item 형식.
- call_versions: 신고가 바뀔 때마다 한 줄 (사전 신고의 정확도 측정용).
- positions: 울산항 항내 선박 위치 (갱신분만).
- decisions, agent_log: 실시간 결정 기록과 에이전트 호출·비용.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

import pandas as pd

from kjit.parse_calls import normalize
from kjit.service.config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS calls (
  key TEXT PRIMARY KEY, port_cd TEXT, port_nm TEXT, clsgn TEXT,
  in_time TEXT, out_time TEXT, in_fac TEXT, out_fac TEXT, in_reqst TEXT, out_reqst TEXT,
  row_json TEXT NOT NULL, row_hash TEXT NOT NULL, first_seen TEXT, last_seen TEXT
);
CREATE INDEX IF NOT EXISTS calls_port_in ON calls(port_cd, in_time);
CREATE INDEX IF NOT EXISTS calls_port_out ON calls(port_cd, out_time);
CREATE TABLE IF NOT EXISTS call_versions (
  key TEXT, fetched_at TEXT, in_reqst TEXT, in_time TEXT, in_fac TEXT, out_reqst TEXT, out_time TEXT, out_fac TEXT,
  row_hash TEXT, PRIMARY KEY (key, row_hash)
);
CREATE TABLE IF NOT EXISTS positions (
  ident TEXT, updt TEXT, fetched TEXT, callsgn TEXT, year TEXT, vyg TEXT, mmsi TEXT, imo TEXT, name TEXT,
  lon REAL, lat REAL, sog REAL, cog REAL, hdg REAL, drft REAL, stts TEXT,
  PRIMARY KEY (ident, updt)
);
CREATE INDEX IF NOT EXISTS positions_updt ON positions(updt);
CREATE TABLE IF NOT EXISTS ingest_log (job TEXT, at TEXT, ok INTEGER, n INTEGER, note TEXT);
CREATE TABLE IF NOT EXISTS decisions (at TEXT, request_json TEXT, response_json TEXT);
CREATE TABLE IF NOT EXISTS agent_log (at TEXT, kind TEXT, model TEXT, in_tokens INTEGER, out_tokens INTEGER, usd REAL, ok INTEGER, note TEXT);
"""


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=30, check_same_thread=False)
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    return con


@contextmanager
def session(path: Path = DB_PATH):
    con = connect(path)
    try:
        yield con
        con.commit()
    finally:
        con.close()


def call_key(row: dict) -> str:
    return f"{row.get('prtAgCd')}|{row.get('etryptYear')}|{row.get('etryptCo')}|{row.get('clsgn')}"


def _iso(v) -> str | None:
    if v is None or (isinstance(v, float) and pd.isna(v)) or v is pd.NaT:
        return None
    if isinstance(v, pd.Timestamp):
        return None if pd.isna(v) else v.isoformat()
    return str(v)


def upsert_calls(con: sqlite3.Connection, rows: list[dict], fetched_at: str) -> int:
    """신고 행들을 넣는다. 내용이 바뀐 항차만 버전을 남긴다. 바뀐 항차 수를 돌려준다."""
    changed = 0
    for r in rows:
        r = {k: _iso(v) if isinstance(v, pd.Timestamp) else v for k, v in r.items()}
        payload = json.dumps(r, ensure_ascii=False, sort_keys=True, default=str)
        h = hashlib.sha1(payload.encode()).hexdigest()[:16]
        key = call_key(r)
        cur = con.execute("SELECT row_hash FROM calls WHERE key=?", (key,)).fetchone()
        if cur and cur[0] == h:
            con.execute("UPDATE calls SET last_seen=? WHERE key=?", (fetched_at, key))
            continue
        changed += 1
        vals = (key, r.get("prtAgCd"), r.get("prtAgNm"), r.get("clsgn"), r.get("in_time"), r.get("out_time"),
                r.get("in_laidupFcltyNm"), r.get("out_laidupFcltyNm"), r.get("in_reqstSeNm"), r.get("out_reqstSeNm"),
                payload, h)
        con.execute(
            """INSERT INTO calls (key, port_cd, port_nm, clsgn, in_time, out_time, in_fac, out_fac, in_reqst, out_reqst,
                                  row_json, row_hash, first_seen, last_seen)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(key) DO UPDATE SET port_cd=excluded.port_cd, port_nm=excluded.port_nm, clsgn=excluded.clsgn,
                 in_time=excluded.in_time, out_time=excluded.out_time, in_fac=excluded.in_fac, out_fac=excluded.out_fac,
                 in_reqst=excluded.in_reqst, out_reqst=excluded.out_reqst, row_json=excluded.row_json,
                 row_hash=excluded.row_hash, last_seen=excluded.last_seen""",
            vals + (fetched_at, fetched_at),
        )
        con.execute(
            "INSERT OR IGNORE INTO call_versions VALUES (?,?,?,?,?,?,?,?,?)",
            (key, fetched_at, r.get("in_reqstSeNm"), r.get("in_time"), r.get("in_laidupFcltyNm"),
             r.get("out_reqstSeNm"), r.get("out_time"), r.get("out_laidupFcltyNm"), h),
        )
    return changed


def load_calls(con: sqlite3.Connection, ports: list[str] | None = None, since: str | None = None) -> pd.DataFrame:
    """calls 를 항차 표(calls.parquet 와 같은 열)로 읽는다."""
    q, args = "SELECT row_json FROM calls WHERE 1=1", []
    if ports:
        q += f" AND port_cd IN ({','.join('?' * len(ports))})"
        args += ports
    if since:
        q += " AND (in_time >= ? OR out_time IS NULL OR out_time >= ?)"
        args += [since, since]
    rows = [json.loads(x[0]) for x in con.execute(q, args)]
    if not rows:
        return pd.DataFrame()
    return normalize(pd.DataFrame(rows))


def insert_positions(con: sqlite3.Connection, rows: list[dict]) -> int:
    n = 0
    for r in rows:
        ident = r.get("callsgn") or r.get("mmsiNo")
        if not ident or not r.get("updtTm"):
            continue
        f = lambda k: float(r[k]) if r.get(k) not in (None, "") else None  # noqa: E731
        cur = con.execute(
            "INSERT OR IGNORE INTO positions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (ident, r["updtTm"], r.get("fetched"), r.get("callsgn"), r.get("ptentYr"), r.get("vyg"), r.get("mmsiNo"),
             r.get("imoNo"), r.get("vslNm"), f("lot"), f("lat"), f("sog"), f("cog"), f("hdgAng"), f("drft"),
             r.get("nvgtStts")),
        )
        n += cur.rowcount
    return n


def log(con: sqlite3.Connection, job: str, at: str, ok: bool, n: int, note: str = "") -> None:
    con.execute("INSERT INTO ingest_log VALUES (?,?,?,?,?)", (job, at, int(ok), n, note[:500]))
