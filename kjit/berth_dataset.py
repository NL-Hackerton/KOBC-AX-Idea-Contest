"""선석 가용 예측(B)용 점유 구간과 표본: "지금 이 선석에 붙어 있는 배는 몇 시간 뒤에 떠나는가".

1. 단일 접안 선석(measure_wait 판정)에서 출항한 모든 항차의 점유 구간을 복원한다.
   - exact: 직접 접안, 시작 = 입항 시각
   - pred: 정박지→선석이고 선행 선박이 입항 뒤에 떠남, 시작 = 선행 선박 출항 시각 (이동 시간만큼 오차)
   - assumed: 정박지→선석인데 선행 선박이 이미 떠나 있었음, 시작 = 입항 + 1시간으로 가정
   학습 표본은 exact·pred 만 쓰고, assumed 는 대기열 구성(누가 선석을 쓰는지)에만 쓴다.
2. 6시간 격자의 각 시각 t 에서 점유 중인 항차마다 표본 하나를 만든다. 목표는 잔여 시간 RTD = 출항 - t.
3. 특징은 t 시점에 알 수 있었던 정보만 쓴다 (features_at).
   - 입항 신고 항목(선종, 톤수, 화물톤, 내외항, 입항 목적, 국적, 예선·도선)
   - 경과 시간, 시각·요일·월
   - 같은 선석에서 t 이전에 끝난 최근 5개 항차의 체류 중앙값·마지막 체류
   - 같은 항만에서 t 시점 정박지 대기 척수
   입항 신고의 출항 예정 시각은 최종본으로 덮어쓴 값이라 쓰지 않는다.

    uv run python -m kjit.berth_dataset
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from kjit import measure_wait as mw

ROOT = Path(__file__).resolve().parents[1]
PROC = ROOT / "data" / "processed"
PORTS = ["대산", "울산", "광양", "여천"]
GRID = "6h"
HIST_K = 5
ASSUMED_SHIFT = pd.Timedelta(hours=1)

OCC_COLS = ["prtAgNm", "out_berth", "out_laidupFcltyNm", "clsgn", "group", "vsslKndNm", "in_intrlGrtg", "in_grtg",
            "in_ldadngTon", "in_ibobprtNm", "etryptPurpsNm", "vsslNltyCd", "in_tugYn", "in_piltgYn",
            "route", "in_time", "start", "out_time", "start_kind"]


def occupancy(df: pd.DataFrame, waits: pd.DataFrame, single: set[str]) -> pd.DataFrame:
    direct = df[(df["route"] == "직접 접안") & (df["in_berth"] == df["out_berth"]) & df["out_berth"].isin(single)].copy()
    direct["start"] = direct["in_time"]
    direct["start_kind"] = "exact"
    via = waits.copy()
    waited = via["pred_out"].notna() & (via["pred_out"] > via["in_time"])
    via["start"] = via["pred_out"].where(waited, via["in_time"] + ASSUMED_SHIFT)
    via["start_kind"] = np.where(waited, "pred", "assumed")
    occ = pd.concat([direct[OCC_COLS], via[OCC_COLS]], ignore_index=True)
    occ = occ[occ["out_time"].notna() & (occ["out_time"] > occ["start"])]
    occ = occ[occ["prtAgNm"].isin(PORTS)].sort_values("out_time").reset_index(drop=True)
    occ["dur_h"] = (occ["out_time"] - occ["start"]).dt.total_seconds() / 3600
    occ["train_ok"] = occ["start_kind"].isin(["exact", "pred"])
    return occ


def anchorage_queue(waits: pd.DataFrame) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """항만별 정박지 대기 척수의 계단 함수 (정박지 입항 +1, 접안 또는 출항 -1)."""
    w = waits.copy()
    leave = w["pred_out"].where(w["pred_out"] > w["in_time"], w["in_time"])
    w["leave"] = leave.fillna(w["out_time"])
    out = {}
    for port, g in w.dropna(subset=["leave"]).groupby("prtAgNm"):
        ev = pd.concat([pd.Series(1, index=g["in_time"]), pd.Series(-1, index=g["leave"])]).sort_index()
        out[port] = (ev.index.to_numpy(), ev.cumsum().to_numpy())
    return out


def features_at(pairs: pd.DataFrame, occ: pd.DataFrame, queue: dict, start_override: pd.Series | None = None) -> pd.DataFrame:
    """(occ_id, t) 쌍마다 t 시점에 알 수 있는 특징을 만든다.

    start_override: 아직 접안 전인 항차를 '지금 접안한다면' 으로 평가할 때 시작 시각을 바꿔 준다.
    """
    s = pairs.merge(occ, left_on="occ_id", right_index=True, how="left")
    if start_override is not None:
        s["start"] = start_override.to_numpy()
    s["elapsed_h"] = ((s["t"] - s["start"]).dt.total_seconds() / 3600).clip(lower=0)
    s["hour"] = s["t"].dt.hour
    s["dow"] = s["t"].dt.dayofweek
    s["month"] = s["t"].dt.month
    s["gt"] = s["in_intrlGrtg"].fillna(s["in_grtg"])

    s["berth_med_h"] = np.nan
    s["berth_last_h"] = np.nan
    for b, g in occ.groupby("out_berth"):
        idx = s.index[s["out_berth"] == b]
        if len(idx) == 0:
            continue
        ends = g["out_time"].to_numpy()
        durs = g["dur_h"].to_numpy()
        pos = np.searchsorted(ends, s.loc[idx, "t"].to_numpy(), side="right")
        s.loc[idx, "berth_med_h"] = [np.median(durs[max(0, p - HIST_K):p]) if p > 0 else np.nan for p in pos]
        s.loc[idx, "berth_last_h"] = [durs[p - 1] if p > 0 else np.nan for p in pos]

    s["anch_queue"] = 0
    for port, (times, level) in queue.items():
        idx = s.index[s["prtAgNm"] == port]
        pos = np.searchsorted(times, s.loc[idx, "t"].to_numpy(), side="right")
        s.loc[idx, "anch_queue"] = np.where(pos > 0, level[np.maximum(pos - 1, 0)], 0)
    return s


def samples(occ: pd.DataFrame, queue: dict) -> pd.DataFrame:
    rows = []
    for i, r in occ[occ["train_ok"]].iterrows():
        ts = pd.date_range(r["start"].ceil(GRID), r["out_time"], freq=GRID, inclusive="left")
        if len(ts):
            rows.append(pd.DataFrame({"occ_id": i, "t": ts}))
    s = features_at(pd.concat(rows, ignore_index=True), occ, queue)
    s["rtd_h"] = (s["out_time"] - s["t"]).dt.total_seconds() / 3600
    return s


def build() -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    df = mw.classify(pd.read_parquet(PROC / "calls.parquet"))
    occ_tab = mw.multi_occupancy(df)
    single = set(occ_tab.loc[occ_tab["single"], "berth"])
    waits = mw.berth_wait(df, occ_tab)
    return occupancy(df, waits, single), waits, anchorage_queue(waits)


def main() -> None:
    occ, _, queue = build()
    s = samples(occ, queue)
    s.to_parquet(PROC / "berth_samples.parquet", index=False)
    occ.to_parquet(PROC / "berth_occupancy.parquet", index=True)
    print(f"점유 구간 {len(occ):,}개 ({occ['start_kind'].value_counts().to_dict()}), 학습 표본 {len(s):,}개")
    print(s.groupby("prtAgNm").agg(표본=("rtd_h", "size"), RTD_중앙값=("rtd_h", "median"), 체류_중앙값=("dur_h", "median")).round(1).to_string())


if __name__ == "__main__":
    main()
