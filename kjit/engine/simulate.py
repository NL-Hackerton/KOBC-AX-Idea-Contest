"""항만 시뮬레이터: 이력 전체에 JIT 정책을 적용한 결과를 집계한다.

1. precompute(): 1년(2025-10~2026-09) 정박지→선석 화물선 항차마다 세 정보 조건의 선석 가용 분포를 만들고,
   위험 수준별 목표 도착 시각을 저장한다 (data/processed/sim/cases.parquet).
2. run(): 항만·기간·조건·위험 수준·참여율을 받아 참여 선박의 도착을 바꾸고 집계한다.

모형은 이력 재생이다. 한 배가 늦게 와서 다음 배가 당겨지는 상호작용은 반영하지 않고, 늦게 도착해
생긴 선석 유휴를 선석 이용률 감소로만 계산한다. 2026-06~07 로 재보정했으므로 2026-08~09 만 표본 밖이다.

    uv run python -m kjit.engine.simulate        # 사전 계산 + 격자 + 검증
"""

from __future__ import annotations

import json

import joblib
import numpy as np
import pandas as pd

from kjit.berth_dataset import build
from kjit.engine.core import CONDITIONS, RISK_LEVELS, Recalibration, hours, max_delay_h, saving_by_horizon
from kjit.queue_backtest import TEST_START, cases, simulate
from kjit.service.config import MODEL_DIR, PROC_DIR

SIM_DIR = PROC_DIR / "sim"
WEB_DIR = PROC_DIR / "web"
YEAR_START = pd.Timestamp("2025-10-01", tz="Asia/Seoul")
PERIODS = {"test": ("2026-08", "2026-09"), "year": ("2025-10", "2026-09")}
PARTICIPATION = (0.25, 0.5, 1.0)
GRID_PORTS = ("울산", "대산", "광양", "여천", "전체")


def precompute() -> pd.DataFrame:
    occ, waits, queue = build()
    bundle = joblib.load(MODEL_DIR / "rtd_quantile.joblib")
    recal = Recalibration.load(MODEL_DIR / "recalibration.json")
    sav = pd.read_parquet(PROC_DIR / "jit_savings.parquet")[["clsgn", "out_time", "horizon_h"]]
    # 시험 구간은 백테스트와 같은 묶음으로 계산해야 같은 난수를 받는다 (문서 수치와 일치)
    parts = [cases(waits, sav, YEAR_START, TEST_START), cases(waits, sav, TEST_START, None)]
    frames = [_targets(S, occ, queue, bundle, recal) for S in parts]
    out = pd.concat(frames, ignore_index=True)
    SIM_DIR.mkdir(parents=True, exist_ok=True)
    out.to_parquet(SIM_DIR / "cases.parquet", index=False)
    # 선석 이용률 분모: 단일 접안 선석의 월별 점유 시간
    occ_m = occ.assign(month=occ["start"].dt.strftime("%Y-%m"))[["prtAgNm", "out_berth", "month", "dur_h"]]
    occ_m.to_parquet(SIM_DIR / "occupancy.parquet", index=False)
    return out


def _targets(S: pd.DataFrame, occ, queue, bundle, recal) -> pd.DataFrame:
    out = pd.DataFrame({
        "port": S["prtAgNm"], "month": S["in_time"].dt.strftime("%Y-%m"), "berth": S["out_laidupFcltyNm"],
        "berth_key": S["out_berth"], "group": S["group"], "gt": S["gt"], "horizon_h": S["horizon_h"],
        "a0_h": hours(S["in_time"]), "f_true_h": hours(S["pred_out"]), "tau_h": hours(S["tau"]),
    })
    for cond in CONDITIONS:
        F, _, _ = simulate(S, occ, queue, bundle, cond)
        for a in RISK_LEVELS:
            out[f"{cond}_{a}"] = np.quantile(F, recal.level(cond, a), axis=1)
    return out


def _months(lo: str, hi: str) -> list[str]:
    return [p.strftime("%Y-%m") for p in pd.period_range(lo, hi, freq="M")]


