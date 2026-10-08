"""대기열 기반 선석 가용 예측과 위험 고려 JIT 결정(C)의 시험 구간 백테스트.

시험 구간(2026-08~09) 정박지→선석 항차 S마다 결정 시각 tau = A0 - H 에서:
1. S가 쓸 선석의 대기열: tau 이후 S의 접안 전까지 그 선석에서 출항하는 항차들 (출항 순서).
   선석 배정 순서와 앞 순번 선박의 도착 예정은 tau 에 항만 선석계획으로 알려져 있다고 가정한다
   (앞 순번 선박의 도착은 실제 입항 시각을 쓴다).
2. 각 선박의 남은 체류를 B 모델의 분위수로 예측한다.
   - tau 에 이미 접안 중: 경과 시간을 반영한 잔여 시간 분포
   - 아직 접안 전: tau 시점 특징으로 '지금 접안한다면' 의 체류 분포 (경과 0)
3. 분위수를 잇는 역CDF에서 N개 표본을 뽑아 대기열을 순서대로 굴려 선석이 비는 시각 F 의 분포를 얻는다.
4. 정책별 도착 A = clip(F_q, A0, A0 + 최대 지연) 을 정하고 실제 F 와 비교한다.

    uv run python -m kjit.queue_backtest
"""

from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from kjit.berth_dataset import build, features_at
from kjit.forecast import predict_quantiles
from kjit.jit_backtest import jit_saving_by_horizon, max_delay

ROOT = Path(__file__).resolve().parents[1]
PROC = ROOT / "data" / "processed"
CALIB_START = pd.Timestamp("2026-06-01", tz="Asia/Seoul")
TEST_START = pd.Timestamp("2026-08-01", tz="Asia/Seoul")
N_SAMPLES = 400
U_KNOTS = np.array([0.0, 0.1, 0.2, 0.3, 0.5, 0.7, 0.8, 0.9, 1.0])
EPOCH = pd.Timestamp("2025-01-01", tz="Asia/Seoul")


def hours(ts: pd.Series) -> np.ndarray:
    """시각을 기준 시점 이후 시간[h]으로 (datetime 해상도와 무관)."""
    return ((ts - EPOCH).dt.total_seconds() / 3600).to_numpy()


def inv_cdf(qmat: np.ndarray, u: np.ndarray) -> np.ndarray:
    """qmat: (n, 7) 분위수 [0.1, 0.2, 0.3, 0.5, 0.7, 0.8, 0.9], u: (n, k) 균등 표본 → (n, k) 시간 표본.

    0.9 까지는 분위수를 선형으로 잇고, 그 위는 지수 꼬리로 늘인다.
    꼬리 척도는 지수분포에서 q0.9 - q0.7 = lam * ln 3 이 되도록 정한다.
    """
    q10, q20, q70, q90 = qmat[:, 0], qmat[:, 1], qmat[:, 4], qmat[:, 6]
    lo = np.clip(q10 - (q20 - q10), 0, None)
    knots = np.column_stack([lo, qmat])
    body = np.empty_like(u)
    for i in range(len(qmat)):
        body[i] = np.interp(u[i], U_KNOTS[:-1], knots[i])
    lam = np.maximum((q90 - q70) / np.log(3), 1.0)[:, None]
    tail = q90[:, None] + lam * -np.log(np.clip((1 - u) / 0.1, 1e-9, 1))
    return np.where(u > 0.9, tail, body)


