"""K-JIT API 서버.

    uv run python -m kjit.service.app            # :8000, 수집은 KJIT_INGEST=1 일 때만
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import queue
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


_decision_log: queue.Queue = queue.Queue()


def _decision_writer() -> None:
    while True:
        row = _decision_log.get()
        try:
            with db.session() as con:
                con.execute("INSERT INTO decisions VALUES (?,?,?)", row)
        except Exception:  # 기록 실패가 서비스를 멈추지 않는다
            log.exception("decision log write failed")


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
    threading.Thread(target=_decision_writer, daemon=True).start()
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
           "ingestEnabled": config.INGEST_ENABLED, "agentEnabled": config.env("KJIT_AGENT_LIVE", "0") == "1" and bool(config.ANTHROPIC_API_KEY)}
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


def _name(v: str | None) -> str:
    return "".join(ch for ch in (v or "").lower() if ch.isalnum())


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

    t0 = time.time()
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
    def known(s: ShipIn, ships: list[Ship]) -> bool:
        n = _name(s.vessel)
        return any((s.callsign and s.callsign == x.callsign) or (n and n == _name(x.vessel)) for x in ships)

    for s in body.lineup:
        if not known(s, lineup + occupants):
            lineup.append(Ship(vessel=s.vessel, callsign=s.callsign, group=s.group, gt=s.gt, kind=s.kind,
                               arrived=_ts(s.arrivedAt), source="user"))
    for s in body.plan:
        if not known(s, plan + lineup + occupants):
            plan.append(Ship(vessel=s.vessel, callsign=s.callsign, group=s.group, gt=s.gt, kind=s.kind,
                             eta=_ts(s.eta), source="user"))

    t = body.vessel
    req = DecisionRequest(port=body.port, berth_key=key, berth_name=body.berth,
                          target=Ship(vessel=t.vessel, callsign=t.callsign, group=t.group, kind=t.kind, gt=t.gt,
                                      domestic=t.domestic, eta=eta),
                          condition=body.condition, occupants=occupants, lineup=lineup, plan=plan, tau=at)
    t1 = time.time()
    with c.lock:
        occ, q = c.occ, c.queue
    out = decide(req, occ, q, c.bundle, c.recal)
    log.info("decision %s %s: state %.2fs, engine %.2fs", body.port, body.berth, t1 - t0, time.time() - t1)
    # 기록은 쓰기 전용 스레드가 한다. 수집이 쓰기 잠금을 쥔 동안 응답이 기다리지 않게 한다
    _decision_log.put((at.isoformat(), body.model_dump_json(), json.dumps(out, ensure_ascii=False)))
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


@app.get("/api/cii/constants")
def cii_constants() -> dict:
    from kjit.engine.cii import constants

    return constants()


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


# ---------------------------------------------------------------- 에이전트

class TextIn(BaseModel):
    text: str = Field(max_length=40000)
    port: str | None = None


class PolicyIn(BaseModel):
    rta: str
    delayH: float
    speedKn: float
    fuelT: float
    co2T: float


class DecisionSummary(BaseModel):
    """설명·문안 생성에 넘기는 결정 요약 (재생·실시간 공통)."""
    port: str
    berth: str
    vessel: str = ""
    group: str = ""
    gt: float | None = None
    tau: str
    a0: str
    condition: str
    risk: str
    quantilesH: list[float] = Field(min_length=19, max_length=19)
    busyAtTau: bool
    queue: list[dict] = Field(default_factory=list, max_length=60)
    policy: PolicyIn
    designSpeedKn: float
    maxDelayH: float


class DraftIn(BaseModel):
    decision: DecisionSummary
    kind: str = Field(pattern="^(master|charterer)$")


class ChatIn(BaseModel):
    messages: list[dict] = Field(max_length=24)


def _wait_stats(port: str) -> dict:
    df = pd.read_csv(config.PROC_DIR / "wait_summary.csv")
    row = df[df["항만"] == port]
    if row.empty:
        raise HTTPException(404, f"대기 통계가 없는 항만입니다: {port}")
    from kjit.engine.evidence import MIN_N

    out = {k: (None if pd.isna(v) else v) for k, v in row.iloc[0].to_dict().items()}
    if (out.get("대기 추정 항차") or 0) < MIN_N:  # 표본이 너무 적으면 분포 통계를 내지 않는다
        out.update({k: None for k in ("대기 중앙값 h", "대기 p75 h", "대기 p90 h", "12h 이상 %")})
    return out | {"basis": "2025-10~2026-09 입항분, 같은 선석 선행 선박 출항 기준 하한 추정"}


def toolbox() -> dict:
    from kjit.service.state import port_state as build_state

    def recommend(port, berth, eta, group, gt, condition):
        return decision(DecisionIn(port=port, berth=berth, eta=eta, condition=condition,
                                   vessel=ShipIn(vessel="질의 선박", group=group, gt=gt)))

    return {
        "get_port_state": lambda port: build_state(ctx(), port, None),
        "list_berths": lambda port: ctx().berths(port),
        "recommend_arrival": recommend,
        "simulate_policy": lambda **kw: simulate_run(SimulateIn(**kw)),
        "wait_statistics": _wait_stats,
    }


def _agent(fn, *args, **kw) -> dict:
    try:
        return fn(*args, **kw)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@app.get("/api/agent/status")
def agent_status() -> dict:
    from kjit.service import agent

    return agent.status()


@app.get("/api/agent/examples")
def agent_examples() -> dict:
    p = config.PROC_DIR / "web" / "agent_examples.json"
    if not p.exists():
        raise HTTPException(503, "에이전트 예시가 없습니다")
    return json.loads(p.read_text())


@app.post("/api/agent/contract")
def agent_contract(body: TextIn) -> dict:
    from kjit.service import agent

    return _agent(agent.contract, body.text)


@app.post("/api/agent/lineup")
def agent_lineup(body: TextIn) -> dict:
    from kjit.service import agent

    c = ctx()
    return _agent(agent.lineup, body.text, body.port, {p: c.berths(p) for p in PORTS.values()})


@app.post("/api/agent/explain")
def agent_explain(body: DecisionSummary) -> dict:
    from kjit.service import agent

    return _agent(agent.explain, body.model_dump())


@app.post("/api/agent/draft")
def agent_draft(body: DraftIn) -> dict:
    from kjit.service import agent

    return _agent(agent.draft, body.decision.model_dump(), body.kind)


@app.post("/api/agent/chat")
def agent_chat(body: ChatIn) -> dict:
    from kjit.service import agent

    ctx()
    return _agent(agent.chat, body.messages, toolbox())


def main() -> None:
    import uvicorn

    uvicorn.run("kjit.service.app:app", host="0.0.0.0", port=int(config.env("PORT", "8000") or 8000))


if __name__ == "__main__":
    main()
