"""에이전트 화면의 기본 예시. 모두 합성 문안이며 실제 계약·메일·선박과 무관하다.

조항 문안은 BIMCO 등 표준 서식의 취지를 참고해 새로 쓴 것이고 원문을 옮기지 않았다.
"""

CONTRACTS = [
    {
        "id": "voyage-jit",
        "title": "항해용선계약 (JIT 도착 조항 포함, 영문)",
        "text": """VOYAGE CHARTER PARTY - RIDER CLAUSES (SYNTHETIC EXAMPLE)

Clause 21. Speed
The Vessel shall proceed with utmost despatch to the loading port and thereafter to the discharging port, at a service speed of about 12.5 knots in good weather, subject always to the provisions of Clause 24.

Clause 22. Notice of Readiness
Upon arrival at the customary anchorage of the discharging port the Master shall tender Notice of Readiness by email, whether in berth or not. Laytime shall commence 6 hours after tender of Notice of Readiness.

Clause 23. Laytime and Demurrage
Total laytime for loading and discharging shall be 72 hours. Demurrage shall be paid at the rate of USD 25,000 per day or pro rata for any part of a day.

Clause 24. Just in Time Arrival
(a) Charterers may at any time instruct the Vessel to adjust speed in order to arrive at the discharging port at a Required Time of Arrival (RTA) nominated by Charterers.
(b) Compliance with such instruction shall not be a breach of the obligation to proceed with utmost despatch.
(c) The additional sailing time resulting from the adjusted speed shall count against laytime or, if the Vessel is on demurrage, shall be paid at 75 per cent of the demurrage rate.
(d) Owners shall provide Charterers with the estimated fuel saving resulting from each instruction.

Clause 25. Bunkers
Owners shall pay for all bunkers consumed during the voyage.
""",
    },
    {
        "id": "tanker-va",
        "title": "탱커 항해용선 부속서 (가상 도착 합의, 국문)",
        "text": """탱커 항해용선 부속서 (합성 예시)

제7조 (항해 속도)
선박은 적재항에서 양하항까지 합리적인 신속성을 다하여 항해한다. 기상 악화 등 불가항력의 경우는 예외로 한다.

제8조 (가상 도착)
양하항 선석이 혼잡하여 대기가 예상되는 경우 용선자는 선주에게 가상 도착(Virtual Arrival) 적용을 요청할 수 있다. 당사자가 합의하면 선박은 합의한 도착 시각에 맞추어 감속 항해하며, 정박기간과 체선 시간은 원래 속도로 항해하였다면 도착하였을 시각을 기준으로 계산한다.

제9조 (절감 연료의 배분)
가상 도착으로 절감된 연료비는 독립 검증인이 산정하며, 선주와 용선자가 50 대 50으로 나눈다.

제10조 (체선료)
허용 정박기간은 60시간으로 하며, 이를 초과하는 시간에 대하여 용선자는 일당 미화 18,000달러의 체선료를 지급한다.
""",
    },
    {
        "id": "no-jit",
        "title": "항해용선계약 (JIT 조항 없음, 영문)",
        "text": """VOYAGE CHARTER PARTY - ADDITIONAL CLAUSES (SYNTHETIC EXAMPLE)

1. The Vessel shall perform the voyage with utmost despatch and at all convenient speed. Any deviation or reduction of speed not required for the safety of the Vessel shall be for Owners' account.

2. Notice of Readiness may be tendered on arrival at the port anchorage, berth or no berth, and time shall count from 6 hours after tender.

3. Laytime: 84 running hours, Sundays and holidays included. Demurrage: USD 22,000 per day pro rata.

4. Charterers shall nominate a safe berth on arrival of the Vessel.
""",
    },
]

