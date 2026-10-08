"""1년 이력과 지금까지 모은 스냅샷·위치를 운영 DB로 옮긴다.

- data/processed/calls.parquet (2025-10~2026-09 최종 신고) → calls
- data/raw/snap/{회차}/*.xml (2026-10-08~ 2시간 스냅샷) → calls·call_versions (회차 시각 순)
- data/raw/ulsan_pos/*.jsonl → positions

    uv run python -m kjit.service.backfill
"""

from __future__ import annotations

import datetime as dt
import glob
import json
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd

from kjit.parse_calls import parse_item
from kjit.service import db
from kjit.service.config import PROC_DIR, RAW_DIR
from kjit.service.ingest import PORTS

KST = dt.timezone(dt.timedelta(hours=9))


def main() -> None:
    with db.session() as con:
        calls = pd.read_parquet(PROC_DIR / "calls.parquet")
        calls = calls[calls["prtAgCd"].isin(PORTS)]
        rows = []
        for r in calls.to_dict("records"):
            rows.append({k: (v.isoformat() if isinstance(v, pd.Timestamp) and not pd.isna(v) else (None if v is pd.NaT or (isinstance(v, float) and pd.isna(v)) else v))
                         for k, v in r.items()})
        n = db.upsert_calls(con, rows, "2026-10-01T00:00:00+09:00")
        print(f"이력 항차 {n:,}건")

        snaps = sorted(Path(p) for p in glob.glob(str(RAW_DIR / "snap" / "*")))
        for d in snaps:
            stamp = dt.datetime.strptime(d.name, "%Y%m%d%H%M").replace(tzinfo=KST).isoformat(timespec="seconds")
            items = [parse_item(it) for f in sorted(d.glob("*.xml")) for it in ET.parse(f).getroot().iter("item")]
            items = [i for i in items if i.get("prtAgCd") in PORTS]
            print(f"스냅샷 {d.name}: {len(items)}건, 변경 {db.upsert_calls(con, items, stamp)}")

        total = 0
        for f in sorted(glob.glob(str(RAW_DIR / "ulsan_pos" / "*.jsonl"))):
            rows = [json.loads(line) for line in open(f, encoding="utf-8")]
            total += db.insert_positions(con, rows)
        print(f"위치 {total:,}건")


if __name__ == "__main__":
    main()
