"""엔진 검증: 재생 사례가 백테스트와 맞고, 실시간 결정이 같은 입력에서 재생과 비슷한 분포를 낸다.

데이터(data/processed)가 있는 컴퓨터에서만 돈다.
"""

from __future__ import annotations

import json

import joblib
import numpy as np
import pandas as pd
import pytest

from kjit.service.config import MODEL_DIR, PROC_DIR

CASES = PROC_DIR / "replay" / "cases.json"
pytestmark = pytest.mark.skipif(not CASES.exists(), reason="재생 사례가 없음 (kjit.engine.replay 먼저 실행)")


@pytest.fixture(scope="module")
def replay():
    return json.loads(CASES.read_text())


def test_counts(replay):
    cs = replay["cases"]
    assert len(cs) == 1253
    assert sum(c["busyAtTau"] for c in cs) == 897


def test_quantiles_monotone(replay):
    for c in replay["cases"]:
        for cond in ("public", "lineup", "plan"):
            q = c["conditions"][cond]["quantilesH"]
            assert all(b >= a for a, b in zip(q, q[1:])), c["id"]


def test_policy_totals_match_backtest(replay):
    ref = pd.read_csv(PROC_DIR / "queue_backtest.csv")
    names = {"public": "공개 데이터만", "lineup": "대기 순번 공유", "plan": "선석계획 공유"}
    for cond, label in names.items():
        for a in ("0.1", "0.2", "0.3", "0.5"):
            fuel = sum(c["conditions"][cond]["policies"][a]["fuelT"] for c in replay["cases"])
            row = ref[(ref["정보"] == label) & (ref["정책"] == f"위험 수준 {a}")].iloc[0]
            # 사례 값은 소수 첫째 자리로 반올림되어 있어 합계 오차가 항차 수 × 0.05 까지 날 수 있다
            assert abs(fuel - row["절감 연료 t"]) < 0.05 * len(replay["cases"]) * 0.2 + 1


def test_live_decide_matches_replay(replay):
    """재생 사례의 대기열을 실시간 결정 입력으로 넣으면 비슷한 분포가 나와야 한다."""
    from kjit.berth_dataset import build
    from kjit.engine.core import Recalibration
    from kjit.engine.decide import DecisionRequest, Ship, decide

    occ, _, queue = build()
    bundle = joblib.load(MODEL_DIR / "rtd_quantile.joblib")
    recal = Recalibration.load(MODEL_DIR / "recalibration.json")
    by_call = {(r.clsgn, r.out_time.isoformat(timespec="minutes")): r for r in occ.itertuples()}

    checked = 0
    for c in replay["cases"]:
        if not c["busyAtTau"] or checked >= 12:
            continue
        cond = "public"
        q = c["conditions"][cond]
        if not q["queue"]:
            continue
        occupants, berth_key = [], None
        for m in q["queue"]:
            o = by_call.get((m["callsign"], m["actualDepart"]))
            assert o is not None
            berth_key = o.out_berth
            occupants.append(Ship(vessel=o.vsslNm, callsign=o.clsgn, group=o.group, kind=o.vsslKndNm,
                                  gt=o.in_intrlGrtg if pd.notna(o.in_intrlGrtg) else o.in_grtg,
                                  cargo_ton=o.in_ldadngTon, domestic=o.in_ibobprtNm == "내항",
                                  purpose=o.etryptPurpsNm, nation=o.vsslNltyCd, tug=o.in_tugYn,
                                  pilot=o.in_piltgYn, start=o.start))
        req = DecisionRequest(port=c["port"], berth_key=berth_key, berth_name=c["berth"],
                              target=Ship(group=c["group"], gt=c["gt"], eta=pd.Timestamp(c["a0"])),
                              condition=cond, occupants=occupants, tau=pd.Timestamp(c["tau"]))
        out = decide(req, occ, queue, bundle, recal)
        # 모델 분위수는 같은 입력이면 같아야 한다
        np.testing.assert_allclose(out["queue"][0]["predQ"], q["queue"][0]["predQ"], atol=0.2)
        # 선석 가용 분포는 난수만 다르다. 결정에 쓰는 낮은 분위수(명목 0.1, 0.2)로 비교한다.
        # (공개 데이터만 조건은 재보정 후 높은 명목 수준이 표본 최댓값 근처라 난수에 민감하다)
        # 몬테카를로 잡음(표본 400개)은 분포 폭에 비례하므로 허용 오차도 폭에 비례하게 둔다.
        spread = q["quantilesH"][-1] - q["quantilesH"][0]
        for k in (1, 3):
            lv, rp = out["quantilesH"][k], q["quantilesH"][k]
            assert abs(lv - rp) <= max(3.0, 0.12 * spread), (c["id"], k, lv, rp, spread)
        checked += 1
    assert checked >= 5
