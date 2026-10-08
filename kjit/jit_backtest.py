"""위험 고려 JIT 도착 결정(C)의 시험 구간 백테스트.

시험 구간(2026-08~09)의 정박지→선석 항차 S마다:
1. 결정 시각 tau = 원래 도착 A0 - H (외항 24h, 내항은 실제 항해시간 이내).
2. tau 에 선행 선박 P가 이미 선석에 있으면, tau 이전 마지막 6시간 격자 t* 의 B 예측으로
   선석이 비는 시각 F 의 분위수를 얻는다 (t* <= tau 이므로 미래 정보는 쓰지 않는다).
3. 정책별 도착 A = clip(F_q, A0, A0 + 최대 지연) 을 정하고, 실제 F 와 비교한다.
   - 남은 대기 = max(0, F - A), 늦은 도착(선석 유휴) = max(0, A - F)
   - 절감 연료는 kjit.fuel 로 지연 시간(A - A0)에 대해 계산한다.
P가 tau 에 아직 선석에 없으면(앞에 대기열이 있으면) 이 버전은 결정하지 않고 원래대로 도착시킨다.

    uv run python -m kjit.jit_backtest
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from kjit.fuel import DESIGN_SPEED_KN, MIN_SPEED_KN, MIN_SPEED_RATIO, jit_saving

ROOT = Path(__file__).resolve().parents[1]
PROC = ROOT / "data" / "processed"
TEST_START = pd.Timestamp("2026-08-01", tz="Asia/Seoul")
QCOLS = ["q10", "q20", "q30", "q50", "q70", "q80", "q90"]


def max_delay(group: pd.Series, horizon: pd.Series) -> np.ndarray:
    v0 = group.map(lambda g: DESIGN_SPEED_KN.get(g, 12.0)).to_numpy()
    vmin = np.minimum(np.maximum(v0 * MIN_SPEED_RATIO, MIN_SPEED_KN), v0)
    return horizon.to_numpy() * (v0 / vmin - 1)


def main() -> None:
    sav = pd.read_parquet(PROC / "jit_savings.parquet")
    occ = pd.read_parquet(PROC / "berth_occupancy.parquet")
    pred = pd.read_parquet(PROC / "forecast_predictions.parquet")
    pred[QCOLS] = np.sort(pred[QCOLS].to_numpy(), axis=1)  # 분위수 교차 정리

    S = sav[(sav["in_time"] >= TEST_START) & sav["pred_out"].notna()].copy()
    S["tau"] = S["in_time"] - pd.to_timedelta(S["horizon_h"], unit="h")
    S["gt"] = S["in_intrlGrtg"].fillna(S["in_grtg"])

    # 선행 선박 P의 점유 행 찾기
    occ_key = occ.reset_index().rename(columns={"index": "occ_id"})[["occ_id", "out_berth", "out_time", "start"]]
    S = S.merge(occ_key.rename(columns={"out_time": "pred_out", "start": "p_start"}), on=["out_berth", "pred_out"], how="left")
    S["t_star"] = S["tau"].dt.floor("6h")
    S = S.merge(pred[["occ_id", "t", "h_point"] + QCOLS].rename(columns={"t": "t_star"}), on=["occ_id", "t_star"], how="left")
    S["decidable"] = S["q50"].notna()

    A0 = S["in_time"]
    F = S["pred_out"]
    md = max_delay(S["group"], S["horizon_h"])

    def run(name: str, target: pd.Series | None) -> dict:
        if target is None:
            A = A0.copy()
        else:
            delay = ((target - A0).dt.total_seconds() / 3600).clip(lower=0)
            delay = np.minimum(delay.fillna(0).to_numpy(), md)
            A = A0 + pd.to_timedelta(delay, unit="h")
        d_h = ((A - A0).dt.total_seconds() / 3600).to_numpy()
        resid = ((F - A).dt.total_seconds() / 3600).clip(lower=0)
        late = ((A - F).dt.total_seconds() / 3600).clip(lower=0)
        r = jit_saving_by_horizon(d_h, S)
        return {
            "정책": name,
            "지연 합계 h": round(float(d_h.sum())),
            "남은 대기 h": round(float(resid.sum())),
            "선석 유휴 h": round(float(late.sum())),
            "2h 넘게 늦은 항차": int((late > 2).sum()),
            "절감 연료 t": round(float(r["fuel_t"].sum()), 1),
            "절감 CO2 t": round(float(r["co2_t"].sum()), 1),
        }

    rows = [run("현행 (원래대로 도착)", None), run("완전 정보 (상한)", F)]
    dec = S["decidable"]
    t_star = S["t_star"]

    def from_q(col: str) -> pd.Series:
        f = t_star + pd.to_timedelta(S[col], unit="h")
        return f.where(dec, A0)

    rows.append(run("기준선 H 점예측", (t_star + pd.to_timedelta(S["h_point"], unit="h")).where(dec, A0)))
    for col, label in [("q50", "GBM 중앙값"), ("q30", "GBM q0.3"), ("q20", "GBM q0.2"), ("q10", "GBM q0.1")]:
        rows.append(run(label, from_q(col)))

    out = pd.DataFrame(rows)
    pd.set_option("display.width", 200)
    print(f"시험 항차 {len(S):,}개 중 결정 가능(tau 에 선행 선박이 선석에 있음) {int(dec.sum()):,}개 ({dec.mean():.0%})")
    print(f"실제 선석 대기 합계 {((F - A0).dt.total_seconds() / 3600).clip(lower=0).sum():,.0f}h")
    print(out.to_string(index=False))
    out.to_csv(PROC / "jit_backtest.csv", index=False)
    S.to_parquet(PROC / "jit_backtest_cases.parquet", index=False)


def jit_saving_by_horizon(delay_h: np.ndarray, S: pd.DataFrame) -> dict[str, np.ndarray]:
    """항차마다 권고 범위(horizon)가 달라 묶음별로 계산한다. 지연이 곧 감속 시간이다."""
    fuel = np.zeros(len(S))
    co2 = np.zeros(len(S))
    for h in np.unique(S["horizon_h"]):
        sel = (S["horizon_h"] == h).to_numpy()
        r = jit_saving(delay_h[sel], S.loc[sel, "gt"], S.loc[sel, "group"], float(h))
        fuel[sel], co2[sel] = r["fuel_t"], r["co2_t"]
    return {"fuel_t": fuel, "co2_t": co2}


if __name__ == "__main__":
    main()
