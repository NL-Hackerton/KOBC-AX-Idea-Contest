"""K-JIT 엔진의 공통 계산: 시간 변환, 역CDF 표본, 대기열 굴리기, 재보정, 정책.

백테스트(kjit.queue_backtest)와 실시간 결정(kjit.engine.decide)이 같은 함수를 쓴다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from kjit.fuel import DESIGN_SPEED_KN, MIN_SPEED_KN, MIN_SPEED_RATIO, daily_fuel, jit_saving

N_SAMPLES = 400
RISK_LEVELS = (0.1, 0.2, 0.3, 0.5)
NOMINAL = tuple(round(0.05 * k, 2) for k in range(1, 20))  # 0.05 … 0.95
CONDITIONS = ("public", "lineup", "plan")
U_KNOTS = np.array([0.0, 0.1, 0.2, 0.3, 0.5, 0.7, 0.8, 0.9, 1.0])
EPOCH = pd.Timestamp("2025-01-01", tz="Asia/Seoul")
KST = "Asia/Seoul"


def hours(ts: pd.Series) -> np.ndarray:
    """시각을 기준 시점 이후 시간[h]으로 (datetime 해상도와 무관)."""
    return ((ts - EPOCH).dt.total_seconds() / 3600).to_numpy()


def from_hours(h: float) -> pd.Timestamp:
    return EPOCH + pd.to_timedelta(float(h), unit="h")


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


def roll_chain(tau_h: float, started: np.ndarray, arr_h: np.ndarray, dur: np.ndarray) -> np.ndarray:
    """대기열을 순서대로 굴려 선석이 비는 시각 표본을 만든다.

    started[j]: tau 에 접안 중인지, arr_h[j]: 접안 가능한 가장 이른 시각(도착), dur[j]: (k,) 체류 표본
    (접안 중이면 남은 체류, 아니면 전체 체류).
    """
    k = dur.shape[1] if dur.ndim == 2 and len(dur) else N_SAMPLES
    t_free = np.full(k, tau_h)
    for j in range(len(started)):
        if started[j]:
            t_free = tau_h + dur[j]
        else:
            t_free = np.maximum(t_free, arr_h[j]) + dur[j]
    return t_free


@dataclass
class Recalibration:
    """보정 구간 PIT 로 명목 수준 a 를 표본 분위수 수준으로 바꾼다 (조건별)."""

    pit: dict[str, np.ndarray]

    def level(self, condition: str, a: float) -> float:
        return float(np.quantile(self.pit[condition], a))

    def save(self, path: Path) -> None:
        path.write_text(json.dumps({k: np.round(v, 5).tolist() for k, v in self.pit.items()}))

    @classmethod
    def load(cls, path: Path) -> "Recalibration":
        return cls({k: np.asarray(v) for k, v in json.loads(path.read_text()).items()})


def design_speed(group) -> np.ndarray:
    return np.vectorize(lambda g: DESIGN_SPEED_KN.get(g, 12.0))(np.asarray(group))


def max_delay_h(group, horizon_h) -> np.ndarray:
    v0 = design_speed(group)
    vmin = np.minimum(np.maximum(v0 * MIN_SPEED_RATIO, MIN_SPEED_KN), v0)
    return np.asarray(horizon_h, dtype=float) * (v0 / vmin - 1)


def saving_by_horizon(delay_h: np.ndarray, gt, group, horizon_h) -> dict[str, np.ndarray]:
    """항차마다 권고 범위가 달라 묶음별로 연료·CO2 절감을 계산한다."""
    delay_h = np.asarray(delay_h, dtype=float)
    gt, group, horizon_h = np.asarray(gt, dtype=float), np.asarray(group), np.asarray(horizon_h, dtype=float)
    fuel = np.zeros(len(delay_h))
    co2 = np.zeros(len(delay_h))
    for h in np.unique(horizon_h):
        sel = horizon_h == h
        r = jit_saving(delay_h[sel], gt[sel], group[sel], float(h))
        fuel[sel], co2[sel] = r["fuel_t"], r["co2_t"]
    return {"fuel_t": fuel, "co2_t": co2}


def policies(F: np.ndarray, levels: dict[float, float], a0_h: np.ndarray, group, gt, horizon_h,
             f_true: np.ndarray | None = None) -> dict[float, dict[str, np.ndarray]]:
    """위험 수준별 권고. F: (n, k) 선석 가용 시각 표본[h], levels: 위험 수준 → 표본 분위수 수준."""
    md = max_delay_h(group, horizon_h)
    v0 = design_speed(group)
    horizon_h = np.asarray(horizon_h, dtype=float)
    out = {}
    late_now = np.clip(a0_h - f_true, 0, None) if f_true is not None else None
    for a, lv in levels.items():
        target = np.quantile(F, lv, axis=1)
        delay = np.minimum(np.clip(target - a0_h, 0, None), md)
        rta = a0_h + delay
        sav = saving_by_horizon(delay, gt, group, horizon_h)
        row = {"target_h": target, "delay_h": delay, "rta_h": rta,
               "speed_kn": v0 * horizon_h / (horizon_h + delay),
               "fuel_t": sav["fuel_t"], "co2_t": sav["co2_t"]}
        if f_true is not None:
            late = np.clip(rta - f_true, 0, None)
            row["residual_wait_h"] = np.clip(f_true - rta, 0, None)
            row["extra_idle_h"] = late - late_now
        out[a] = row
    return out


def fuel_per_day(gt, group) -> np.ndarray:
    return daily_fuel(np.asarray(gt, dtype=float), np.asarray(group))
