"""상태 빌더 검증: 과거 시각의 접안 선박이 복원한 점유 구간과 같아야 한다."""

from __future__ import annotations

import pandas as pd
import pytest

from kjit.service.config import DB_PATH

pytestmark = pytest.mark.skipif(not DB_PATH.exists(), reason="운영 DB 없음 (kjit.service.backfill 먼저 실행)")


@pytest.fixture(scope="module")
def ctx():
    from kjit.service.state import Context

    return Context()


@pytest.mark.parametrize("port,at", [("울산", "2026-08-20 12:00"), ("대산", "2026-09-05 06:00"), ("광양", "2026-07-11 18:00")])
def test_history_occupants_match_occupancy(ctx, port, at):
    from kjit.service.state import port_state

    t = pd.Timestamp(at, tz="Asia/Seoul")
    s = port_state(ctx, port, t)
    assert not s["live"]
    occ = ctx.occ[(ctx.occ["prtAgNm"] == port) & (ctx.occ["start"] <= t) & (ctx.occ["out_time"] > t)]
    assert {(b["callsign"], b["berthKey"]) for b in s["berths"]} == set(zip(occ["clsgn"], occ["out_berth"]))
    for b in s["berths"]:
        assert b["elapsedH"] >= 0
        assert b["predQ"] == sorted(b["predQ"])


def test_live_state_has_no_future_truth(ctx):
    from kjit.service.state import port_state

    s = port_state(ctx, "울산")
    assert s["live"]
    assert all(b["actualDepart"] is None for b in s["berths"])
    assert all(i["source"] in ("pre", "final") for i in s["inbound"])