def simulate(S: pd.DataFrame, occ: pd.DataFrame, queue: dict, bundle: dict, info: str) -> tuple[np.ndarray, pd.DataFrame]:
    """결정 시각 tau 에서 S가 쓸 선석이 비는 시각 F 의 표본 (len(S), N_SAMPLES).

    info="plan": 앞 순번 선박과 도착 예정을 선석계획으로 안다고 가정
    info="lineup": tau 까지 입항한 선박만 넣는다. 정박지 대기 선박의 목적 선석과 순번(대리점·터미널 line-up)은 안다고 본다
    info="public": tau 에 그 선석에 접안 중인 선박만 넣는다. 공개 입출항 신고만으로 알 수 있는 조건이다
    모든 조건에서 S 자신이 쓸 선석(터미널 지정)은 안다고 가정한다.
    """
    members = []
    by_berth = {b: g for b, g in occ.groupby("out_berth")}
    for si, r in S.iterrows():
        g = by_berth.get(r["out_berth"])
        if g is None:
            continue
        chain = g[(g["out_time"] > r["tau"]) & (g["out_time"] <= r["pred_out"])]
        if info == "lineup":
            chain = chain[chain["in_time"] <= r["tau"]]
        elif info == "public":
            chain = chain[chain["start"] <= r["tau"]]
        for k, (occ_id, c) in enumerate(chain.iterrows()):
            members.append({"s_id": si, "pos": k, "occ_id": occ_id, "t": r["tau"],
                            "started": c["start"] <= r["tau"], "arr": max(c["in_time"], r["tau"])})
    M = pd.DataFrame(members, columns=["s_id", "pos", "occ_id", "t", "started", "arr"])
    tau_s = hours(S["tau"])
    F = np.repeat(tau_s[:, None], N_SAMPLES, axis=1)  # 대기열이 비면 tau 에 이미 선석이 비어 있다
    if M.empty:
        return F, M

    # 특징과 분위수 예측: 접안 전 원소는 경과 0 으로 평가
    feats = features_at(M[["occ_id", "t"]], occ, queue)
    feats.loc[~M["started"].to_numpy(), "elapsed_h"] = 0.0
    q = predict_quantiles(bundle, feats)
    qmat = np.column_stack([q[k] for k in sorted(q)])
    rng = np.random.default_rng(0)  # 조건·순서와 무관하게 같은 표본을 쓰도록 호출마다 고정
    dur = inv_cdf(qmat, rng.uniform(size=(len(M), N_SAMPLES)))  # 접안 중이면 잔여, 아니면 전체 체류 [h]
    arr_h = hours(pd.to_datetime(M["arr"]))
    for si, g in M.groupby("s_id", sort=False):
        t_free = np.full(N_SAMPLES, tau_s[si])
        for j in g.sort_values("pos").index:
            if M.at[j, "started"]:
                t_free = tau_s[si] + dur[j]
            else:
                t_free = np.maximum(t_free, arr_h[j]) + dur[j]
        F[si] = t_free
    return F, M


def cases(waits: pd.DataFrame, sav: pd.DataFrame, lo: pd.Timestamp, hi: pd.Timestamp | None) -> pd.DataFrame:
    """정박지→선석 화물선 항차 중 선행 선박 출항 시각이 있는 것 (입항 시각 lo 이상, hi 미만)."""
    sel = (waits["in_time"] >= lo) & waits["pred_out"].notna() & (waits["group"] != "작업·지원·여객")
    if hi is not None:
        sel &= waits["in_time"] < hi
    S = waits[sel].merge(sav, on=["clsgn", "out_time"], how="inner")
    S["tau"] = S["in_time"] - pd.to_timedelta(S["horizon_h"], unit="h")
    S["gt"] = S["in_intrlGrtg"].fillna(S["in_grtg"])
    return S.reset_index(drop=True)


def pit(F: np.ndarray, truth: np.ndarray) -> np.ndarray:
    """실제 값이 예측 표본 분포에서 차지하는 누적 확률 (probability integral transform)."""
    return (F <= truth[:, None]).mean(axis=1)