def run(df: pd.DataFrame, occ: pd.DataFrame, port: str, period: tuple[str, str], condition: str, risk: float,
        participation: float, seed: int = 0) -> dict:
    months = _months(*period)
    sel = df["month"].isin(months) & ((df["port"] == port) if port != "전체" else True)
    d = df[sel].reset_index(drop=True)
    n = len(d)
    if n == 0:
        return {"cases": 0}
    rng = np.random.default_rng(seed)
    part = rng.uniform(size=n) < participation if participation < 1 else np.ones(n, dtype=bool)
    a0, f = d["a0_h"].to_numpy(), d["f_true_h"].to_numpy()
    md = max_delay_h(d["group"], d["horizon_h"])
    target = d[f"{condition}_{risk}"].to_numpy()
    delay = np.where(part, np.minimum(np.clip(target - a0, 0, None), md), 0.0)
    rta = a0 + delay
    wait_now = np.clip(f - a0, 0, None)
    resid = np.clip(f - rta, 0, None)
    extra_idle = np.clip(rta - f, 0, None) - np.clip(a0 - f, 0, None)
    sav = saving_by_horizon(delay, d["gt"], d["group"], d["horizon_h"])
    ub_delay = np.minimum(wait_now, md)
    ub = saving_by_horizon(ub_delay, d["gt"], d["group"], d["horizon_h"])

    o = occ[occ["month"].isin(months) & ((occ["prtAgNm"] == port) if port != "전체" else True)]
    n_berths = o["out_berth"].nunique()
    period_h = (pd.Period(period[1], "M").end_time - pd.Period(period[0], "M").start_time).total_seconds() / 3600
    capacity = max(n_berths * period_h, 1)
    occupied = float(o["dur_h"].sum())

    hist_edges = [0, 1, 3, 6, 9, 12, 15, 24]
    hist = np.histogram(delay[part], bins=hist_edges + [1e9])[0].tolist()
    by_berth = (
        pd.DataFrame({"berth": d["berth"], "wait": wait_now, "resid": resid, "fuel": sav["fuel_t"], "idle": extra_idle, "delay": delay})
        .groupby("berth").agg(cases=("wait", "size"), wait_h=("wait", "sum"), resid_h=("resid", "sum"),
                               delay_h=("delay", "sum"), fuel_t=("fuel", "sum"), idle_h=("idle", "sum"))
        .sort_values("fuel_t", ascending=False).head(15).round(1).reset_index().to_dict("records")
    )
    r1 = lambda x: round(float(x), 1)  # noqa: E731
    return {
        "port": port, "period": list(period), "condition": condition, "risk": risk, "participation": participation,
        "outOfSample": months[0] >= TEST_START.strftime("%Y-%m"),
        "cases": n, "participants": int(part.sum()),
        "waitNowH": r1(wait_now.sum()), "residualWaitH": r1(resid.sum()), "delayH": r1(delay.sum()),
        "fuelT": r1(sav["fuel_t"].sum()), "co2T": r1(sav["co2_t"].sum()),
        "upperFuelT": r1(ub["fuel_t"].sum()), "upperCo2T": r1(ub["co2_t"].sum()),
        "shareOfUpper": r1(100 * sav["fuel_t"].sum() / max(ub["fuel_t"].sum(), 1e-9)),
        "extraIdleH": r1(extra_idle.sum()), "lateOver2h": int((extra_idle > 2).sum()),
        "berths": int(n_berths), "utilBefore": r1(100 * occupied / capacity),
        "utilAfter": r1(100 * (occupied - extra_idle.sum()) / capacity),
        "delayHist": {"edges": hist_edges, "counts": hist}, "byBerth": by_berth,
    }


def grid(df: pd.DataFrame, occ: pd.DataFrame) -> dict:
    out = []
    for pname, period in PERIODS.items():
        for port in GRID_PORTS:
            for cond in CONDITIONS:
                for a in RISK_LEVELS:
                    for p in PARTICIPATION:
                        r = run(df, occ, port, period, cond, a, p)
                        r.pop("byBerth", None) if p != 1.0 else None
                        out.append({"periodKey": pname, **r})
    return {"periods": PERIODS, "participation": list(PARTICIPATION), "rows": out}


def verify(df: pd.DataFrame, occ: pd.DataFrame) -> None:
    """참여율 100%, 2026-08~09, 9개 항만 전체 = 백테스트 표."""
    ref = pd.read_csv(PROC_DIR / "queue_backtest.csv")
    names = {"public": "공개 데이터만", "lineup": "대기 순번 공유", "plan": "선석계획 공유"}
    for cond, label in names.items():
        for a in RISK_LEVELS:
            r = run(df, occ, "전체", PERIODS["test"], cond, a, 1.0)
            row = ref[(ref["정보"] == label) & (ref["정책"] == f"위험 수준 {a}")].iloc[0]
            assert abs(r["fuelT"] - row["절감 연료 t"]) < 0.2, (cond, a, r["fuelT"], row["절감 연료 t"])
            assert abs(r["extraIdleH"] - row["추가 선석 유휴 h"]) <= 1, (cond, a, r["extraIdleH"])
    print("검증: 시뮬레이터(참여율 100%, 시험 구간, 전체) = queue_backtest.csv")


def load() -> tuple[pd.DataFrame, pd.DataFrame]:
    return pd.read_parquet(SIM_DIR / "cases.parquet"), pd.read_parquet(SIM_DIR / "occupancy.parquet")


def main() -> None:
    df = precompute()
    occ = pd.read_parquet(SIM_DIR / "occupancy.parquet")
    verify(df, occ)
    g = grid(df, occ)
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    (WEB_DIR / "simulate_grid.json").write_text(json.dumps(g, ensure_ascii=False, separators=(",", ":")))
    print(f"사례 {len(df):,}건, 격자 {len(g['rows'])}행 → {WEB_DIR / 'simulate_grid.json'}")
    for port in GRID_PORTS:
        r = run(df, occ, port, PERIODS["year"], "plan", 0.1, 1.0)
        print(port, {k: r[k] for k in ("cases", "fuelT", "co2T", "shareOfUpper", "extraIdleH", "utilBefore", "utilAfter")})


if __name__ == "__main__":
    main()
