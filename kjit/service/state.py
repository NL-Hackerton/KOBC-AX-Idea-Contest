"""항만 상태 빌더: 시각 T 의 선석 점유, 정박지 대기, 입항 예정.

- 과거 시각: 1년 이력으로 복원한 점유 구간(berth_dataset.build)을 쓴다. 정박지 대기 선박의 목적 선석은
  사후에 알게 된 값이므로 source="history" 로 표시한다.
- 지금: 아직 출항 신고가 없는 항차를 쓴다. 첫 계선시설이 선석이면 접안 중, 정박지면 대기다.
  공개 신고에는 정박지→선석 이동 기록이 없으므로, 울산은 항내 선박 위치로 이동을 보정한다.
- 입항 예정: 앞으로 5일 안의 입항 신고(최초·변경 신고는 사전 신고)와 신고된 계선시설.
"""

from __future__ import annotations

import math
import threading

import joblib
import numpy as np
import pandas as pd

from kjit import measure_wait as mw
from kjit.berth_dataset import build, features_rows
from kjit.engine.core import Recalibration
from kjit.forecast import predict_quantiles
from kjit.service import db
from kjit.service.config import MODEL_DIR
from kjit.service.ingest import PORTS

KST = "Asia/Seoul"
LIVE_WINDOW = pd.Timedelta(hours=1)
INBOUND_DAYS = 5
BERTH_RADIUS_M = 300.0


def _r1(x) -> float | None:
    return None if x is None or pd.isna(x) else round(float(x), 1)


def _iso(ts) -> str | None:
    return None if ts is None or pd.isna(ts) else pd.Timestamp(ts).tz_convert(KST).isoformat(timespec="minutes")