MAILS = [
    {
        "id": "ulsan-en",
        "title": "울산 대리점 라인업 (영문)",
        "port": "울산",
        "text": """Subject: ULSAN LINE-UP 08/10/2026 1600LT - SK BERTHS (SYNTHETIC EXAMPLE)

Dear Sirs,

Please find below the latest line-up at Ulsan as of 08/10 1600 LT.

SK7 BERTH
1. MT OCEAN PIONEER - alongside since 07/10 0930, ETC 09/10 0600
2. MT HANA GLORY - anchored E3 since 07/10 2210 (NOR tendered 07/10 2230), 35,000 MT gasoil
3. MT SEA ROSE - ETA 09/10 1400, 28,000 MT naphtha

SK2 BERTH 02
1. MT KOREA STAR - alongside since 08/10 0400
2. MT BLUE WAVE - anchored E1 since 08/10 0130

Berthing prospects remain subject to shore tank availability.

Best regards,
Agency operations (synthetic example)
""",
    },
    {
        "id": "daesan-ko",
        "title": "대산 대리점 라인업 (국문)",
        "port": "대산",
        "text": """제목: 대산항 현대오일뱅크 돌핀 라인업 (10/8 15:00 기준, 합성 예시)

운항팀 담당자님께,

1) 현대오일뱅크 돌핀 13
 - 접안 중: 한빛 프론티어 (10/7 18:00 접안, 10/9 02:00 작업 완료 예정)
 - 대기 1번: 그랜드 스텔라, 정박지 도착 10/7 23:40, 원유 80,000톤
 - 대기 2번: 코스모 퀸, 도착 예정 10/9 06:00
2) 현대오일뱅크 돌핀 15
 - 대기 1번: 서해 에이스, 정박지 도착 10/8 09:10

선석 사정에 따라 순번이 바뀔 수 있습니다.
""",
    },
]

QUESTIONS = [
    "내일 오후 2시에 울산 SK7부두에 들어가는 탱커인데 언제 도착하면 돼?",
    "지금 대산항 선석 상황 알려줘",
    "울산에서 선석계획을 공유하면 1년 동안 연료를 얼마나 줄일 수 있어?",
    "광양 정박지 대기는 보통 얼마나 길어?",
]


def summary_from_replay(case: dict, cond: str, risk: str) -> dict:
    """재생 사례 한 건을 설명·문안 입력 형태로 바꾼다 (웹의 같은 함수와 키가 같다)."""
    c = case["conditions"][cond]
    return {
        "port": case["port"], "berth": case["berth"], "vessel": case["vessel"], "group": case["group"], "gt": case["gt"],
        "tau": case["tau"], "a0": case["a0"], "condition": cond, "risk": risk, "quantilesH": c["quantilesH"],
        "busyAtTau": case["busyAtTau"] and len(c["queue"]) > 0, "queue": [{"vessel": m["vessel"], "status": m["status"]} for m in c["queue"]],
        "policy": {k: c["policies"][risk][k] for k in ("rta", "delayH", "speedKn", "fuelT", "co2T")},
        "designSpeedKn": case["designSpeedKn"], "maxDelayH": case["maxDelayH"],
    }


def build(ctx=None) -> dict:
    """저장본(서버 없음)에서 쓸 예시 묶음. 규칙·템플릿으로 만든 결과이며 generatedBy 를 그대로 남긴다."""
    import datetime as dt
    import json

    from kjit.service import agent, config
    from kjit.service.agent_rules import KST
    from kjit.service.ingest import PORTS

    if ctx is None:
        from kjit.service.state import Context

        ctx = Context()
    ports = {p: ctx.berths(p) for p in PORTS.values()}
    mail_ref = dt.datetime(2026, 10, 8, 16, 0, tzinfo=KST)  # 예시 메일의 작성 시각
    replay = json.loads((config.PROC_DIR / "replay" / "cases.json").read_text())
    by_id = {c["id"]: c for c in replay["cases"]}
    explain, drafts = {}, {}
    for fid in replay["featured"]:
        for cond in ("public", "lineup", "plan"):
            for risk in ("0.1", "0.2", "0.3", "0.5"):
                d = summary_from_replay(by_id[fid], cond, risk)
                key = f"{fid}|{cond}|{risk}"
                explain[key] = agent.explain(d)
                drafts[key] = {k: agent.draft(d, k) for k in ("master", "charterer")}
    return {
        "contracts": [{**c, "result": agent.contract(c["text"])} for c in CONTRACTS],
        "mails": [{**m, "result": agent.lineup(m["text"], m["port"], ports, mail_ref)} for m in MAILS],
        "questions": QUESTIONS,
        "explain": explain, "drafts": drafts,
    }


def main() -> None:
    import json

    from kjit.service import config

    out = config.PROC_DIR / "web" / "agent_examples.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    data = build()
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(f"→ {out} ({out.stat().st_size / 1e3:.0f}KB, 설명 {len(data['explain'])}건)")


if __name__ == "__main__":
    main()
