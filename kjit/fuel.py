"""정박지 대기를 JIT 감속으로 바꿨을 때의 연료·CO2 절감량 (가정 기반 추정).

모든 계수는 공개 통계를 대체하는 가정값이며, 실제 선박 데이터(noon report)로 바꿔 끼운다.

- 주기관 일일 연료(설계 속도): f0 = 0.113 * GT^0.533 [t/day]
  (총톤수 1천 → 약 4.5, 5천 → 10.6, 3만 → 27.5, 15만 → 65 t/day 를 잇는 거듭제곱 근사)
- 주기관 연료는 속도의 세제곱에 비례하고, 저부하 연료소모율 증가를 반영해 절감분에 0.85 를 곱한다.
- 감속 가능 구간: 도착 H 시간 전에 도착 권고를 받는다고 보고, 최저 속도는 설계 속도의 65% (최소 8노트).
- 발전기·보일러 연료는 정박 중과 항해 중이 비슷하다고 보고 절감에서 뺀다 (보수적).
- CO2 환산 계수 3.151 (IMO LFO/VLSFO 기준).
"""

from __future__ import annotations

import numpy as np

CO2_PER_T_FUEL = 3.151
LOW_LOAD_PENALTY = 0.85
MIN_SPEED_RATIO = 0.65
MIN_SPEED_KN = 8.0

DESIGN_SPEED_KN = {
    "탱커·가스": 12.5,
    "벌크": 12.5,
    "컨테이너": 16.0,
    "자동차운반": 17.0,
    "일반화물": 12.0,
    "기타": 12.0,
}


def daily_fuel(gt: np.ndarray | float, group: np.ndarray | str) -> np.ndarray:
    """설계 속도에서의 주기관 일일 연료 [t/day]. 고속 선종은 속도 세제곱으로 보정한다."""
    gt = np.asarray(gt, dtype=float)
    v0 = np.vectorize(lambda g: DESIGN_SPEED_KN.get(g, 12.0))(group)
    return 0.113 * np.power(np.clip(gt, 100, None), 0.533) * np.power(v0 / 12.5, 3)


def jit_saving(wait_h, gt, group, horizon_h: float = 24.0) -> dict[str, np.ndarray]:
    """대기 wait_h 시간을 도착 지연으로 바꿨을 때의 항차별 절감 연료·CO2.

    horizon_h: 도착 몇 시간 전에 권고 도착 시각(RTA)을 받는지.
    반환: shift_h(실제로 늦춘 시간), fuel_t, co2_t, residual_wait_h
    """
    wait_h = np.asarray(wait_h, dtype=float)
    v0 = np.vectorize(lambda g: DESIGN_SPEED_KN.get(g, 12.0))(group)
    vmin = np.maximum(v0 * MIN_SPEED_RATIO, MIN_SPEED_KN)
    vmin = np.minimum(vmin, v0)
    dist = v0 * horizon_h
    max_shift = dist / vmin - horizon_h
    shift = np.clip(wait_h, 0, max_shift)
    v_new = dist / (horizon_h + shift)
    f0 = daily_fuel(gt, group)
    me_before = f0 * horizon_h / 24
    me_after = f0 * (horizon_h + shift) / 24 * np.power(v_new / v0, 3)
    fuel = (me_before - me_after) * LOW_LOAD_PENALTY
    return {
        "shift_h": shift,
        "fuel_t": fuel,
        "co2_t": fuel * CO2_PER_T_FUEL,
        "residual_wait_h": wait_h - shift,
    }
