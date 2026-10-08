"""서비스 설정. 비밀값은 환경 변수(또는 로컬 .env)에서만 읽는다."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _dotenv() -> dict[str, str]:
    p = ROOT / ".env"
    out: dict[str, str] = {}
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


_ENV = _dotenv()


def env(name: str, default: str | None = None) -> str | None:
    return os.environ.get(name) or _ENV.get(name) or default


DATA_DIR = Path(env("KJIT_DATA_DIR", str(ROOT / "data")))
LIVE_DIR = DATA_DIR / "live"
DB_PATH = LIVE_DIR / "kjit.db"
MODEL_DIR = DATA_DIR / "processed" / "models"
PROC_DIR = DATA_DIR / "processed"
RAW_DIR = DATA_DIR / "raw"

DATA_GO_KR_KEY = env("DATA_GO_KR_KEY")
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY")  # 없으면 에이전트는 폴백으로 동작
AGENT_DAILY_USD_CAP = float(env("AGENT_DAILY_USD_CAP", "5") or 5)
INGEST_ENABLED = env("KJIT_INGEST", "0") == "1"  # 수집 스케줄러 (기본 꺼짐, 운영에서 1)
CORS_ORIGINS = [o for o in (env("CORS_ORIGINS", "*") or "*").split(",") if o]
