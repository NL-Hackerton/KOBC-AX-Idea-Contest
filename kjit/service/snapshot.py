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


GROUPS = {"탱커·가스", "벌크", "일반화물", "컨테이너", "자동차운반", "기타"}


def live_decisions(ctx, states: dict, at: pd.Timestamp) -> dict:
    """저장본 시각의 입항 예정 선박마다 세 정보 조건의 권고를 API와 같은 함수로 미리 계산한다.

    서버 없이 배포한 웹에서 선박을 고르면 이 결과를 보여준다 (웹의 항차 정보 기본값과 같은 입력).
    """
    from fastapi import HTTPException

    from kjit.service import app

    app.STATE["ctx"] = ctx
    out: dict = {}
    for port, st in states.items():
        names = {b["key"]: b["name"] for b in st["singleBerths"]}
        for i in st["inbound"]:
            if i.get("targetKey") not in names:
                continue
            ship = app.ShipIn(vessel=i["vessel"], callsign=i["callsign"], group=i["group"] if i["group"] in GROUPS else "기타",
                              gt=i["gt"] if i["gt"] is not None else 5000, domestic=i["domestic"])
            res = {}
            for cond in ("public", "lineup", "plan"):
                try:
                    res[cond] = app.decision(app.DecisionIn(port=port, berth=names[i["targetKey"]], vessel=ship, eta=i["eta"],
                                                            condition=cond, at=at.isoformat()))
                except HTTPException:
                    pass
            if res:
                out[i["id"]] = res
        print(f"  {port}: 입항 예정 권고 {sum(1 for k in out if k.startswith(next((c for c, n in PORTS.items() if n == port), '')))}척", flush=True)
    return out


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
        "live_decisions": live_decisions(ctx, states, now),
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