def main() -> None:
    occ, waits, queue = build()
    bundle = joblib.load(PROC / "models" / "rtd_quantile.joblib")
    sav = pd.read_parquet(PROC / "jit_savings.parquet")[["clsgn", "out_time", "horizon_h"]]
    S_cal = cases(waits, sav, CALIB_START, TEST_START)
    S = cases(waits, sav, TEST_START, None)

    A0 = hours(S["in_time"])
    F_true = hours(S["pred_out"])
    md = max_delay(S["group"], S["horizon_h"])
    late_now = np.clip(A0 - F_true, 0, None)

    def run(name: str, target: np.ndarray) -> dict:
        delay = np.minimum(np.clip(target - A0, 0, None), md)
        A = A0 + delay
        resid = np.clip(F_true - A, 0, None)
        late = np.clip(A - F_true, 0, None)
        extra_idle = late - late_now
        r = jit_saving_by_horizon(delay, S)
        return {"정책": name, "지연 합계 h": round(delay.sum()), "남은 대기 h": round(resid.sum()),
                "추가 선석 유휴 h": round(extra_idle.sum()), "추가 유휴 2h 초과 항차": int((extra_idle > 2).sum()),
                "절감 연료 t": round(r["fuel_t"].sum(), 1), "절감 CO2 t": round(r["co2_t"].sum(), 1)}

    pd.set_option("display.width", 220)
    print(f"보정 항차 {len(S_cal):,}개, 시험 항차 {len(S):,}개, 시험 실제 선석 대기 합계 {np.clip(F_true - A0, 0, None).sum():,.0f}h")
    rows = [dict(정보="-", 보정="-", **run("현행 (원래대로 도착)", A0)), dict(정보="-", 보정="-", **run("완전 정보 (상한)", F_true))]
    out_cases = S.copy()
    calib_info = {}
    for info, label in [("public", "공개 데이터만"), ("lineup", "대기 순번 공유"), ("plan", "선석계획 공유")]:
        # 보정 구간 PIT 로 예측 분포를 재보정한다: 수준 a 의 결정 분위수 = PIT_cal 의 a 분위수
        # 결정 시각에 선석이 이미 비어 있던 항차는 예측이 한 점(tau)이라 보정·적중률 계산에서 뺀다
        F_cal, _ = simulate(S_cal, occ, queue, bundle, info)
        busy_cal = hours(S_cal["pred_out"]) > hours(S_cal["tau"])
        p_cal = pit(F_cal[busy_cal], hours(S_cal["pred_out"])[busy_cal])
        F, M = simulate(S, occ, queue, bundle, info)
        recal = lambda a: float(np.quantile(p_cal, a))  # noqa: E731
        busy = F_true > hours(S["tau"])
        for tag, lo_q, hi_q in [("원래", 0.1, 0.9), ("재보정", recal(0.1), recal(0.9))]:
            inside = (F_true >= np.quantile(F, lo_q, axis=1)) & (F_true <= np.quantile(F, hi_q, axis=1))
            print(f"[{label}·{tag}] 선석이 차 있던 {busy.sum()}건의 80% 구간 적중률 {inside[busy].mean():.3f} (사용 분위수 {lo_q:.3f}~{hi_q:.3f})")
        print(f"[{label}] 보정 PIT: 0 {np.mean(p_cal == 0):.2f}, 1 {np.mean(p_cal == 1):.2f}, n={len(p_cal)}")
        print(f"[{label}] 선석 가용 시각 MAE(중앙값) {np.mean(np.abs(np.median(F, axis=1) - F_true)):.1f}h, 대기열 평균 길이 {len(M) / len(S):.2f}")
        calib_info[info] = {a: recal(a) for a in (0.1, 0.2, 0.3, 0.5, 0.9)}
        for a in (0.5, 0.3, 0.2, 0.1):
            rows.append(dict(정보=label, 보정="재보정", **run(f"위험 수준 {a}", np.quantile(F, recal(a), axis=1))))
        for a in (0.1, 0.2, 0.5, 0.9):
            out_cases[f"{info}_F_q{int(a * 100):02d}"] = np.quantile(F, recal(a), axis=1)
        out_cases[f"{info}_chain_len"] = M.groupby("s_id").size().reindex(S.index).fillna(0).to_numpy()
    out = pd.DataFrame(rows)
    print(out.to_string(index=False))
    out.to_csv(PROC / "queue_backtest.csv", index=False)
    out_cases.to_parquet(PROC / "queue_backtest_cases.parquet")
    pd.Series({f"{k}_{a}": v for k, d in calib_info.items() for a, v in d.items()}).to_json(PROC / "queue_recalibration.json")


if __name__ == "__main__":
    main()
