"""웹 앱 내장용 저장본: 서버가 응답하지 않을 때 같은 화면을 띄우는 데이터 묶음.

    uv run python -m kjit.service.snapshot --out web/src/data/snapshot.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from kjit.service import config
from kjit.service.ingest import PORTS


def build(ctx=None) -> dict:
    from kjit.service.state import Context, port_state

    ctx = ctx or Context()
    replay = json.loads((config.PROC_DIR / "replay" / "cases.json").read_text())
    now = pd.Timestamp.now(tz="Asia/Seoul").floor("min")
    states = {p: port_state(ctx, p, now) for p in PORTS.values()}
    out = {
        "meta": {"snapshotDate": now.isoformat(timespec="minutes"), "generated": now.isoformat(timespec="minutes")},
        "ports": [{"code": k, "name": v, "berths": ctx.berths(v)} for k, v in PORTS.items()],
        "states": states,
        "replay": replay,
    }
    for name in ("evidence.json", "simulate_grid.json", "cii_constants.json", "agent_examples.json"):
        p = config.PROC_DIR / "web" / name
        if p.exists():
            out[name.removesuffix(".json")] = json.loads(p.read_text())
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(config.ROOT / "web" / "src" / "data" / "snapshot.json"))
    args = ap.parse_args()
    data = build()
    Path(args.out).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(f"저장본 → {args.out} ({Path(args.out).stat().st_size / 1e6:.1f}MB)")


if __name__ == "__main__":
    main()
