"""추정한 선석 대기를 JIT 감속으로 바꿨을 때의 항만별 연간 절감량 (완전 정보 상한).

- 대기: measure_wait 의 선석 대기 하한 (data/processed/berth_waits.parquet)
- 감속 가능 시간: 외항은 도착 24시간 전에 권고를 받는다고 본다. 내항은 수집한 9개 항만에서
  같은 호출부호의 직전 출항 기록을 찾아 실제 항해시간으로 자르고, 못 찾으면 12시간으로 둔다.
- 대기를 미리 정확히 안다는 가정의 상한이다. 예측 오차를 반영한 현실값은 B·C 단계에서 계산한다.

    uv run python -m kjit.savings
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from kjit.fuel import jit_saving

ROOT = Path(__file__).resolve().parents[1]
PROC = ROOT / "data" / "processed"

FOREIGN_HORIZON_H = 24.0
DOMESTIC_DEFAULT_H = 12.0


def leg_hours(calls: pd.DataFrame, waits: pd.DataFrame) -> pd.Series:
    """내항 항차의 직전 항만 출항 → 이번 입항까지 걸린 시간."""
    deps = calls.dropna(subset=["out_time"])[["clsgn", "prtAgCd", "out_time"]].sort_values("out_time")
    arr = waits[["clsgn", "prtAgCd", "in_time"]].reset_index().sort_values("in_time")
    m = pd.merge_asof(
        arr, deps.rename(columns={"prtAgCd": "prev_port", "out_time": "prev_out"}),
        left_on="in_time", right_on="prev_out", by="clsgn", direction="backward",
        tolerance=pd.Timedelta(days=5),
    )
    m = m[m["prev_port"] != m["prtAgCd"]]
    h = (m["in_time"] - m["prev_out"]).dt.total_seconds() / 3600
    return pd.Series(h.to_numpy(), index=m["index"])


def main() -> None:
    calls = pd.read_parquet(PROC / "calls.parquet")
    waits = pd.read_parquet(PROC / "berth_waits.parquet").dropna(subset=["berth_wait_h"])
    waits = waits[waits["group"] != "작업·지원·여객"].copy()

    legs = leg_hours(calls, waits)
    waits["leg_h"] = legs.reindex(waits.index)
    domestic = waits["in_ibobprtNm"].eq("내항")
    horizon = np.where(domestic, waits["leg_h"].fillna(DOMESTIC_DEFAULT_H).clip(upper=FOREIGN_HORIZON_H), FOREIGN_HORIZON_H)
    gt = waits["in_intrlGrtg"].fillna(waits["in_grtg"])

    rows = []
    for h_val in np.unique(horizon):
        sel = horizon == h_val
        r = jit_saving(waits.loc[sel, "berth_wait_h"], gt[sel], waits.loc[sel, "group"], float(h_val))
        rows.append(pd.DataFrame(r, index=waits.index[sel]))
    sav = pd.concat(rows).reindex(waits.index)
    waits = waits.join(sav)
    waits["horizon_h"] = horizon

    months = calls["in_time"].dt.to_period("M").nunique()
    by_port = waits.groupby("prtAgNm").agg(
        대기_항차=("berth_wait_h", "size"),
        대기_합계_h=("berth_wait_h", "sum"),
        감속_전환_h=("shift_h", "sum"),
        절감_연료_t=("fuel_t", "sum"),
        절감_CO2_t=("co2_t", "sum"),
    ).round(0)
    by_port["관측_개월"] = months
    print("== 항만별 JIT 절감 상한 (단일 접안 선석 대기 추정 항차만, 관측 기간 합계)")
    print(by_port.sort_values("절감_CO2_t", ascending=False).to_string())
    print("\n전체:", by_port[["대기_합계_h", "감속_전환_h", "절감_연료_t", "절감_CO2_t"]].sum().round(0).to_dict())
    print("\n== 선종별")
    print(waits.groupby("group")[["berth_wait_h", "shift_h", "fuel_t", "co2_t"]].sum().round(0).to_string())
    waits.to_parquet(PROC / "jit_savings.parquet")
    by_port.to_csv(PROC / "jit_savings_by_port.csv")


if __name__ == "__main__":
    main()
