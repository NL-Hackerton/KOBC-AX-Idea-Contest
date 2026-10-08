"""서버 볼륨에 올릴 데이터 묶음: 실행에 필요한 산출물과 수집 DB의 일관된 사본.

    uv run python -m kjit.service.pack            # → build/kjit-data.tar.gz

수집 중인 DB는 sqlite backup API로 복사하므로 서버를 멈추지 않아도 된다. 원자료(data/raw)와 .env 는 넣지 않는다.
"""

from __future__ import annotations

import sqlite3
import tarfile
import tempfile
from pathlib import Path

from kjit.service import config

RUNTIME = [
    "processed/models", "processed/replay", "processed/sim", "processed/web",
    "processed/wait_summary.csv", "processed/queue_backtest.csv", "processed/queue_coverage.json",
    "processed/forecast_metrics.csv", "processed/berth_waits.parquet", "processed/jit_savings.parquet",
]


def main() -> None:
    out = config.ROOT / "build" / "kjit-data.tar.gz"
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        db_copy = Path(tmp) / "kjit.db"
        src = sqlite3.connect(config.DB_PATH)
        dst = sqlite3.connect(db_copy)
        with dst:
            src.backup(dst)
        src.close()
        dst.close()
        with tarfile.open(out, "w:gz") as tar:
            for rel in RUNTIME:
                tar.add(config.DATA_DIR / rel, arcname=rel)
            tar.add(db_copy, arcname="live/kjit.db")
    print(f"→ {out} ({out.stat().st_size / 1e6:.1f}MB)")


if __name__ == "__main__":
    main()
