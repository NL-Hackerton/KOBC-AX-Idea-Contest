"""에이전트: 규칙 폴백의 결과, 템플릿 수치의 근거, LLM 응답 검증(가짜 응답으로)."""

import datetime as dt
import json
from types import SimpleNamespace

import pytest

from kjit.service import agent, config
from kjit.service import agent_rules as R
from kjit.service.agent_examples import CONTRACTS, MAILS, summary_from_replay

REF = dt.datetime(2026, 10, 8, 16, 0, tzinfo=R.KST)
BERTHS = {
    "울산": [{"key": "820|a", "name": "SK7부두"}, {"key": "820|b", "name": "SK2부두 02"}],
    "대산": [{"key": "300|a", "name": "현대오일뱅크 돌핀 13"}, {"key": "300|b", "name": "현대오일뱅크 돌핀 15"}],
}


def _featured():
    data = json.loads((config.PROC_DIR / "replay" / "cases.json").read_text())
    by = {c["id"]: c for c in data["cases"]}
    return [by[f] for f in data["featured"]]


def test_contract_rules_kinds():
    kinds = [[c["kind"] for c in R.contract_rules(x["text"])["clauses"]] for x in CONTRACTS]
    assert kinds[0] == ["utmost_despatch", "notice_readiness", "demurrage_laytime", "jit_arrival", "fuel_sharing"]
    assert kinds[1] == ["utmost_despatch", "virtual_arrival", "fuel_sharing", "demurrage_laytime"]
    assert "jit_arrival" not in kinds[2] and "utmost_despatch" in kinds[2]
    for x in CONTRACTS:  # 인용은 본문 그대로
        for c in R.contract_rules(x["text"])["clauses"]:
            assert x["text"][c["start"]:c["end"]] == c["quote"]


def test_lineup_rules():
    en = R.lineup_rules(MAILS[0]["text"], "울산", BERTHS["울산"], REF)["ships"]
    assert [(s["vessel"], s["status"], s["berth"]) for s in en] == [
        ("Ocean Pioneer", "berthed", "SK7부두"), ("Hana Glory", "waiting", "SK7부두"), ("Sea Rose", "inbound", "SK7부두"),
        ("Korea Star", "berthed", "SK2부두 02"), ("Blue Wave", "waiting", "SK2부두 02")]
    assert en[1]["time"] == "2026-10-07T22:10+09:00"  # 07/10 은 일/월
    ko = R.lineup_rules(MAILS[1]["text"], "대산", BERTHS["대산"], REF)["ships"]
    assert [(s["vessel"], s["status"]) for s in ko] == [("한빛 프론티어", "berthed"), ("그랜드 스텔라", "waiting"),
                                                         ("코스모 퀸", "inbound"), ("서해 에이스", "waiting")]
    assert ko[3]["berth"] == "현대오일뱅크 돌핀 15" and ko[2]["time"] == "2026-10-09T06:00+09:00"


def test_templates_use_only_engine_numbers():
    for case in _featured():
        for cond in ("public", "lineup", "plan"):
            for risk in ("0.1", "0.2", "0.3", "0.5"):
                d = summary_from_replay(case, cond, risk)
                src = agent._decision_sources(d)
                assert R.ungrounded_numbers(R.explain_template(d), src) == [], (case["id"], cond, risk)
                for kind in ("master", "charterer"):
                    t = R.draft_template(d, kind)
                    assert R.ungrounded_numbers(t["ko"] + t["en"], src) == [], (case["id"], cond, risk, kind)


def test_ungrounded_detects_invented_numbers():
    assert R.ungrounded_numbers("연료 12.4t을 줄입니다", [{"fuelT": 12.4}]) == []
    assert R.ungrounded_numbers("확률은 23%입니다", [{"p": 0.23}]) == []
    assert R.ungrounded_numbers("연료 31.7t을 줄입니다", [{"fuelT": 12.4}]) == ["31.7"]


def test_fallback_when_disabled(monkeypatch):
    monkeypatch.setenv("KJIT_AGENT_LIVE", "0")
    out = agent.contract(CONTRACTS[0]["text"])
    assert out["generatedBy"] == "fallback" and out["fallbackReason"] == "disabled"
    d = summary_from_replay(_featured()[1], "lineup", "0.1")
    assert agent.explain(d)["generatedBy"] == "fallback"


def _fake(text: str):
    return lambda kind, **kw: SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], stop_reason="end_turn")


def test_llm_contract_drops_quotes_not_in_text(monkeypatch):
    text = CONTRACTS[2]["text"]
    real = "Demurrage: USD 22,000 per day pro rata."
    fake = {"clauses": [{"kind": "demurrage_laytime", "quote": real, "note": "체선료율은 일당 22,000달러입니다."},
                        {"kind": "jit_arrival", "quote": "Charterers may nominate an RTA.", "note": "없는 조항"}],
            "assessment": "JIT 조항이 없습니다."}
    monkeypatch.setattr(agent, "_create", _fake(json.dumps(fake)))
    out = agent.contract(text)
    assert out["generatedBy"] == "llm"
    assert [c["kind"] for c in out["clauses"]] == ["demurrage_laytime"]
    assert text[out["clauses"][0]["start"]:out["clauses"][0]["end"]] == real
    assert out["ungrounded"] == []


def test_llm_explain_with_invented_number_falls_back(monkeypatch):
    d = summary_from_replay(_featured()[1], "lineup", "0.1")
    monkeypatch.setattr(agent, "_create", _fake("연료 999.9t을 줄일 수 있습니다."))
    out = agent.explain(d)
    assert out["generatedBy"] == "fallback" and out["fallbackReason"] == "ungrounded" and out["rejected"] == ["999.9"]
    ok = f"권고 도착에 맞추면 연료 {d['policy']['fuelT']:.1f}t을 줄입니다."
    monkeypatch.setattr(agent, "_create", _fake(ok))
    assert agent.explain(d) == {"text": ok, "generatedBy": "llm"}


def test_llm_lineup_rejects_invented_vessel(monkeypatch):
    fake = {"ships": [{"berth": "SK7 BERTH", "order": 1, "vessel": "MT GHOST", "status": "waiting",
                       "time": "2026-10-07T22:10+09:00", "cargo": None}]}
    monkeypatch.setattr(agent, "_create", _fake(json.dumps(fake)))
    out = agent.lineup(MAILS[0]["text"], "울산", BERTHS, REF)
    assert out["generatedBy"] == "fallback" and out["fallbackReason"] == "unverified"
    fake["ships"][0]["vessel"] = "HANA GLORY"
    monkeypatch.setattr(agent, "_create", _fake(json.dumps(fake)))
    out = agent.lineup(MAILS[0]["text"], "울산", BERTHS, REF)
    assert out["generatedBy"] == "llm" and out["ships"][0]["berthKey"] == "820|a"


def test_long_input_rejected():
    with pytest.raises(ValueError):
        agent.contract("x" * (agent.MAX_INPUT_CHARS + 1))


def test_josa():
    assert R.josa("SK7부두", "은", "는") == "SK7부두는"
    assert R.josa("씨텍돌핀21", "은", "는") == "씨텍돌핀21은"
    assert R.josa("석탄부두 01", "을", "를") == "석탄부두 01을"
