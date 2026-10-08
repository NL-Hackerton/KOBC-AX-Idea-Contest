"""CII(운항 탄소집약도) 계산 상수와 계산.

상수는 IMO 결의 원문에서 옮겼다 (2026-10-08 원문 PDF 확인).
- 기준선 a, c: MEPC.353(78) 2022 CII 기준선 지침(G2) Table 1
- 등급 경계 exp(d1..d4): MEPC.354(78) 2022 CII 등급 지침(G4) Table 1
- 감축률 Z: MEPC.400(83) 부속서 Table 1 (2023~2030)
- 연료별 CO2 환산 계수 Cf: IMO EEDI 계산 지침의 Cf 값 (HFO 3.114, LFO 3.151, MDO/MGO 3.206, LNG 2.750)

    uv run python -m kjit.engine.cii      # data/processed/web/cii_constants.json
"""

from __future__ import annotations

import json
import math

from kjit.service.config import PROC_DIR

Z = {2023: 5.0, 2024: 7.0, 2025: 9.0, 2026: 11.0, 2027: 13.625, 2028: 16.25, 2029: 18.875, 2030: 21.5}

CF = {"HFO": 3.114, "VLSFO/LFO": 3.151, "MDO/MGO": 3.206, "LNG": 2.750}

# 선종: [(용량 하한, 용량 상한, 용량 단위, 고정 용량(없으면 None), a, c, dd)]
SHIP_TYPES = {
    "벌크선": [
        (279000, math.inf, "DWT", 279000, 4745, 0.622, (0.86, 0.94, 1.06, 1.18)),
        (0, 279000, "DWT", None, 4745, 0.622, (0.86, 0.94, 1.06, 1.18)),
    ],
    "가스운반선": [
        (65000, math.inf, "DWT", None, 14405e7, 2.071, (0.81, 0.91, 1.12, 1.44)),
        (0, 65000, "DWT", None, 8104, 0.639, (0.85, 0.95, 1.06, 1.25)),
    ],
    "탱커": [(0, math.inf, "DWT", None, 5247, 0.610, (0.82, 0.93, 1.08, 1.28))],
    "컨테이너선": [(0, math.inf, "DWT", None, 1984, 0.489, (0.83, 0.94, 1.07, 1.19))],
    "일반화물선": [
        (20000, math.inf, "DWT", None, 31948, 0.792, (0.83, 0.94, 1.06, 1.19)),
        (0, 20000, "DWT", None, 588, 0.3885, (0.83, 0.94, 1.06, 1.19)),
    ],
    "LNG 운반선": [
        (100000, math.inf, "DWT", None, 9.827, 0.000, (0.89, 0.98, 1.06, 1.13)),
        (65000, 100000, "DWT", None, 14479e10, 2.673, (0.78, 0.92, 1.10, 1.37)),
        (0, 65000, "DWT", 65000, 14779e10, 2.673, (0.78, 0.92, 1.10, 1.37)),
    ],
    "자동차운반선": [
        (57700, math.inf, "GT", 57700, 3627, 0.590, (0.86, 0.94, 1.06, 1.16)),
        (30000, 57700, "GT", None, 3627, 0.590, (0.86, 0.94, 1.06, 1.16)),
        (0, 30000, "GT", None, 330, 0.329, (0.86, 0.94, 1.06, 1.16)),
    ],
}
GRADES = ("A", "B", "C", "D", "E")


def _row(ship_type: str, capacity: float):
    for lo, hi, unit, fixed, a, c, dd in SHIP_TYPES[ship_type]:
        if lo <= capacity < hi:
            return unit, fixed, a, c, dd
    raise ValueError(capacity)


def reference(ship_type: str, capacity: float) -> float:
    _, fixed, a, c, _ = _row(ship_type, capacity)
    return a * (fixed or capacity) ** (-c)


def boundaries(ship_type: str, capacity: float, year: int) -> tuple[float, list[float]]:
    _, _, _, _, dd = _row(ship_type, capacity)
    req = reference(ship_type, capacity) * (1 - Z[year] / 100)
    return req, [req * d for d in dd]


def rate(attained: float, bounds: list[float]) -> str:
    for g, b in zip(GRADES, bounds):
        if attained < b:
            return g
    return "E"


def attained(fuel_t: float, cf: float, capacity: float, distance_nm: float) -> float:
    """gCO2 / (용량 × 해리)."""
    return fuel_t * cf * 1e6 / (capacity * distance_nm)


def constants() -> dict:
    types = {
        k: [{"min": lo, "max": None if math.isinf(hi) else hi, "unit": unit, "fixedCapacity": fixed, "a": a, "c": c,
             "dd": list(dd)} for lo, hi, unit, fixed, a, c, dd in v]
        for k, v in SHIP_TYPES.items()
    }
    return {
        "z": {str(k): v for k, v in Z.items()}, "cf": CF, "types": types,
        "sources": {
            "reference": "IMO MEPC.353(78) 2022 CII 기준선 지침(G2) Table 1",
            "rating": "IMO MEPC.354(78) 2022 CII 등급 지침(G4) Table 1",
            "z": "IMO MEPC.400(83) 부속서 Table 1 (2025-04-11 채택)",
            "cf": "IMO EEDI 계산 지침의 연료별 Cf",
        },
    }


def main() -> None:
    out = PROC_DIR / "web" / "cii_constants.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(constants(), ensure_ascii=False, indent=1))
    print(f"→ {out}")


if __name__ == "__main__":
    main()
