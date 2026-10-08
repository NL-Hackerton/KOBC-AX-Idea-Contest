"""K-JIT API 서버.

    uv run python -m kjit.service.app            # :8000, 수집은 KJIT_INGEST=1 일 때만
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from kjit.engine.decide import DecisionRequest, Ship, decide
from kjit.service import config, db
from kjit.service.ingest import PORTS

KST = dt.timezone(dt.timedelta(hours=9))
log = logging.getLogger("kjit")
STATE: dict = {}


def ctx():
    c = STATE.get("ctx")
    if c is None:
        raise HTTPException(503, "서버가 아직 준비 중입니다. 잠시 뒤 다시 시도해 주세요.")
    return c


def _load() -> None:
    from kjit.service.state import Context

    STATE["ctx"] = Context()
    rp = config.PROC_DIR / "replay" / "cases.json"
    if rp.exists():
        data = json.loads(rp.read_text())
        STATE["replay"] = data
        STATE["replay_index"] = {c["id"]: c for c in data["cases"]}
    sim = config.PROC_DIR / "sim" / "cases.parquet"
    if sim.exists():
        from kjit.engine.simulate import load

        STATE["sim"] = load()
    gp = config.PROC_DIR / "web" / "simulate_grid.json"
    if gp.exists():
        STATE["sim_grid"] = json.loads(gp.read_text())
    if config.INGEST_ENABLED:
        from kjit.service.scheduler import start

        STATE["scheduler"] = start(STATE["ctx"])
    log.info("context ready")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logging.basicConfig(level=logging.INFO)
    threading.Thread(target=_load, daemon=True).start()
    yield
    if s := STATE.get("scheduler"):
        s.shutdown(wait=False)


app = FastAPI(title="K-JIT API", version="1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type"])

# 쓰기 성격 경로의 IP당 속도 제한 (분당 N회)
_hits: dict[str, deque] = defaultdict(deque)
LIMITS = {"/api/decision": 30, "/api/simulate": 10, "/api/agent": 10}


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    if request.method == "POST":
        key = next((k for k in LIMITS if request.url.path.startswith(k)), None)
        if key:
            ip = request.client.host if request.client else "?"
            q = _hits[f"{ip}|{key}"]
            now = time.time()
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= LIMITS[key]:
                return JSONResponse({"detail": "요청이 너무 많습니다. 1분 뒤 다시 시도해 주세요."}, status_code=429)
            q.append(now)
    return await call_next(request)


@app.get("/api/health")
def health() -> dict:
    out = {"status": "ok" if "ctx" in STATE else "starting",
           "now": dt.datetime.now(KST).isoformat(timespec="seconds"),
           "ingestEnabled": config.INGEST_ENABLED, "agentEnabled": bool(config.ANTHROPIC_API_KEY)}
    with db.session() as con:
        rows = con.execute("SELECT job, MAX(at) FROM ingest_log WHERE ok=1 GROUP BY job").fetchall()
    out["lastIngest"] = {j: a for j, a in rows}
    if c := STATE.get("ctx"):
        out["contextLoadedAt"] = c.loaded_at.isoformat(timespec="minutes")
    return out


@app.get("/api/ports")
def ports() -> dict:
    c = ctx()
    return {"ports": [{"code": k, "name": v, "berths": c.berths(v)} for k, v in PORTS.items()]}


@app.get("/api/ports/{port}/state")
def port_state(port: str, at: str | None = None) -> dict:
    from kjit.service.state import port_state as build_state

    if port not in PORTS.values():
        raise HTTPException(404, f"지원하지 않는 항만입니다: {port}")
    t = pd.Timestamp(at) if at else None
    if t is not None and t.tzinfo is None:
        t = t.tz_localize("Asia/Seoul")
    return build_state(ctx(), port, t)


class ShipIn(BaseModel):
    vessel: str = ""
    callsign: str = ""
    group: str = "탱커·가스"
    kind: str | None = None
    gt: float | None = None
    domestic: bool = False
    arrivedAt: str | None = None
    eta: str | None = None


class DecisionIn(BaseModel):
    port: str
    berth: str = Field(description="목적 선석 이름 (단일 접안 선석)")
    vessel: ShipIn
    eta: str
    condition: str = "public"
    lineup: list[ShipIn] = []
    plan: list[ShipIn] = []
    at: str | None = None
    useState: bool = True


def _ts(s: str | None) -> pd.Timestamp | None:
    if not s:
        return None
    t = pd.Timestamp(s)
    return t.tz_localize("Asia/Seoul") if t.tzinfo is None else t.tz_convert("Asia/Seoul")


@app.post("/api/decision")
def decision(body: DecisionIn) -> dict:
    from kjit.service.state import port_state as build_state

    c = ctx()
    if body.condition not in ("public", "lineup", "plan"):
        raise HTTPException(400, "condition 은 public, lineup, plan 가운데 하나입니다")
    key = c.berth_key(body.port, body.berth)
    if key is None:
        raise HTTPException(422, f"{body.berth} 은(는) 예측 대상 선석이 아닙니다. 단일 접안이 확인된 선석만 예측합니다.")
    at = _ts(body.at) or pd.Timestamp.now(tz="Asia/Seoul").floor("min")
    eta = _ts(body.eta)
    if eta is None or eta <= at:
        raise HTTPException(422, "도착 예정은 결정 시각보다 뒤여야 합니다")

    occupants, lineup, plan = [], [], []
    if body.useState:
        st = build_state(c, body.port, at)
        for b in st["berths"]:
            if b["berthKey"] == key:
                occupants.append(Ship(vessel=b["vessel"], callsign=b["callsign"], group=b["group"], gt=b["gt"],
                                      start=_ts(b["since"]), source=b["source"]))
        for w in st["anchorage"]:
            if w.get("targetKey") == key:
                lineup.append(Ship(vessel=w["vessel"], callsign=w["callsign"], group=w["group"], gt=w.get("gt"),
                                   arrived=_ts(w["since"]), source=w["source"]))
        for i in st["inbound"]:
            ieta = _ts(i["eta"])
            if i.get("targetKey") == key and ieta is not None and ieta < eta and i["callsign"] != body.vessel.callsign:
                plan.append(Ship(vessel=i["vessel"], callsign=i["callsign"], group=i["group"], gt=i.get("gt"),
                                 eta=ieta, domestic=i.get("domestic", False), source=i["source"]))
    for s in body.lineup:
        lineup.append(Ship(vessel=s.vessel, callsign=s.callsign, group=s.group, gt=s.gt, kind=s.kind,
                           arrived=_ts(s.arrivedAt), source="user"))
    for s in body.plan:
        plan.append(Ship(vessel=s.vessel, callsign=s.callsign, group=s.group, gt=s.gt, kind=s.kind,
                         eta=_ts(s.eta), source="user"))

    t = body.vessel
    req = DecisionRequest(port=body.port, berth_key=key, berth_name=body.berth,
                          target=Ship(vessel=t.vessel, callsign=t.callsign, group=t.group, kind=t.kind, gt=t.gt,
                                      domestic=t.domestic, eta=eta),
                          condition=body.condition, occupants=occupants, lineup=lineup, plan=plan, tau=at)
    with c.lock:
        occ, queue = c.occ, c.queue
    out = decide(req, occ, queue, c.bundle, c.recal)
    with db.session() as con:
        con.execute("INSERT INTO decisions VALUES (?,?,?)",
                    (at.isoformat(), body.model_dump_json(), json.dumps(out, ensure_ascii=False)))
    return out


@app.get("/api/replay/cases")
def replay_cases(port: str | None = None, busy: bool | None = None) -> dict:
    data = STATE.get("replay")
    if not data:
        raise HTTPException(503, "재생 사례가 없습니다")
    cs = [c for c in data["cases"] if (port is None or c["port"] == port) and (busy is None or c["busyAtTau"] == busy)]
    return {
        "period": data["period"], "featured": data["featured"], "conditions": data["conditions"],
        "riskLevels": data["riskLevels"], "nominal": data["nominal"],
        "cases": [{k: c[k] for k in ("id", "port", "vessel", "callsign", "group", "kind", "berth", "a0", "busyAtTau",
                                     "actualWaitH")} for c in cs],
    }


@app.get("/api/replay/cases/{case_id}")
def replay_case(case_id: str) -> dict:
    c = STATE.get("replay_index", {}).get(case_id)
    if c is None:
        raise HTTPException(404, f"재생 사례가 없습니다: {case_id}")
    return c


@app.get("/api/evidence")
def evidence() -> dict:
    from kjit.engine.evidence import validation_section

    p = config.PROC_DIR / "web" / "evidence.json"
    if not p.exists():
        raise HTTPException(503, "근거 묶음이 없습니다")
    out = json.loads(p.read_text())
    out["validation"] = validation_section()  # 수집 현황은 매번 새로 센다
    return out


class SimulateIn(BaseModel):
    port: str = "전체"
    start: str = "2026-08"
    end: str = "2026-09"
    condition: str = "plan"
    risk: float = 0.1
    participation: float = Field(1.0, ge=0, le=1)
    seed: int = 0


@app.get("/api/simulate/grid")
def simulate_grid() -> dict:
    if "sim_grid" not in STATE:
        raise HTTPException(503, "시뮬레이터 격자가 없습니다")
    return STATE["sim_grid"]


@app.post("/api/simulate")
def simulate_run(body: SimulateIn) -> dict:
    from kjit.engine.simulate import run

    if "sim" not in STATE:
        raise HTTPException(503, "시뮬레이터 데이터가 없습니다")
    if body.condition not in ("public", "lineup", "plan") or body.risk not in (0.1, 0.2, 0.3, 0.5):
        raise HTTPException(400, "조건 또는 위험 수준이 올바르지 않습니다")
    if not ("2025-10" <= body.start <= body.end <= "2026-09"):
        raise HTTPException(400, "기간은 2025-10 ~ 2026-09 안이어야 합니다")
    df, occ = STATE["sim"]
    return run(df, occ, body.port, (body.start, body.end), body.condition, body.risk, body.participation, body.seed)


def main() -> None:
    import uvicorn

    uvicorn.run("kjit.service.app:app", host="0.0.0.0", port=int(config.env("PORT", "8000") or 8000))


if __name__ == "__main__":
    main()
