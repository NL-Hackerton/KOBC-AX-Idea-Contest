"""울산 위치로 대기 하한 추정 검증 (실측 A의 "같은 선석 앞 배 출항 = 선석이 빈 시각" 가정).

정박지에 입항해 선석에서 출항한 울산 항차에 대해, 항내 선박위치(5분 수집)에서 정박지 정지 위치를 떠나
1.5km 넘게 떨어진 곳에 다시 멈춘 첫 시각을 실제 접안 시각으로 본다. 추정 대기는 하한이므로
실제 접안 시각은 앞 배 출항 시각(pred_out)보다 늦거나 같아야 한다.

    uv run python -m kjit.engine.ulsan_validation     # → data/processed/web/ulsan_validation.json

위치 수집은 2026-10-08 14시에 시작했다. 그 뒤 정박지에서 선석으로 옮기고 출항 신고까지 들어온 항차만 대조된다.
"""

from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd

from kjit.service import db
from kjit.service.config import PROC_DIR

KST = "Asia/Seoul"
MOVE_M = 1500  # 정박지 정지 위치에서 이 거리 넘게 떨어진 곳에 멈추면 이동으로 본다
STOP_KN = 0.5


def _dist(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def positions() -> pd.DataFrame:
    with db.session() as con:
        p = pd.read_sql_query("SELECT callsgn, updt, fetched, lat, lon, sog, stts FROM positions", con)
    p["t"] = pd.to_datetime(p["updt"], format="%Y%m%d%H%M%S").dt.tz_localize(KST)
    p["f"] = pd.to_datetime(p["fetched"], format="%Y%m%d%H%M%S").dt.tz_localize(KST)
    # 수집 시각보다 1시간 넘게 오래된 보고는 정지 판정에 쓰지 않는다 (AIS 갱신이 멈춘 배)
    p = p[(p["f"] - p["t"]) <= pd.Timedelta(hours=1)]
    return p.sort_values(["callsgn", "t"]).reset_index(drop=True)


def berthing_time(track: pd.DataFrame, since: pd.Timestamp) -> tuple[pd.Timestamp | None, str]:
    """정박지 정지 → 이동 → 다른 곳 정지의 첫 정지 시각. 관측이 모자라면 이유를 돌려준다."""
    tr = track[track["t"] >= since]
    stop = tr[tr["sog"].fillna(99) < STOP_KN]
    if stop.empty:
        return None, "정지 관측 없음"
    first = stop.iloc[0]
    # AIS 항해 상태(자기 신고)가 있으면 방향을 거른다: 처음부터 계류 중이면 이미 접안한 배,
    # 새로 멈춘 곳이 앵커링이면 정박지로 나간 것이다. 상태가 비어 있으면 위치만 본다.
    if "계류" in (first["stts"] or ""):
        return None, "관측 시작 때 이미 계류"
    a_lat, a_lon = first["lat"], first["lon"]
    for r in stop.itertuples():
        if _dist(a_lat, a_lon, r.lat, r.lon) > MOVE_M:
            if "앵커" in (r.stts or ""):
                a_lat, a_lon = r.lat, r.lon  # 다른 정박지로 옮겼을 뿐이다
                continue
            return r.t, "이동 관측"
    return None, "아직 정박지(또는 이동 전)"


def main() -> None:
    from kjit.service.state import Context

    ctx = Context()
    pos = positions()
    start = pos["f"].min()
    w = ctx.waits
    u = w[(w["prtAgNm"] == "울산") & (w["route"] == "정박지→선석") & w["pred_out"].notna()]
    now = pd.Timestamp.now(tz=KST)
    # 실제 접안이 위치 수집 기간 안에 일어났을 수 있는 항차: 입항이 수집 시작 전후이고 출항 신고가 있는 것
    cand = u[(u["out_time"] >= start) & (u["in_time"] <= now)]
    names = ctx.berth_names
    rows, status = [], {}
    for r in cand.itertuples():
        tr = pos[pos["callsgn"] == r.clsgn]
        if tr.empty:
            status["위치 없음"] = status.get("위치 없음", 0) + 1
            continue
        t, why = berthing_time(tr, max(r.in_time, start))
        if t is not None and t >= r.out_time:  # 출항 뒤의 정지는 접안이 아니다 (이미 접안한 채 관측이 시작된 경우)
            t, why = None, "관측 시작 전 접안"
        status[why] = status.get(why, 0) + 1
        if t is None:
            continue
        free = max(r.in_time, r.pred_out)
        rows.append({
            "vessel": r.vsslNm, "callsign": r.clsgn, "berth": names.get(r.out_berth, r.out_berth),
            "arrived": r.in_time.isoformat(timespec="minutes"), "predecessorOut": r.pred_out.isoformat(timespec="minutes"),
            "berthedByPosition": t.isoformat(timespec="minutes"),
            "estWaitH": round(float(r.berth_wait_h), 1), "actualWaitH": round((t - r.in_time).total_seconds() / 3600, 1),
            "gapH": round((t - free).total_seconds() / 3600, 1),
        })
    gaps = np.array([x["gapH"] for x in rows])
    out = {
        "positionsFrom": start.isoformat(timespec="minutes"), "at": now.isoformat(timespec="minutes"),
        "candidates": int(len(cand)), "status": status, "matched": len(rows),
        "lowerBoundHolds": int((gaps >= -0.5).sum()) if len(rows) else 0,
        "gapMedianH": round(float(np.median(gaps)), 1) if len(rows) else None,
        "rows": rows,
        "method": "실제 접안 = 정박지 정지 위치에서 1.5km 넘게 떨어진 곳의 첫 정지(AIS 상태가 계류로 시작하거나 앵커링으로 끝나면 제외). 하한 성립 = 실제 접안 ≥ 앞 배 출항 − 0.5h(위치 수집 5분 간격·AIS 지연 허용).",
    }
    (PROC_DIR / "web" / "ulsan_validation.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print({k: v for k, v in out.items() if k != "rows"})
    for x in rows:
        print(" ", x)


if __name__ == "__main__":
    main()