class Context:
    """이력·모델·재보정을 한 번 읽어 두고 수집 뒤에 다시 만든다."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.bundle = joblib.load(MODEL_DIR / "rtd_quantile.joblib")
        self.recal = Recalibration.load(MODEL_DIR / "recalibration.json")
        self.refresh()

    def refresh(self) -> None:
        with db.session() as con:
            calls = db.load_calls(con, ports=list(PORTS))
        calls = calls[calls["in_time"].notna()].reset_index(drop=True)
        occ, waits, queue = build(calls)
        df = mw.classify(calls)
        occ_tab = mw.multi_occupancy(df)
        single = occ_tab[occ_tab["single"]]
        with self.lock:
            self.calls = df
            self.occ, self.waits, self.queue = occ, waits, queue
            self.single = set(single["berth"])
            self.berth_names = dict(zip(single["berth"], single["name"]))
            self.loaded_at = pd.Timestamp.now(tz=KST)
            self.latest_in = df["in_time"].max()

    def berths(self, port: str) -> list[dict]:
        code = next(k for k, v in PORTS.items() if v == port)
        return sorted(({"key": k, "name": n} for k, n in self.berth_names.items() if k.startswith(code + "|")),
                      key=lambda b: b["name"])

    def berth_key(self, port: str, name: str) -> str | None:
        return next((b["key"] for b in self.berths(port) if b["name"] == name), None)


def _haversine(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _positions(at: pd.Timestamp) -> pd.DataFrame:
    """at 이전 3시간 안의 울산 위치 (선박별 시계열)."""
    lo = (at - pd.Timedelta(hours=72)).strftime("%Y%m%d%H%M%S")
    hi = at.strftime("%Y%m%d%H%M%S")
    with db.session() as con:
        pos = pd.read_sql_query("SELECT * FROM positions WHERE updt > ? AND updt <= ?", con, params=(lo, hi))
    if pos.empty:
        return pos
    pos["t"] = pd.to_datetime(pos["updt"], format="%Y%m%d%H%M%S").dt.tz_localize(KST)
    return pos.sort_values("t")


def port_state(ctx: Context, port: str, at: pd.Timestamp | None = None) -> dict:
    now = pd.Timestamp.now(tz=KST)
    at = (at or now).tz_convert(KST) if (at or now).tzinfo else pd.Timestamp(at).tz_localize(KST)
    live = at >= now - LIVE_WINDOW
    code = next(k for k, v in PORTS.items() if v == port)
    with ctx.lock:
        calls, occ, waits = ctx.calls, ctx.occ, ctx.waits
        single, names = ctx.single, ctx.berth_names
    calls = calls[calls["prtAgCd"] == code]
    occ_p = occ[occ["prtAgNm"] == port]

    # 접안 중 (이력)
    occupants = occ_p[(occ_p["start"] <= at) & (occ_p["out_time"] > at)].copy()
    # 지금 기준으로 출항 시각이 미래인 항차는 '출항 예정 신고'다. 실제 출항이 아니므로 따로 표시한다.
    occupants["source"] = np.where(live & (occupants["out_time"] > now), "declared", "history")
    waiting_rows: list[dict] = []
    # 정박지 대기 (이력): 정박지로 들어와 at 이후 접안한 항차
    w = waits[(waits["prtAgNm"] == port) & (waits["in_time"] <= at)]
    hist_wait = occ_p[(occ_p["route"] == "정박지→선석") & (occ_p["in_time"] <= at) & (occ_p["start"] > at)]
    for r in hist_wait.itertuples():
        waiting_rows.append({"vessel": r.vsslNm, "callsign": r.clsgn, "group": r.group, "since": r.in_time,
                             "targetBerth": names.get(r.out_berth, r.out_laidupFcltyNm), "targetKey": r.out_berth,
                             "source": "declared" if live and r.out_time > now else "history",
                             "gt": r.in_intrlGrtg if pd.notna(r.in_intrlGrtg) else r.in_grtg})
    del w

    # 지금: 출항 신고가 없는 항차
    live_rows = calls[(calls["in_time"] <= at) & (calls["out_time"].isna() | (calls["out_time"] > at))]
    live_rows = live_rows[live_rows["group"] != "작업·지원·여객"]
    known = set(zip(occupants["clsgn"], occupants["in_time"]))
    extra_occ = []
    if live:
        live_rows = live_rows[live_rows["out_time"].isna()]
        in_key = live_rows["in_berth"]
        berthed = live_rows[(live_rows["route"] == "직접 접안") & in_key.isin(single)]
        for r in berthed.itertuples():
            if (r.clsgn, r.in_time) in known:
                continue
            extra_occ.append({"out_berth": r.in_berth, "out_laidupFcltyNm": r.in_laidupFcltyNm, "clsgn": r.clsgn,
                              "vsslNm": r.vsslNm, "group": r.group, "vsslKndNm": r.vsslKndNm,
                              "in_intrlGrtg": r.in_intrlGrtg, "in_grtg": r.in_grtg, "in_ldadngTon": r.in_ldadngTon,
                              "in_ibobprtNm": r.in_ibobprtNm, "etryptPurpsNm": r.etryptPurpsNm,
                              "vsslNltyCd": r.vsslNltyCd, "in_tugYn": r.in_tugYn, "in_piltgYn": r.in_piltgYn,
                              "prtAgNm": port, "in_time": r.in_time, "start": r.in_time, "out_time": pd.NaT,
                              "route": r.route, "source": "live", "etryptYear": r.etryptYear, "etryptCo": r.etryptCo})
        anch = live_rows[live_rows["route"].isin(["정박지 체류만", "정박지→선석"]) & ~live_rows["in_laidupFcltyNm"].fillna("").str.contains("벙커링")]
        for r in anch.itertuples():
            waiting_rows.append({"vessel": r.vsslNm, "callsign": r.clsgn, "group": r.group, "since": r.in_time,
                                 "targetBerth": None, "targetKey": None, "source": "live",
                                 "gt": r.in_intrlGrtg if pd.notna(r.in_intrlGrtg) else r.in_grtg,
                                 "year": r.etryptYear, "vyg": r.etryptCo, "anchorage": r.in_laidupFcltyNm})
    occ_all = pd.concat([occupants, pd.DataFrame(extra_occ)], ignore_index=True) if extra_occ else occupants

    # 울산: 위치로 정박지→선석 이동 보정
    shifted = []
    pos_out = []
    if port == "울산" and live:
        pos = _positions(at)
        if not pos.empty:
            latest = pos.groupby("ident").tail(1)
            cent = {}
            for r in occ_all.itertuples():
                p = latest[(latest["callsgn"] == r.clsgn) & (latest["sog"].fillna(9) < 1)]
                if len(p):
                    cent.setdefault(r.out_berth, []).append((p["lat"].iloc[0], p["lon"].iloc[0]))
            cent = {k: (np.median([c[0] for c in v]), np.median([c[1] for c in v])) for k, v in cent.items()}
            for wr in [x for x in waiting_rows if x["source"] == "live"]:
                p = pos[(pos["callsgn"] == wr["callsign"]) & (pos["t"] >= wr["since"])]
                if p.empty or p["sog"].iloc[-1] is None or p["sog"].iloc[-1] >= 0.5:
                    continue
                lat, lon = p["lat"].iloc[-1], p["lon"].iloc[-1]
                best = min(cent.items(), key=lambda kv: _haversine(lat, lon, *kv[1]), default=None)
                if best and _haversine(lat, lon, *best[1]) <= BERTH_RADIUS_M:
                    near = p[[(_haversine(a, b, *best[1]) <= BERTH_RADIUS_M) for a, b in zip(p["lat"], p["lon"])]]
                    wr.update(shiftedTo=best[0], shiftedAt=near["t"].iloc[0])
                    shifted.append(wr)
            for r in latest.itertuples():
                pos_out.append({"callsign": r.callsgn, "name": r.name, "lat": r.lat, "lon": r.lon, "sog": r.sog,
                                "t": _iso(r.t)})
    for wr in shifted:
        waiting_rows.remove(wr)
        match = calls[(calls["clsgn"] == wr["callsign"]) & (calls["in_time"] == wr["since"])].iloc[0]
        occ_all = pd.concat([occ_all, pd.DataFrame([{
            "out_berth": wr["shiftedTo"], "out_laidupFcltyNm": names.get(wr["shiftedTo"]), "clsgn": wr["callsign"],
            "vsslNm": wr["vessel"], "group": wr["group"], "vsslKndNm": match["vsslKndNm"],
            "in_intrlGrtg": match["in_intrlGrtg"], "in_grtg": match["in_grtg"], "in_ldadngTon": match["in_ldadngTon"],
            "in_ibobprtNm": match["in_ibobprtNm"], "etryptPurpsNm": match["etryptPurpsNm"],
            "vsslNltyCd": match["vsslNltyCd"], "in_tugYn": match["in_tugYn"], "in_piltgYn": match["in_piltgYn"],
            "prtAgNm": port, "in_time": wr["since"], "start": wr["shiftedAt"], "out_time": pd.NaT,
            "route": "정박지→선석", "source": "live+position"}])], ignore_index=True)

    # 접안 중 선박의 남은 체류 예측
    berths_out = []
    if len(occ_all):
        rows = occ_all.assign(t=at)
        feats = features_rows(rows, occ, ctx.queue)
        q = predict_quantiles(ctx.bundle, feats)
        qmat = np.column_stack([q[k] for k in sorted(q)])
        for i, r in enumerate(occ_all.itertuples()):
            berths_out.append({
                "berthKey": r.out_berth, "berth": names.get(r.out_berth, r.out_laidupFcltyNm),
                "vessel": r.vsslNm, "callsign": r.clsgn, "group": r.group,
                "gt": _r1(r.in_intrlGrtg if pd.notna(r.in_intrlGrtg) else r.in_grtg),
                "since": _iso(r.start), "elapsedH": _r1((at - r.start).total_seconds() / 3600),
                "predQ": [_r1(x) for x in qmat[i]], "source": r.source,
                "actualDepart": _iso(r.out_time) if not live else None,
                "declaredDepart": _iso(r.out_time) if r.source == "declared" else None,
            })
    berths_out.sort(key=lambda b: b["berth"] or "")

    # 입항 예정
    inbound = calls[(calls["in_time"] > at) & (calls["in_time"] <= at + pd.Timedelta(days=INBOUND_DAYS))]
    inbound = inbound[inbound["group"] != "작업·지원·여객"].sort_values("in_time")
    inbound_out = [{
        "vessel": r.vsslNm, "callsign": r.clsgn, "group": r.group, "kind": r.vsslKndNm,
        "gt": _r1(r.in_intrlGrtg if pd.notna(r.in_intrlGrtg) else r.in_grtg),
        "eta": _iso(r.in_time), "facility": r.in_laidupFcltyNm,
        "targetKey": r.in_berth if r.in_berth in single else None,
        "domestic": r.in_ibobprtNm == "내항",
        "source": ("pre" if r.in_reqstSeNm in ("최초", "변경") else "final") if live else "history",
        "id": f"{r.prtAgCd}-{r.etryptYear}-{r.etryptCo}-{r.clsgn}",
    } for r in inbound.itertuples()]

    waiting_out = [{**{k: v for k, v in w.items() if k not in ("since", "year", "vyg")},
                    "since": _iso(w["since"]), "gt": _r1(w.get("gt")),
                    "waitedH": _r1((at - w["since"]).total_seconds() / 3600)} for w in waiting_rows]
    waiting_out.sort(key=lambda w: w["since"] or "")
    return {
        "port": port, "at": at.isoformat(timespec="minutes"), "live": bool(live),
        "updatedAt": ctx.loaded_at.isoformat(timespec="minutes"),
        "berths": berths_out, "anchorage": waiting_out, "inbound": inbound_out,
        "shiftedByPosition": len(shifted), "positions": pos_out,
        "singleBerths": ctx.berths(port),
    }
