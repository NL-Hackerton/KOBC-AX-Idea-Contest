"""재생 사례(2026-08~09 시험 구간 1,253항차)와 재보정 파일을 만든다.

백테스트(kjit.queue_backtest)와 같은 함수·같은 난수로 계산하므로, 사례 값을 합치면
data/processed/queue_backtest.csv 와 같아야 한다 (verify 가 확인한다).

    uv run python -m kjit.engine.replay
"""

from __future__ import annotations

import json

import joblib
import numpy as np
import pandas as pd

from kjit.berth_dataset import build
from kjit.engine.core import CONDITIONS, NOMINAL, RISK_LEVELS, Recalibration, fuel_per_day, design_speed, from_hours, hours, max_delay_h, policies
from kjit.queue_backtest import CALIB_START, TEST_START, cases, pit, simulate
from kjit.service.config import MODEL_DIR, PROC_DIR

OUT_DIR = PROC_DIR / "replay"
LABELS = {
    "public": ("공개 데이터만", "지금 선석에 붙어 있는 배만 안다"),
    "lineup": ("대기 순번 공유", "정박지에서 기다리는 앞 순번 배의 목적 선석과 순번을 안다"),
    "plan": ("선석계획 공유", "앞으로 올 배의 순서와 도착 예정까지 안다"),
}


def iso(ts) -> str | None:
    if ts is None or pd.isna(ts):
        return None
    return pd.Timestamp(ts).tz_convert("Asia/Seoul").isoformat(timespec="minutes")


def r1(x) -> float | None:
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), 1)


def case_id(r) -> str:
    return f"{r['prtAgCd']}-{r['etryptYear']}-{r['etryptCo']}-{r['clsgn']}"


