"""검수: 화면에 실리는 수치가 원천(백테스트 산출물)과 실측 문서와 같은지 대조한다.

    uv run python -m kjit.qa

대상은 웹이 실제로 읽는 묶음(web/src/data/snapshot.json)이다. 실패하면 AssertionError 로 멈춘다.
"""

from __future__ import annotations

import json
import re

import numpy as np
import pandas as pd

from kjit.engine.core import NOMINAL, hours
from kjit.service.config import PROC_DIR, ROOT

DOCS = ROOT / "docs"
SNAP = ROOT / "web" / "src" / "data" / "snapshot.json"
COND_KO = {"public": "공개 데이터만", "lineup": "대기 순번 공유", "plan": "선석계획 공유"}


def _doc_rows(path, header_start: str) -> list[list[str]]:
    """문서에서 header_start 로 시작하는 표의 본문 행."""
    lines = path.read_text().splitlines()
    i = next(k for k, l in enumerate(lines) if l.startswith(header_start))
    rows = []
    for l in lines[i + 2:]:
        if not l.startswith("|"):
            break
        rows.append([c.strip().strip("*") for c in l.strip("|").split("|")])
    return rows


def _num(s: str) -> float | None:
    m = re.search(r"-?[\d,]+(?:\.\d+)?", s)
    return float(m.group().replace(",", "")) if m and s != "-" else None


def featured_cases(snap: dict) -> int:
    """대표 사례의 결정 시각·도착·실제 대기·분위수 = queue_backtest_cases.parquet."""
    ref = pd.read_parquet(PROC_DIR / "queue_backtest_cases.parquet")
    ref["key"] = ref["clsgn"] + "|" + ref["in_time"].dt.strftime("%Y-%m-%dT%H:%M")
    by = ref.set_index("key")
    cases = {c["id"]: c for c in snap["replay"]["cases"]}
    idx = {lv: NOMINAL.index(lv) for lv in (0.1, 0.2, 0.5, 0.9)}
    n = 0
    for fid in snap["replay"]["featured"]:
        c = cases[fid]
        r = by.loc[f"{c['callsign']}|{c['a0'][:16]}"]
        assert c["tau"][:16] == r["tau"].strftime("%Y-%m-%dT%H:%M"), fid
        assert abs(c["actualWaitH"] - r["berth_wait_h"]) < 0.06, (fid, c["actualWaitH"], r["berth_wait_h"])
        assert c["actualFree"][:16] == r["pred_out"].strftime("%Y-%m-%dT%H:%M"), fid
        tau_h = float(hours(pd.Series([r["tau"]]))[0])
        for cond in COND_KO:
            q = c["conditions"][cond]["quantilesH"]
            assert len(c["conditions"][cond]["queue"]) == int(r[f"{cond}_chain_len"]), (fid, cond)
            for lv, k in idx.items():
                want = r[f"{cond}_F_q{int(lv * 100)}"] - tau_h
                assert abs(q[k] - want) < 0.06, (fid, cond, lv, q[k], want)
            n += 1
    return n


def simulator_grid(snap: dict) -> int:
    """격자의 시험 구간·전체·참여율 100% = queue_backtest.csv."""
    ref = pd.read_csv(PROC_DIR / "queue_backtest.csv")
    rows = [r for r in snap["simulate_grid"]["rows"]
            if r["periodKey"] == "test" and r["port"] == "전체" and r["participation"] == 1.0]
    for r in rows:
        x = ref[(ref["정보"] == COND_KO[r["condition"]]) & (ref["정책"] == f"위험 수준 {r['risk']}")].iloc[0]
        assert abs(r["fuelT"] - x["절감 연료 t"]) < 0.2, (r["condition"], r["risk"], r["fuelT"], x["절감 연료 t"])
        assert abs(r["extraIdleH"] - x["추가 선석 유휴 h"]) <= 1, (r["condition"], r["risk"])
        assert abs(r["delayH"] - x["지연 합계 h"]) <= 1, (r["condition"], r["risk"], r["delayH"], x["지연 합계 h"])
    return len(rows)


def backtest_doc() -> int:
    """실측 BC 문서의 백테스트 표 = queue_backtest.csv (반올림)."""
    ref = pd.read_csv(PROC_DIR / "queue_backtest.csv")
    rows = _doc_rows(DOCS / "실측-BC-선석예측-JIT백테스트-2026-10-08.md", "| 정보 조건 | 정책 | 감속 지연 합계")
    upper = float(ref.loc[ref["정책"].str.startswith("완전 정보"), "절감 연료 t"].iloc[0])
    for cond, pol, delay, idle, late, fuel, co2, share in rows:
        x = ref[ref["정책"].str.startswith(pol) & ((ref["정보"] == cond) | (cond == "-"))].iloc[0]
        assert round(100 * x["절감 연료 t"] / upper) == _num(share), (cond, pol, share)
        assert round(x["지연 합계 h"]) == _num(delay) and round(x["추가 선석 유휴 h"]) == _num(idle), (cond, pol)
        assert int(x["추가 유휴 2h 초과 항차"]) == _num(late), (cond, pol)
        assert round(x["절감 연료 t"]) == _num(fuel) and round(x["절감 CO2 t"]) == _num(co2), (cond, pol)
    return len(rows)


def evidence(snap: dict) -> int:
    """근거 화면의 대기 표·적중률 = 실측 A·BC 문서."""
    ev = snap["evidence"]
    summ = {r["항만"]: r for r in ev["wait"]["summary"]}
    rows = _doc_rows(DOCS / "실측-A-정박지대기-2026-10-08.md", "| 항만 | 화물선 항차 |")
    for port, calls, via, anch, n, med, p75, p90, over12 in rows:
        s = summ[port]
        assert s["화물선 항차"] == _num(calls) and s["대기 추정 항차"] == _num(n), port
        assert abs(s["정박지→선석 %"] - _num(via)) < 0.06 and abs(s["정박지 체류만 %"] - _num(anch)) < 0.06, port
        for col, v in (("대기 중앙값 h", med), ("대기 p75 h", p75), ("대기 p90 h", p90), ("12h 이상 %", over12)):
            want = _num(v)
            got = s[col]
            if want is None:
                assert got is None, (port, col, got)
            else:
                assert got is not None and abs(got - want) < 0.06, (port, col, got, want)
    cov = ev["backtest"]["coverage80"]
    for cond, mae, rng in _doc_rows(DOCS / "실측-BC-선석예측-JIT백테스트-2026-10-08.md", "| 정보 조건 | 선석 가용 시각 MAE"):
        k = next(k for k, v in COND_KO.items() if v == cond)
        a, b = (float(x) for x in rng.split("→"))
        assert cov[k]["mae_busy_h"] == _num(mae) and cov[k]["원래"] == a and cov[k]["재보정"] == b, cond
    return len(rows) + 3


def main() -> None:
    snap = json.loads(SNAP.read_text())
    print(f"대표 사례 × 조건 {featured_cases(snap)}건 = queue_backtest_cases.parquet")
    print(f"시뮬레이터 격자 {simulator_grid(snap)}행 = queue_backtest.csv")
    print(f"실측 BC 백테스트 표 {backtest_doc()}행 = queue_backtest.csv")
    print(f"근거 화면 {evidence(snap)}행 = 실측 A·BC 문서")
    print(f"저장본 {SNAP.stat().st_size / 1e6:.1f}MB")


if __name__ == "__main__":
    main()
