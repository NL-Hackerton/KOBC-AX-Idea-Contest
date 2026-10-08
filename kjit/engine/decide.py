"""실시간 항차 결정: 지금 시점의 선석 대기열로 선석 가용 분포와 위험 수준별 권고를 낸다.

재생 사례와 같은 모델·역CDF·재보정·정책 함수를 쓴다. 대기열 선박은 상태 빌더(접안 중·정박지 대기)나
사용자 입력(대리점 대기 순번, 선석계획)에서 받는다.
"""

from __future__ import annotations

import zlib
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from kjit.engine.core import (
    NOMINAL, N_SAMPLES, RISK_LEVELS, Recalibration, design_speed, fuel_per_day, from_hours, hours, inv_cdf,
    max_delay_h, policies, roll_chain,
)
from kjit.berth_dataset import features_rows
from kjit.forecast import predict_quantiles

MAX_HORIZON_H = 48.0
MIN_HORIZON_H = 1.0


@dataclass
class Ship:
    """대기열 원소 또는 결정 대상 선박."""

    vessel: str = ""
    callsign: str = ""
    group: str = "탱커·가스"
    kind: str | None = None
    gt: float | None = None
    cargo_ton: float | None = None
    domestic: bool = False
    purpose: str | None = "양적하"
    nation: str | None = None
    tug: str | None = "Y"
    pilot: str | None = "Y"
    start: pd.Timestamp | None = None     # 접안 시작 (접안 중)
    arrived: pd.Timestamp | None = None   # 정박지 도착 (대기)
    eta: pd.Timestamp | None = None       # 도착 예정 (계획·결정 대상)
    source: str = "state"


@dataclass
class DecisionRequest:
    port: str
    berth_key: str           # "항만코드|시설코드|서브코드" (선석 이력 조회용)
    berth_name: str
    target: Ship
    condition: str = "public"
    occupants: list[Ship] = field(default_factory=list)
    lineup: list[Ship] = field(default_factory=list)
    plan: list[Ship] = field(default_factory=list)
    tau: pd.Timestamp | None = None  # 결정 시각 (기본: 지금)


def _row(s: Ship, req: DecisionRequest, tau: pd.Timestamp, start: pd.Timestamp) -> dict:
    return {
        "prtAgNm": req.port, "out_berth": req.berth_key, "group": s.group, "vsslKndNm": s.kind or s.group,
        "in_intrlGrtg": s.gt, "in_grtg": s.gt, "in_ldadngTon": s.cargo_ton,
        "in_ibobprtNm": "내항" if s.domestic else "외항", "etryptPurpsNm": s.purpose,
        "vsslNltyCd": s.nation, "in_tugYn": s.tug, "in_piltgYn": s.pilot, "t": tau, "start": start,
    }


def members(req: DecisionRequest, tau: pd.Timestamp) -> list[tuple[Ship, str]]:
    """정보 조건에 따라 대기열을 만든다. 순서: 접안 중 → 대기(도착순) → 계획(도착 예정순)."""
    out = [(s, "berthed") for s in req.occupants if s.start is not None and s.start <= tau]
    if req.condition in ("lineup", "plan"):
        waiting = [s for s in req.lineup if s.arrived is not None and s.arrived <= tau]
        out += [(s, "waiting") for s in sorted(waiting, key=lambda s: s.arrived)]
    if req.condition == "plan":
        planned = [s for s in req.plan if s.eta is not None]
        out += [(s, "planned") for s in sorted(planned, key=lambda s: s.eta)]
    return out


def decide(req: DecisionRequest, history: pd.DataFrame, queue: dict, bundle: dict, recal: Recalibration,
           seed: int | None = None) -> dict:
    tau = req.tau or pd.Timestamp.now(tz="Asia/Seoul").floor("min")
    a0 = req.target.eta
    if a0 is None:
        raise ValueError("결정 대상 선박의 도착 예정(eta)이 필요합니다")
    horizon = float(np.clip((a0 - tau).total_seconds() / 3600, MIN_HORIZON_H, MAX_HORIZON_H))
    mem = members(req, tau)
    tau_h = float(hours(pd.Series([tau]))[0])
    a0_h = float(hours(pd.Series([a0]))[0])
    if seed is None:
        seed = zlib.crc32(f"{req.berth_key}|{tau.isoformat()}|{req.condition}|{len(mem)}".encode())
    rng = np.random.default_rng(seed)

    qmat = np.zeros((0, 7))
    if mem:
        rows = [_row(s, req, tau, s.start if st == "berthed" else tau) for s, st in mem]
        feats = features_rows(pd.DataFrame(rows), history, queue)
        q = predict_quantiles(bundle, feats)
        qmat = np.column_stack([q[k] for k in sorted(q)])
        dur = inv_cdf(qmat, rng.uniform(size=(len(mem), N_SAMPLES)))
        started = np.array([st == "berthed" for _, st in mem])
        arr = np.array([
            tau_h if st == "berthed" else float(hours(pd.Series([max(s.arrived or s.eta or tau, tau)]))[0])
            for s, st in mem
        ])
        F = roll_chain(tau_h, started, arr, dur)[None, :]
    else:
        F = np.full((1, N_SAMPLES), tau_h)

    busy = bool(F.max() > tau_h + 1e-9)
    levels = {a: recal.level(req.condition, a) for a in RISK_LEVELS}
    t = req.target
    pol = policies(F, levels, np.array([a0_h]), [t.group], [t.gt or 5000], [horizon])
    nom = [recal.level(req.condition, a) for a in NOMINAL]
    qs = np.sort(np.quantile(F[0], nom) - tau_h) if busy else np.zeros(len(NOMINAL))
    r1 = lambda x: round(float(x), 1)  # noqa: E731
    return {
        "basis": "live",
        "tau": tau.isoformat(timespec="minutes"),
        "a0": a0.isoformat(timespec="minutes"),
        "horizonH": r1(horizon),
        "busyAtTau": busy,
        "condition": req.condition,
        "berth": req.berth_name,
        "designSpeedKn": r1(design_speed([t.group])[0]),
        "fuelPerDayT": r1(fuel_per_day([t.gt or 5000], [t.group])[0]),
        "maxDelayH": r1(max_delay_h([t.group], [horizon])[0]),
        "quantilesH": [r1(x) for x in qs],
        "queue": [
            {"vessel": s.vessel, "callsign": s.callsign, "group": s.group, "status": st, "source": s.source,
             "elapsedH": r1((tau - s.start).total_seconds() / 3600) if st == "berthed" else None,
             "arrivedAt": s.arrived.isoformat(timespec="minutes") if st == "waiting" and s.arrived is not None else None,
             "plannedAt": s.eta.isoformat(timespec="minutes") if st == "planned" and s.eta is not None else None,
             "predQ": [r1(x) for x in qmat[j]]}
            for j, (s, st) in enumerate(mem)
        ],
        "policies": {
            str(a): {"rta": from_hours(p["rta_h"][0]).isoformat(timespec="minutes"), "delayH": r1(p["delay_h"][0]),
                     "speedKn": r1(p["speed_kn"][0]), "fuelT": r1(p["fuel_t"][0]), "co2T": r1(p["co2_t"][0])}
            for a, p in pol.items()
        },
    }