def main() -> None:
    occ, waits, queue = build()
    bundle = joblib.load(MODEL_DIR / "rtd_quantile.joblib")
    sav = pd.read_parquet(PROC_DIR / "jit_savings.parquet")[["clsgn", "out_time", "horizon_h"]]
    S_cal = cases(waits, sav, CALIB_START, TEST_START)
    S = cases(waits, sav, TEST_START, None)

    tau_h = hours(S["tau"])
    a0_h = hours(S["in_time"])
    f_true = hours(S["pred_out"])
    busy = f_true > tau_h

    pits, per_cond = {}, {}
    for cond in CONDITIONS:
        F_cal, _, _ = simulate(S_cal, occ, queue, bundle, cond)
        busy_cal = hours(S_cal["pred_out"]) > hours(S_cal["tau"])
        pits[cond] = np.sort(pit(F_cal[busy_cal], hours(S_cal["pred_out"])[busy_cal]))
        F, M, qmat = simulate(S, occ, queue, bundle, cond)
        per_cond[cond] = (F, M, qmat)
    recal = Recalibration(pits)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    recal.save(MODEL_DIR / "recalibration.json")

    out_cases = []
    pol_by_cond = {}
    for cond in CONDITIONS:
        F, _, _ = per_cond[cond]
        levels = {a: recal.level(cond, a) for a in RISK_LEVELS}
        pol_by_cond[cond] = policies(F, levels, a0_h, S["group"], S["gt"], S["horizon_h"], f_true)

    md = max_delay_h(S["group"], S["horizon_h"])
    v0 = design_speed(S["group"])
    fpd = fuel_per_day(S["gt"], S["group"])
    for i, r in S.iterrows():
        c = {
            "id": case_id(r), "port": r["prtAgNm"], "portCode": r["prtAgCd"],
            "vessel": r["vsslNm"], "callsign": r["clsgn"], "group": r["group"], "kind": r["vsslKndNm"],
            "gt": int(r["gt"]) if pd.notna(r["gt"]) else None,
            "cargoTon": int(r["in_ldadngTon"]) if pd.notna(r["in_ldadngTon"]) else None,
            "domestic": r["in_ibobprtNm"] == "내항",
            "berth": r["out_laidupFcltyNm"], "anchorage": r["in_laidupFcltyNm"],
            "a0": iso(r["in_time"]), "tau": iso(r["tau"]), "horizonH": r1(r["horizon_h"]),
            "designSpeedKn": r1(v0[i]), "fuelPerDayT": r1(fpd[i]), "maxDelayH": r1(md[i]),
            "actualFree": iso(r["pred_out"]), "actualWaitH": r1(max(0.0, f_true[i] - a0_h[i])),
            "busyAtTau": bool(busy[i]), "conditions": {},
        }
        for cond in CONDITIONS:
            F, M, qmat = per_cond[cond]
            levels = [recal.level(cond, a) for a in NOMINAL]
            qs = np.sort(np.quantile(F[i], levels) - tau_h[i]) if busy[i] else np.zeros(len(NOMINAL))
            queue_rows = []
            if not M.empty:
                for j in M.index[M["s_id"] == i]:
                    m = M.loc[j]
                    o = occ.loc[m["occ_id"]]
                    started = bool(m["started"])
                    waiting = (not started) and o["in_time"] <= r["tau"]
                    queue_rows.append({
                        "vessel": o["vsslNm"], "callsign": o["clsgn"], "group": o["group"],
                        "status": "berthed" if started else ("waiting" if waiting else "planned"),
                        "elapsedH": r1((r["tau"] - o["start"]).total_seconds() / 3600) if started else None,
                        "arrivedAt": iso(o["in_time"]) if waiting else None,
                        "plannedAt": iso(o["in_time"]) if not started and not waiting else None,
                        "predQ": [r1(x) for x in qmat[j]],
                        "actualDepart": iso(o["out_time"]),
                    })
            pol = {}
            for a in RISK_LEVELS:
                p = pol_by_cond[cond][a]
                pol[str(a)] = {
                    "rta": iso(from_hours(p["rta_h"][i])), "delayH": r1(p["delay_h"][i]),
                    "speedKn": r1(p["speed_kn"][i]), "fuelT": r1(p["fuel_t"][i]), "co2T": r1(p["co2_t"][i]),
                    "residualWaitH": r1(p["residual_wait_h"][i]), "extraIdleH": r1(p["extra_idle_h"][i]),
                }
            c["conditions"][cond] = {"quantilesH": [r1(x) for x in qs], "queue": queue_rows, "policies": pol}
        out_cases.append(c)

    featured = pick_featured(out_cases)
    payload = {
        "generated": pd.Timestamp.now(tz="Asia/Seoul").isoformat(timespec="seconds"),
        "period": ["2026-08-01", "2026-09-30"],
        "nominal": list(NOMINAL),
        "riskLevels": list(RISK_LEVELS),
        "conditions": {k: {"label": v[0], "desc": v[1]} for k, v in LABELS.items()},
        "featured": featured,
        "cases": out_cases,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "cases.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    verify(pol_by_cond)
    print(f"재생 사례 {len(out_cases):,}건 (선석 점유 {int(busy.sum())}), 대표 {featured}")
    print(f"→ {OUT_DIR / 'cases.json'} ({(OUT_DIR / 'cases.json').stat().st_size / 1e6:.1f}MB)")


def pick_featured(cs: list[dict]) -> list[str]:
    good: dict[str, list[tuple[float, str]]] = {}
    bad = []
    for c in cs:
        if not c["busyAtTau"]:
            continue
        p = c["conditions"]["plan"]["policies"]["0.1"]
        if p["delayH"] >= 6 and p["extraIdleH"] <= 1 and c["actualWaitH"] >= 12:
            good.setdefault(c["port"], []).append((p["fuelT"], c["id"]))
        if p["extraIdleH"] > 2:
            bad.append((p["extraIdleH"], c["id"]))
    out = []
    for port in ("울산", "대산", "광양", "여천"):
        out += [cid for _, cid in sorted(good.get(port, []), reverse=True)[:2]]
    if bad:
        out.append(sorted(bad)[len(bad) // 2][1])
    return out


def verify(pol_by_cond: dict) -> None:
    """정책 합계가 백테스트 표와 같은지 확인한다."""
    ref = pd.read_csv(PROC_DIR / "queue_backtest.csv")
    names = {"public": "공개 데이터만", "lineup": "대기 순번 공유", "plan": "선석계획 공유"}
    for cond, label in names.items():
        for a in RISK_LEVELS:
            row = ref[(ref["정보"] == label) & (ref["정책"] == f"위험 수준 {a}")].iloc[0]
            got = round(float(pol_by_cond[cond][a]["fuel_t"].sum()), 1)
            assert abs(got - row["절감 연료 t"]) < 0.11, (cond, a, got, row["절감 연료 t"])
            idle = round(float(pol_by_cond[cond][a]["extra_idle_h"].sum()))
            assert abs(idle - row["추가 선석 유휴 h"]) <= 1, (cond, a, idle, row["추가 선석 유휴 h"])
    print("검증: 정책 합계가 queue_backtest.csv 와 일치")


if __name__ == "__main__":
    main()
