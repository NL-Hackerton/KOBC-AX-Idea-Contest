"""근거 화면용 묶음: 실측 A·B·C 표와 분포, 실관측 검증 현황 (data/processed/web/evidence.json).

    uv run python -m kjit.engine.evidence
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from kjit.service import db
from kjit.service.config import PROC_DIR

WEB_DIR = PROC_DIR / "web"
EDGES = [0, 2, 6, 12, 24, 48, 96]
PORTS = ["대산", "울산", "광양", "여천"]
MIN_N = 5


def wait_section() -> dict:
    summary = pd.read_csv(PROC_DIR / "wait_summary.csv")
    w = pd.read_parquet(PROC_DIR / "berth_waits.parquet")
    w = w[(w["group"] != "작업·지원·여객") & w["berth_wait_h"].notna()]
    hist = {}
    for p in PORTS:
        x = w.loc[w["prtAgNm"] == p, "berth_wait_h"].to_numpy()
        counts = np.histogram(x, bins=EDGES + [1e9])[0]
        hist[p] = {"n": int(len(x)), "share": (counts / max(len(x), 1)).round(4).tolist()}
    # 대기 추정 항차가 5건 미만이면 분포 통계를 내지 않는다 (실측 A 문서의 "-" 와 같은 기준)
    stat_cols = ["대기 중앙값 h", "대기 p75 h", "대기 p90 h", "12h 이상 %"]
    summary.loc[summary["대기 추정 항차"] < MIN_N, stat_cols] = np.nan
    rows = summary.replace({np.nan: None}).to_dict("records")
    return {"summary": rows, "hist": {"edges": EDGES, "ports": hist}}


def forecast_section() -> dict:
    m = pd.read_csv(PROC_DIR / "forecast_metrics.csv")
    return {"metrics": m.to_dict("records"), "split": {"train": "2025-10~2026-05", "calib": "2026-06~07", "test": "2026-08~09"}}


def backtest_section() -> dict:
    qb = pd.read_csv(PROC_DIR / "queue_backtest.csv")
    replay = json.loads((PROC_DIR / "replay" / "cases.json").read_text())
    cov = json.loads((PROC_DIR / "queue_coverage.json").read_text())  # 백테스트가 남긴 값 (문서와 같음)
    return {"table": qb.replace({np.nan: None}).to_dict("records"), "coverage80": cov,
            "cases": len(replay["cases"]), "busy": sum(c["busyAtTau"] for c in replay["cases"])}


def validation_section() -> dict:
    with db.session() as con:
        n, lo, hi = con.execute("SELECT COUNT(*), MIN(updt), MAX(updt) FROM positions").fetchone()
        ships = con.execute("SELECT COUNT(DISTINCT ident) FROM positions").fetchone()[0]
    return {"positions": n, "ships": ships, "from": lo, "to": hi, "status": "collecting",
            "plan": "정박지로 입항해 선석에서 출항한 울산 항차의 실제 이동 시각을 위치로 찾고, 선행 선박 출항으로 추정한 접안 시각과 비교한다 (10/25 중간 결과)."}


def main() -> None:
    out = {"wait": wait_section(), "forecast": forecast_section(), "backtest": backtest_section(),
           "validation": validation_section(),
           "data": {"source": "해양수산부 선박운항정보 OpenAPI (공공데이터포털)", "period": "2025-10-01 ~ 2026-09-30 입항분",
                    "ports": 9, "calls": 129831}}
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    (WEB_DIR / "evidence.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print("coverage80", out["backtest"]["coverage80"], "positions", out["validation"]["positions"])


if __name__ == "__main__":
    main()
