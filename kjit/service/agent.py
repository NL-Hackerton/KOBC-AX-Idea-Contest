"""LLM 에이전트: 조항 추출, 대기 순번 메일 구조화, 권고 설명, 지시문·요청서, 질의응답.

호출은 KJIT_AGENT_LIVE=1 이고 ANTHROPIC_API_KEY 가 있을 때만 한다(비용 승인 전에는 꺼 둔다).
꺼져 있거나, 오늘 쓴 비용이 AGENT_DAILY_USD_CAP 을 넘었거나, 호출·검증이 실패하면 agent_rules 의
규칙·템플릿 결과를 같은 형태로 돌려준다. 응답의 generatedBy 는 "llm" 또는 "fallback" 이다.

수치는 엔진 도구 결과와 사용자 입력에서만 온다. LLM 답변의 수치가 근거에 없으면 설명·문안은 템플릿으로
바꾸고, 질의응답은 근거 없는 수치 목록을 함께 돌려준다.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from typing import Any, Callable

from kjit.service import agent_rules as R
from kjit.service import config, db

log = logging.getLogger("kjit.agent")
KST = R.KST

MODEL = config.env("KJIT_AGENT_MODEL", "claude-opus-5-5") or "claude-opus-5-5"
# 1백만 토큰당 미화 (입력, 출력). 캐시 읽기는 입력의 0.05배, 캐시 쓰기는 1.25배로 계산한다.
PRICES = {"claude-opus-5-5": (4.0, 20.0), "claude-sonnet-5-5": (2.0, 10.0), "claude-haiku-5-5": (0.10, 0.50)}
MAX_INPUT_CHARS = 20000
CHAT_MAX_TURNS = 6
EST_USD = {"contract": 0.15, "lineup": 0.05, "explain": 0.05, "draft": 0.06, "chat": 0.40}


class Unavailable(Exception):
    """LLM을 쓰지 않고 폴백으로 가야 하는 이유."""


def live() -> bool:
    return config.env("KJIT_AGENT_LIVE", "0") == "1" and bool(config.ANTHROPIC_API_KEY)


def spent_today() -> float:
    day = dt.datetime.now(KST).date().isoformat()
    with db.session() as con:
        v = con.execute("SELECT COALESCE(SUM(usd), 0) FROM agent_log WHERE substr(at, 1, 10) = ?", (day,)).fetchone()[0]
    return float(v)


def status() -> dict:
    return {"live": live(), "model": MODEL, "spentTodayUsd": round(spent_today(), 4), "capUsd": config.AGENT_DAILY_USD_CAP}


def _log(kind: str, usage: Any, ok: bool, note: str = "") -> float:
    pin, pout = PRICES.get(MODEL, PRICES["claude-opus-5-5"])
    usd = 0.0
    tin = tout = 0
    if usage is not None:
        tin = (usage.input_tokens or 0)
        tout = usage.output_tokens or 0
        cr = getattr(usage, "cache_read_input_tokens", 0) or 0
        cw = getattr(usage, "cache_creation_input_tokens", 0) or 0
        usd = (tin * pin + tout * pout + cr * pin * 0.05 + cw * pin * 1.25) / 1e6
    with db.session() as con:
        con.execute("INSERT INTO agent_log VALUES (?,?,?,?,?,?,?,?)",
                    (dt.datetime.now(KST).isoformat(timespec="seconds"), kind, MODEL, tin, tout, usd, int(ok), note[:500]))
    return usd


_client = None


def _get_client():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY, max_retries=1, timeout=60.0)
    return _client


def _create(kind: str, **params) -> Any:
    """Messages API 한 번 호출. 거절 시 서버 쪽 대체 모델로 이어 받도록 fallbacks 를 켠다."""
    if not live():
        raise Unavailable("disabled")
    if spent_today() + EST_USD.get(kind, 0.1) > config.AGENT_DAILY_USD_CAP:
        raise Unavailable("cap")
    import anthropic

    client = _get_client()
    try:
        try:
            msg = client.beta.messages.create(model=MODEL, betas=["server-side-fallback-2026-07-01"], fallbacks="default",
                                              **params)
        except anthropic.BadRequestError as e:
            if "fallback" not in str(e).lower():
                raise
            msg = client.messages.create(model=MODEL, **params)
    except anthropic.APIError as e:
        _log(kind, None, False, f"{type(e).__name__}: {e}")
        raise Unavailable("error") from e
    _log(kind, msg.usage, msg.stop_reason not in ("refusal", "max_tokens"), msg.stop_reason or "")
    if msg.stop_reason in ("refusal", "max_tokens"):
        raise Unavailable(msg.stop_reason)
    return msg


def _text(msg) -> str:
    return "".join(b.text for b in msg.content if b.type == "text").strip()


def _json(kind: str, system: str, user: str, schema: dict, effort: str = "medium", max_tokens: int = 8000) -> dict:
    msg = _create(kind, max_tokens=max_tokens, system=system, messages=[{"role": "user", "content": user}],
                  output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}})
    try:
        return json.loads(_text(msg))
    except json.JSONDecodeError as e:
        raise Unavailable("invalid-json") from e


def _fallback(out: dict, reason: str) -> dict:
    return {**out, "generatedBy": "fallback", "fallbackReason": reason}


def _check_len(text: str) -> str:
    if len(text) > MAX_INPUT_CHARS:
        raise ValueError(f"본문이 너무 깁니다 ({len(text):,}자). {MAX_INPUT_CHARS:,}자 이하로 나눠 넣어 주세요.")
    return text


# ---------------------------------------------------------------- 조항 추출

CONTRACT_SYSTEM = """You review voyage charter parties for a Korean shipping operations team that wants to slow-steam to a berth-availability-based Required Time of Arrival (Just-in-Time arrival).
Find every clause relevant to that decision: JIT arrival / RTA, virtual arrival, utmost despatch or speed obligations, notice of readiness, laytime and demurrage, fuel cost and saving allocation.
For each, copy the clause text verbatim from the contract into `quote` (exact characters, no paraphrase, no ellipsis) and write a short Korean `note` (1-2 sentences) on what it means for slowing down to arrive just in time.
Write `assessment` in Korean (1-2 sentences): can the operator instruct a speed reduction under this contract, and what must be checked or agreed first. Do not invent clauses, rates or numbers that are not in the text."""

CONTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "clauses": {"type": "array", "items": {
            "type": "object",
            "properties": {"kind": {"type": "string", "enum": list(R.CLAUSE_KINDS)}, "quote": {"type": "string"},
                           "note": {"type": "string"}},
            "required": ["kind", "quote", "note"], "additionalProperties": False}},
        "assessment": {"type": "string"},
    },
    "required": ["clauses", "assessment"], "additionalProperties": False,
}


def contract(text: str) -> dict:
    text = _check_len(text)
    rules = R.contract_rules(text)
    try:
        out = _json("contract", CONTRACT_SYSTEM, text, CONTRACT_SCHEMA)
    except Unavailable as e:
        return _fallback(rules, str(e))
    clauses = []
    for c in out["clauses"]:
        pos = R.locate(text, c["quote"])
        if pos is None:  # 본문에 없는 인용은 버린다
            continue
        clauses.append({"kind": c["kind"], "label": R.CLAUSE_KINDS[c["kind"]], "quote": text[pos[0]:pos[1]],
                        "start": pos[0], "end": pos[1], "note": c["note"]})
    if not clauses and rules["clauses"]:
        return _fallback(rules, "unverified")
    bad = R.ungrounded_numbers(out["assessment"] + " ".join(c["note"] for c in clauses), [text])
    return {"clauses": sorted(clauses, key=lambda c: c["start"]), "assessment": out["assessment"],
            "generatedBy": "llm", "ungrounded": bad}


# ---------------------------------------------------------------- 대기 순번 메일

LINEUP_SYSTEM = """You turn a ship agent's berth line-up e-mail into structured rows for a Korean operations team.
One row per vessel. status: "berthed" (alongside / 접안 중), "waiting" (at anchorage, NOR tendered, 정박지 대기), "inbound" (ETA, 도착 예정).
time: for berthed the berthing time, for waiting the anchorage arrival (or NOR) time, for inbound the ETA, as ISO 8601 with +09:00; null if absent.
Interpret dates relative to the reference time given. Dates written a/b are day/month unless that is impossible or clearly wrong for the reference time.
berth: the berth name exactly as written in the mail section or line; null if none. order: the line-up position as written, else the order of appearance within the berth.
cargo: short cargo description with quantity if given, else null. Never invent vessels or times."""

LINEUP_SCHEMA = {
    "type": "object",
    "properties": {"ships": {"type": "array", "items": {
        "type": "object",
        "properties": {"berth": {"type": ["string", "null"]}, "order": {"type": "integer"}, "vessel": {"type": "string"},
                       "status": {"type": "string", "enum": ["berthed", "waiting", "inbound"]},
                       "time": {"type": ["string", "null"]}, "cargo": {"type": ["string", "null"]}},
        "required": ["berth", "order", "vessel", "status", "time", "cargo"], "additionalProperties": False}}},
    "required": ["ships"], "additionalProperties": False,
}


def lineup(text: str, port: str | None, ports: dict[str, list[dict]], now: dt.datetime | None = None) -> dict:
    text = _check_len(text)
    now = now or dt.datetime.now(KST)
    port = port or R.detect_port(text, list(ports))
    berths = ports.get(port, []) if port else []
    rules = R.lineup_rules(text, port, berths, now)
    try:
        out = _json("lineup", LINEUP_SYSTEM, f"Reference time: {now.isoformat(timespec='minutes')}\n\n{text}",
                    LINEUP_SCHEMA, effort="low")
    except Unavailable as e:
        return _fallback(rules, str(e))
    ships = []
    for s in out["ships"]:
        b = R.match_berth(s["berth"], berths) if s["berth"] else None
        t = None
        if s["time"]:
            try:
                t = dt.datetime.fromisoformat(s["time"]).astimezone(KST).isoformat(timespec="minutes")
            except ValueError:
                t = None
        ships.append({"berth": b["name"] if b else s["berth"], "berthKey": b["key"] if b else None, "order": s["order"],
                      "vessel": s["vessel"], "status": s["status"], "time": t, "cargo": s["cargo"], "line": None})
    # 메일에 없는 선박 이름이 섞이면 규칙 결과로 바꾼다
    if any(s["vessel"].lower() not in text.lower() for s in ships):
        return _fallback(rules, "unverified")
    return {"port": port, "ships": ships, "generatedBy": "llm"}


# ---------------------------------------------------------------- 권고 설명·문안

EXPLAIN_SYSTEM = """You explain a just-in-time arrival recommendation to a Korean ship operator in 3-5 plain Korean sentences.
The input JSON comes from the K-JIT engine: quantilesH are hours after `tau` at which the berth becomes free (nominal levels 5%..95%), `queue` lists ships ahead, `policy` is the recommendation at the chosen risk level (risk = probability that the berth is already free at the recommended arrival).
Use only numbers and times that appear in the input; never compute new figures, never round differently, never add percentages that are not given. Times are KST; write them as "M월 D일 HH:MM".
Explain why this arrival time, what the operator gains (fuel, CO2), and the main caveat. No headings, no lists."""

DRAFT_SYSTEM = """You write a short operational message for a shipping company from a K-JIT recommendation, in Korean (`ko`) and English (`en`).
kind "master": instruction from operations to the Master to adjust speed for the required time of arrival, with safety override.
kind "charterer": owners' request to charterers to nominate a Required Time of Arrival under the charter party's Just-in-Time arrival provisions, noting that laytime/demurrage for the extra sailing time follows the charter party.
Use only numbers and times present in the input JSON; times are KST. Keep each version under 12 lines, plain text, no markdown."""

DRAFT_SCHEMA = {"type": "object", "properties": {"ko": {"type": "string"}, "en": {"type": "string"}},
                "required": ["ko", "en"], "additionalProperties": False}


def _decision_sources(d: dict) -> list[Any]:
    """설명·문안이 써도 되는 수치: 입력 결정과, 거기서 템플릿이 만드는 시각 표기."""
    times = []
    q = d.get("quantilesH") or []
    if q and d.get("tau"):
        times = [R._fmt(R._plus(d["tau"], h)) for h in q]
    from kjit.engine.core import NOMINAL

    return [d, list(NOMINAL), times, [R._fmt(d.get(k)) for k in ("tau", "a0")], R._fmt(d["policy"]["rta"]),
            R._fmt_en(d["policy"]["rta"]), R._fmt_en(d.get("a0")), float(d["risk"]) * 100]


def explain(d: dict) -> dict:
    tpl = R.explain_template(d)
    try:
        msg = _create("explain", max_tokens=4000, system=EXPLAIN_SYSTEM, output_config={"effort": "medium"},
                      messages=[{"role": "user", "content": json.dumps(d, ensure_ascii=False)}])
        txt = _text(msg)
    except Unavailable as e:
        return _fallback({"text": tpl}, str(e))
    bad = R.ungrounded_numbers(txt, _decision_sources(d))
    if bad or not txt:
        return _fallback({"text": tpl, "rejected": bad}, "ungrounded")
    return {"text": txt, "generatedBy": "llm"}


def draft(d: dict, kind: str) -> dict:
    tpl = R.draft_template(d, kind)
    try:
        out = _json("draft", DRAFT_SYSTEM, json.dumps({"kind": kind, "decision": d}, ensure_ascii=False), DRAFT_SCHEMA,
                    effort="low")
    except Unavailable as e:
        return _fallback(tpl, str(e))
    bad = R.ungrounded_numbers(out["ko"] + "\n" + out["en"], _decision_sources(d))
    if bad:
        return _fallback({**tpl, "rejected": bad}, "ungrounded")
    return {**out, "generatedBy": "llm"}


# ---------------------------------------------------------------- 질의응답

CHAT_SYSTEM = """You are the K-JIT assistant for Korean tanker and bulk operators calling Ulsan, Daesan, Gwangyang and Yeocheon.
K-JIT forecasts when a single-occupancy berth becomes free and recommends a later arrival (slow steaming) so the ship does not wait at anchorage.
Answer in Korean, briefly. Call the tools for every number: berth state, recommendations, simulations and waiting statistics come only from tool results. Never estimate or invent numbers, times, vessel names or berth names.
If a required input is missing (port, berth, arrival time), ask for it in one sentence or state the assumption you passed to the tool (e.g. default ship type).
Times are KST; "now" is given below. Recommendations are decision support; the Master keeps responsibility for safe speed."""

PORT_ENUM = ["울산", "대산", "광양", "여천"]
COND_ENUM = ["public", "lineup", "plan"]
GROUP_ENUM = ["탱커·가스", "벌크", "일반화물", "컨테이너", "자동차운반", "기타"]

CHAT_TOOLS = [
    {"name": "get_port_state", "strict": True,
     "description": "Current berth occupancy, anchorage waiting ships and declared inbound ships of a port, from public data collected by K-JIT.",
     "input_schema": {"type": "object", "properties": {"port": {"type": "string", "enum": PORT_ENUM}},
                      "required": ["port"], "additionalProperties": False}},
    {"name": "list_berths", "strict": True,
     "description": "Names of the single-occupancy berths of a port that K-JIT can forecast. Use to resolve a berth name the user typed.",
     "input_schema": {"type": "object", "properties": {"port": {"type": "string", "enum": PORT_ENUM}},
                      "required": ["port"], "additionalProperties": False}},
    {"name": "recommend_arrival", "strict": True,
     "description": "Run the K-JIT engine for one ship: berth-free time distribution and recommended arrival, speed and fuel saving at risk levels 0.1/0.2/0.3/0.5. Ships already waiting at anchorage for the same berth are included automatically.",
     "input_schema": {"type": "object", "properties": {
         "port": {"type": "string", "enum": PORT_ENUM},
         "berth": {"type": "string", "description": "Exact berth name from list_berths"},
         "eta": {"type": "string", "description": "Original ETA, ISO 8601 with +09:00"},
         "group": {"type": "string", "enum": GROUP_ENUM},
         "gt": {"type": "number", "description": "Gross tonnage; 5000 if unknown"},
         "condition": {"type": "string", "enum": COND_ENUM, "description": "Information condition; lineup by default"}},
         "required": ["port", "berth", "eta", "group", "gt", "condition"], "additionalProperties": False}},
    {"name": "simulate_policy", "strict": True,
     "description": "Replay the JIT policy over historical calls (2025-10..2026-09) for a port or all ports and return fuel/CO2 saving, extra berth idle time and utilisation.",
     "input_schema": {"type": "object", "properties": {
         "port": {"type": "string", "enum": PORT_ENUM + ["전체"]},
         "start": {"type": "string", "description": "YYYY-MM, from 2025-10"}, "end": {"type": "string", "description": "YYYY-MM, to 2026-09"},
         "condition": {"type": "string", "enum": COND_ENUM}, "risk": {"type": "number", "enum": [0.1, 0.2, 0.3, 0.5]},
         "participation": {"type": "number", "description": "Share of ships participating, 0..1"}},
         "required": ["port", "start", "end", "condition", "risk", "participation"], "additionalProperties": False}},
    {"name": "wait_statistics", "strict": True,
     "description": "Measured anchorage-to-berth waiting statistics per port from one year of public call data (median, p75, p90, share over 12 h).",
     "input_schema": {"type": "object", "properties": {"port": {"type": "string", "enum": PORT_ENUM + ["부산", "인천", "평택", "여수", "포항신항"]}},
                      "required": ["port"], "additionalProperties": False}},
]

Toolbox = dict[str, Callable[..., Any]]


def _compact(name: str, res: Any) -> Any:
    """도구 결과를 모델에 넘길 크기로 줄인다 (화면 기록에는 같은 값을 남긴다)."""
    if name == "get_port_state" and isinstance(res, dict):
        return {"port": res.get("port"), "at": res.get("at"),
                "berths": [{k: b.get(k) for k in ("berth", "vessel", "group", "since", "elapsedH", "source")} |
                           {"freeMedianH": (b.get("predQ") or [None] * 7)[3]} for b in res.get("berths", [])][:40],
                "anchorage": [{k: w.get(k) for k in ("vessel", "group", "since", "waitedH", "targetBerth")} for w in res.get("anchorage", [])][:30],
                "inbound": [{k: i.get(k) for k in ("vessel", "group", "eta", "facility")} for i in res.get("inbound", [])][:20]}
    if name == "recommend_arrival" and isinstance(res, dict) and "policies" in res:
        return {k: res[k] for k in ("tau", "a0", "berth", "busyAtTau", "designSpeedKn", "maxDelayH", "policies", "quantilesH")} | {
            "queue": [{k: m.get(k) for k in ("vessel", "status", "arrivedAt", "plannedAt")} for m in res.get("queue", [])]}
    if name == "simulate_policy" and isinstance(res, dict):
        return {k: v for k, v in res.items() if k not in ("byBerth", "delayHist")}
    return res


def _run_tool(box: Toolbox, name: str, args: dict) -> tuple[Any, bool]:
    try:
        return box[name](**args), True
    except Exception as e:  # 도구 오류는 모델에 전달해 고치게 한다
        detail = getattr(e, "detail", None) or str(e)
        return {"error": detail}, False


def chat(messages: list[dict], box: Toolbox, now: dt.datetime | None = None) -> dict:
    now = now or dt.datetime.now(KST)
    msgs = [{"role": m["role"], "content": str(m["content"])[:4000]} for m in messages[-12:]
            if m.get("role") in ("user", "assistant") and m.get("content")]
    if not msgs or msgs[-1]["role"] != "user":
        raise ValueError("마지막 메시지는 질문이어야 합니다")
    question = msgs[-1]["content"]
    try:
        return _chat_llm(msgs, box, now)
    except Unavailable as e:
        return _fallback(_chat_rules(question, box, now), str(e))


def _chat_llm(msgs: list[dict], box: Toolbox, now: dt.datetime) -> dict:
    system = CHAT_SYSTEM + f"\nNow: {now.isoformat(timespec='minutes')} (KST)."
    convo: list[dict] = list(msgs)
    calls: list[dict] = []
    for _ in range(CHAT_MAX_TURNS):
        msg = _create("chat", max_tokens=8000, system=system, tools=CHAT_TOOLS, messages=convo,
                      output_config={"effort": "medium"})
        uses = [b for b in msg.content if b.type == "tool_use"]
        if not uses:
            answer = _text(msg)
            sources = [c["result"] for c in calls] + [c["input"] for c in calls] + [m["content"] for m in msgs] + [now.isoformat()]
            return {"answer": answer, "tools": calls, "generatedBy": "llm",
                    "ungrounded": R.ungrounded_numbers(answer, sources)}
        convo.append({"role": "assistant", "content": msg.content})
        results = []
        for u in uses:
            res, ok = _run_tool(box, u.name, dict(u.input))
            small = _compact(u.name, res)
            calls.append({"name": u.name, "input": dict(u.input), "ok": ok, "result": small})
            results.append({"type": "tool_result", "tool_use_id": u.id, "is_error": not ok,
                            "content": json.dumps(small, ensure_ascii=False, default=str)[:30000]})
        convo.append({"role": "user", "content": results})
    raise Unavailable("too-many-turns")


def _chat_rules(q: str, box: Toolbox, now: dt.datetime) -> dict:
    """LLM 없이: 질문에서 항만·선석·시각을 찾아 엔진 도구를 부르고 템플릿으로 답한다."""
    ports = {p: box["list_berths"](port=p) for p in PORT_ENUM}
    calls: list[dict] = []

    def call(name: str, **args):
        res, ok = _run_tool(box, name, args)
        calls.append({"name": name, "input": args, "ok": ok, "result": _compact(name, res)})
        return res, ok

    port, berth = R.find_berth(q, ports)
    port = port or R.detect_port(q, PORT_ENUM)
    when = R.parse_when(q, now)

    if berth and when:
        group = R.guess_group(q) or "탱커·가스"
        res, ok = call("recommend_arrival", port=port, berth=berth["name"], eta=when.isoformat(timespec="minutes"),
                       group=group, gt=5000, condition="lineup")
        if not ok:
            return {"answer": f"{port} {berth['name']} 권고를 계산하지 못했습니다: {res['error']}", "tools": calls}
        p = res["policies"]["0.1"]
        if not res["busyAtTau"]:
            ans = f"{R._fmt(res['tau'])} 기준 {R.josa(berth['name'], '은', '는')} 비어 있어 원래 일정({R._fmt(res['a0'])})대로 들어가면 됩니다."
        elif p["delayH"] < 0.05:
            ans = (f"{R.josa(berth['name'], '은', '는')} 지금 차 있지만, 가장 보수적인 위험 수준 0.1에서는 늦출 근거가 부족해 원래 일정({R._fmt(res['a0'])})을 권합니다. "
                   f"위험 수준 0.5로 잡으면 {R._fmt(res['policies']['0.5']['rta'])} 도착, {res['policies']['0.5']['delayH']:.1f}시간 늦춤입니다.")
        else:
            ans = (f"{berth['name']}에 {R._fmt(res['a0'])} 도착 예정이면, 위험 수준 0.1 기준 {R._fmt(p['rta'])}에 도착하도록 "
                   f"{p['delayH']:.1f}시간 늦추고 {p['speedKn']:.1f}노트로 항해하는 것을 권합니다. 연료 {p['fuelT']:.1f}t, CO2 {p['co2T']:.1f}t을 줄입니다.")
        ans += f" (가정: {group}, 총톤수 5,000, 정박지 대기 순번 반영. 배 정보를 알려주면 다시 계산합니다.)"
        return {"answer": ans, "tools": calls}

    if berth:
        return {"answer": f"{port} {berth['name']}에 언제 도착할 예정인지 알려주세요. 예: '내일 오후 2시'.", "tools": calls}

    if port and any(w in q for w in ("얼마나", "통계", "보통", "평균", "중앙값")) and "대기" in q:
        res, ok = call("wait_statistics", port=port)
        if ok and res.get("대기 중앙값 h") is None:
            return {"answer": f"{R.josa(port, '은', '는')} 정박지를 거쳐 접안한 것으로 추정되는 항차가 {int(res.get('대기 추정 항차') or 0)}건뿐이라 대기 통계를 내지 않습니다. "
                              "대부분 정박지 대기 없이 바로 접안하는 것으로 기록됩니다.", "tools": calls}
        if ok:
            ans = (f"{port}에서 정박지를 거쳐 접안한 화물선 항차의 선석 대기(하한 추정)는 중앙값 {res['대기 중앙값 h']}시간, "
                   f"75% {res['대기 p75 h']}시간, 90% {res['대기 p90 h']}시간이고, 12시간 이상 기다린 항차가 {res['12h 이상 %']}%입니다.")
            return {"answer": ans, "tools": calls}

    if port and any(w in q for w in ("줄일", "절감", "시뮬", "1년", "연간")):
        cond = "plan" if "선석계획" in q else ("lineup" if "순번" in q else "public")
        res, ok = call("simulate_policy", port=port, start="2025-10", end="2026-09", condition=cond, risk=0.1, participation=1.0)
        if ok and res.get("cases"):
            ans = (f"{port}의 2025-10~2026-09 정박지→선석 항차 {res['cases']:,}건에 '{R.COND_LABEL[cond]}' 조건, 위험 수준 0.1, 참여율 100%를 적용하면 "
                   f"연료 {res['fuelT']:,.1f}t, CO2 {res['co2T']:,.1f}t을 줄입니다(대기 전부를 없앨 때 상한의 {res['shareOfUpper']}%). "
                   f"늦게 도착해 생기는 선석 유휴는 {res['extraIdleH']:,.1f}시간입니다.")
            return {"answer": ans, "tools": calls}

    if port:
        res, ok = call("get_port_state", port=port)
        if ok:
            occ = len(res.get("berths", []))
            ans = (f"{R._fmt(res['at'])} 기준 {port}: 예측 대상 선석 가운데 {occ}곳이 접안 중이고, 정박지 대기 {len(res.get('anchorage', []))}척, "
                   f"입항 신고 {len(res.get('inbound', []))}척입니다. 특정 선석과 도착 예정을 알려주면 도착 시각을 권고합니다.")
            return {"answer": ans, "tools": calls}

    return {"answer": "항만·선석·도착 예정을 함께 물어보면 엔진으로 계산해 답합니다. 예: '내일 오후 2시에 울산 SK7부두에 들어가는 탱커인데 언제 도착하면 돼?'",
            "tools": calls}
