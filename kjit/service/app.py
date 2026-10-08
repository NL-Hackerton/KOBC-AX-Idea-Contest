"""K-JIT API 서버.

    uv run python -m kjit.service.app            # :8000
"""

from __future__ import annotations

import datetime as dt

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from kjit.service import config

KST = dt.timezone(dt.timedelta(hours=9))

app = FastAPI(title="K-JIT API", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "now": dt.datetime.now(KST).isoformat(timespec="seconds"),
        "ingestEnabled": config.INGEST_ENABLED,
        "agentEnabled": bool(config.ANTHROPIC_API_KEY),
    }


def main() -> None:
    import uvicorn

    uvicorn.run("kjit.service.app:app", host="0.0.0.0", port=int(config.env("PORT", "8000") or 8000))


if __name__ == "__main__":
    main()
