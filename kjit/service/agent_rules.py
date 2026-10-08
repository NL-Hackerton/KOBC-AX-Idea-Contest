"""에이전트 폴백: LLM 없이 같은 응답 형태를 만드는 규칙·템플릿과, 답변 수치의 근거 검사.

LLM 키가 없거나, 일일 비용 상한을 넘었거나, 호출·검증이 실패하면 이 모듈의 결과를 그대로 돌려준다.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from typing import Any

KST = dt.timezone(dt.timedelta(hours=9))
COND_LABEL = {"public": "공개 데이터만", "lineup": "대기 순번 공유", "plan": "선석계획 공유"}
STATUS_LABEL = {"berthed": "접안 중", "waiting": "정박지 대기", "inbound": "도착 예정"}

# ---------------------------------------------------------------- 조항 추출

CLAUSE_KINDS = {
    "jit_arrival": "JIT 도착",
    "virtual_arrival": "가상 도착",
    "utmost_despatch": "신속 항해 의무",
    "notice_readiness": "하역 준비 완료 통지",
    "demurrage_laytime": "정박기간·체선료",
    "fuel_sharing": "연료·절감 배분",
}
_PATTERNS = [
    ("virtual_arrival", r"virtual arrival|가상\s*도착"),
    ("jit_arrival", r"just[\s-]+in[\s-]+time|\bJIT\b|required time of arrival|\bRTA\b|도착\s*시각을\s*지정"),
    ("utmost_despatch", r"utmost despatch|all convenient speed|reasonable despatch|신속성|신속\s*항해|reduction of speed"),
    ("notice_readiness", r"notice of readiness|\bNOR\b|하역\s*준비\s*완료\s*통지"),
    ("demurrage_laytime", r"demurrage|laytime|체선료|정박기간"),
    ("fuel_sharing", r"bunkers?|fuel saving|절감된?\s*연료|연료비"),
]
_NOTES = {
    "jit_arrival": "용선자가 도착 시각(RTA)을 지정해 감속을 요청할 수 있는 근거입니다. 권고 도착을 이 조항의 지시로 보낼 수 있는지, 늘어난 항해시간에 적용되는 요율이 무엇인지 확인하세요.",
    "virtual_arrival": "감속해도 정박기간·체선 시간을 원래 도착 기준으로 계산하는 합의입니다. 선주의 체선료 수입이 보호되므로 감속 동의를 얻기 쉽습니다.",
    "utmost_despatch": "선박이 지체 없이 항해해야 하는 의무입니다. JIT·가상 도착 조항 같은 예외가 없으면 용선자 요청 없는 감속은 의무 위반 소지가 있습니다.",
    "notice_readiness": "도착 통지 시점이 정박기간 기산점을 정합니다. 정박지 도착 즉시 통지할 수 있으면 대기 시간이 체선료로 바뀝니다.",
    "demurrage_laytime": "체선료율과 허용 정박기간입니다. 정산 계산기의 체선료율 입력에 이 값을 쓰세요.",
    "fuel_sharing": "연료비 부담 주체 또는 절감분 배분입니다. 정산 계산기에서 누가 연료비를 내는지 정할 때 씁니다.",
}


def _segments(text: str) -> list[tuple[int, int]]:
    """빈 줄 또는 조항 번호로 나눈 구간의 (시작, 끝) 위치."""
    head = re.compile(r"^\s*(?:clause\s+\d+|\d+[.)]\s|제\s*\d+\s*조)", re.I | re.M)
    cuts = sorted({0, len(text), *(m.start() for m in head.finditer(text)), *(m.end() for m in re.finditer(r"\n\s*\n", text))})
    out = []
    for a, b in zip(cuts, cuts[1:]):
        seg = text[a:b]
        s = a + (len(seg) - len(seg.lstrip()))
        e = a + len(seg.rstrip())
        if e > s:
            out.append((s, e))
    return out


def assess(kinds: set[str]) -> str:
    if "jit_arrival" in kinds or "virtual_arrival" in kinds:
        base = "JIT 도착 또는 가상 도착 조항이 있어 권고 도착에 맞춘 감속을 계약 안에서 지시할 수 있습니다."
        if "demurrage_laytime" in kinds:
            base += " 늘어난 항해시간의 체선료 처리 방식을 정산 계산기에 넣어 선주·용선자 몫을 확인하세요."
        return base
    if "utmost_despatch" in kinds:
        return "JIT·가상 도착 조항 없이 신속 항해 의무만 있습니다. 감속을 요청하려면 별도 합의(가상 도착 또는 JIT 도착 조항 추가)가 먼저 필요합니다."
    return "JIT 운항과 직접 관련된 조항을 찾지 못했습니다. 본문 전체를 사람이 확인하세요."


def contract_rules(text: str) -> dict:
    clauses = []
    for s, e in _segments(text):
        seg = text[s:e]
        title = seg.splitlines()[0]
        # 조항 제목이 종류를 말하면 제목을 따르고, 아니면 본문에서 찾는다
        kind = next((k for k, pat in _PATTERNS if re.search(pat, title, re.I)), None) if "\n" in seg else None
        kind = kind or next((k for k, pat in _PATTERNS if re.search(pat, seg, re.I)), None)
        if kind:
            clauses.append({"kind": kind, "label": CLAUSE_KINDS[kind], "quote": seg, "start": s, "end": e,
                            "note": _NOTES[kind]})
    return {"clauses": clauses, "assessment": assess({c["kind"] for c in clauses})}


def locate(text: str, quote: str) -> tuple[int, int] | None:
    """LLM이 옮긴 인용을 본문에서 찾는다. 공백 차이만 허용한다."""
    i = text.find(quote)
    if i >= 0:
        return i, i + len(quote)
    words = [re.escape(w) for w in quote.split()]
    if not words:
        return None
    m = re.search(r"\s+".join(words), text)
    return (m.start(), m.end()) if m else None


# ---------------------------------------------------------------- 대기 순번 메일

def _norm_berth(s: str) -> str:
    s = s.lower()
    s = re.sub(r"berth|부두|선석|no\.?|#|\s|-|_", "", s)
    return s


def match_berth(name: str, berths: list[dict]) -> dict | None:
    n = _norm_berth(name)
    if not n:
        return None
    exact = [b for b in berths if _norm_berth(b["name"]) == n]
    return exact[0] if exact else None


_DT = re.compile(
    r"(?P<y>20\d\d)[-./](?P<m>\d{1,2})[-./](?P<d>\d{1,2})[ T]+(?P<H>\d{1,2}):?(?P<M>\d{2})"
    r"|(?P<a>\d{1,2})/(?P<b>\d{1,2})(?:/(?P<y2>20\d\d))?\s+(?P<H2>\d{1,2}):?(?P<M2>\d{2})"
    r"|(?P<mo>\d{1,2})월\s*(?P<da>\d{1,2})일\s*(?P<H3>\d{1,2})(?:시|:)\s*(?P<M3>\d{1,2})?"
)


def parse_times(line: str, ref: dt.datetime) -> list[tuple[int, dt.datetime]]:
    """줄에서 날짜·시각을 찾는다. 'a/b' 는 일/월과 월/일 가운데 기준 시각에 가까운 쪽으로 읽는다."""
    out = []
    for m in _DT.finditer(line):
        g = m.groupdict()
        try:
            if g["y"]:
                t = dt.datetime(int(g["y"]), int(g["m"]), int(g["d"]), int(g["H"]), int(g["M"]), tzinfo=KST)
            elif g["a"]:
                y = int(g["y2"] or ref.year)
                a, b = int(g["a"]), int(g["b"])
                cands = []
                for mo, da in ((b, a), (a, b)):
                    try:
                        cands.append(dt.datetime(y, mo, da, int(g["H2"]), int(g["M2"]), tzinfo=KST))
                    except ValueError:
                        pass
                if not cands:
                    continue
                t = min(cands, key=lambda c: abs((c - ref).total_seconds()))
            else:
                t = dt.datetime(ref.year, int(g["mo"]), int(g["da"]), int(g["H3"]), int(g["M3"] or 0), tzinfo=KST)
        except ValueError:
            continue
        out.append((m.start(), t))
    return out


_PREFIX = r"(?:M/?T|M/?V|LPG/?C|LNG/?C|MV|MT)\.?\s+"
_EN_SHIP = re.compile(rf"{_PREFIX}(?P<n>[A-Z0-9][A-Z0-9 .'&-]*?[A-Z0-9])(?=\s*(?:-|,|\(|$))")
_KO_SHIP = re.compile(r"(?:접안\s*중|대기\s*\d*\s*번?|도착\s*예정)\s*[:：]\s*(?P<n>[^,(\n]+?)\s*(?:,|\(|$)")
_ORDER = re.compile(r"(?:^\s*(?P<o>\d+)[.)]\s)|(?:대기\s*(?P<o2>\d+)\s*번)")
_CARGO = re.compile(r"(?P<q>\d{1,3}(?:,\d{3})+|\d+)\s*(?:MT|톤|tons?)\s*(?P<c>[A-Za-z가-힣]+)?|(?P<c2>[가-힣]+)\s+(?P<q2>\d{1,3}(?:,\d{3})+)\s*톤", re.I)


def _status(line: str) -> str | None:
    l = line.lower()
    if re.search(r"alongside|berthed|접안\s*중", l):
        return "berthed"
    if re.search(r"\beta\b|도착\s*예정|expected", l):
        return "inbound"
    if re.search(r"anchored|at anchorage|nor tendered|정박지\s*도착|투묘|대기\s*\d*\s*번", l):
        return "waiting"
    return None


def lineup_rules(text: str, port: str | None, berths: list[dict], ref: dt.datetime) -> dict:
    ships, cur_berth, counters = [], None, {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        st = _status(line)
        m = _EN_SHIP.search(line) or (_KO_SHIP.search(line) if st else None)
        if st is None or m is None:
            head = re.sub(r"^\s*\d+[.)]\s*", "", line)
            b = match_berth(head, berths)
            if b:
                cur_berth = b
            continue
        times = parse_times(line, ref)
        when = None
        if times:
            # 상태 단어 뒤에 나오는 첫 시각 (접안은 접안 시각, 대기는 도착 시각, 예정은 ETA)
            when = times[0][1]
        om = _ORDER.search(line)
        key = cur_berth["key"] if cur_berth else None
        counters[key] = counters.get(key, 0) + 1
        order = int(om.group("o") or om.group("o2")) if om else counters[key]
        cm = _CARGO.search(line)
        cargo = None
        if cm:
            q = cm.group("q") or cm.group("q2")
            c = cm.group("c") or cm.group("c2")
            cargo = f"{c} {q}톤" if c and not c.upper() in ("MT",) else f"{q}톤"
        ships.append({
            "berth": cur_berth["name"] if cur_berth else None, "berthKey": key, "order": order,
            "vessel": m.group("n").strip().title() if m.re is _EN_SHIP else m.group("n").strip(),
            "status": st, "time": when.isoformat(timespec="minutes") if when else None,
            "cargo": cargo, "line": line,
        })
    return {"port": port, "ships": ships}


def detect_port(text: str, ports: list[str]) -> str | None:
    alias = {"울산": ["ulsan"], "대산": ["daesan"], "광양": ["gwangyang", "kwangyang"], "여천": ["yeocheon", "yosu", "yeosu"]}
    low = text.lower()
    for p in ports:
        if p in text or any(a in low for a in alias.get(p, [])):
            return p
    return None


# ---------------------------------------------------------------- 권고 설명·문안

_DIGIT_BATCHIM = {"0": True, "1": True, "2": False, "3": True, "4": False, "5": False, "6": True, "7": True, "8": True, "9": False}


def josa(word: str, with_b: str, without_b: str) -> str:
    """받침 유무에 맞는 조사를 붙인다 (은/는, 이/가, 을/를, 과/와)."""
    ch = (word or " ").rstrip()[-1:] or " "
    if "가" <= ch <= "힣":
        has = (ord(ch) - 0xAC00) % 28 != 0
    elif ch in _DIGIT_BATCHIM:
        has = _DIGIT_BATCHIM[ch]
    else:
        has = ch.lower() in "lmnr"
    return word + (with_b if has else without_b)


def _fmt(t: str | None) -> str:
    if not t:
        return "-"
    x = dt.datetime.fromisoformat(t).astimezone(KST)
    return f"{x.month}월 {x.day}일 {x.hour:02d}:{x.minute:02d}"


def _fmt_en(t: str | None) -> str:
    if not t:
        return "-"
    x = dt.datetime.fromisoformat(t).astimezone(KST)
    return x.strftime("%d %b %H:%M")


def _plus(t: str, h: float) -> str:
    return (dt.datetime.fromisoformat(t) + dt.timedelta(hours=h)).isoformat(timespec="minutes")


def explain_template(d: dict) -> str:
    p, q = d["policy"], d["quantilesH"]
    cnt = {k: sum(1 for m in d.get("queue", []) if m.get("status") == k) for k in ("berthed", "waiting", "planned")}
    who = f"{d.get('vessel') or '대상 선박'}의 {d['berth']} 접안"
    s1 = (f"{who} 권고는 '{COND_LABEL.get(d['condition'], d['condition'])}' 조건에서 {_fmt(d['tau'])} 기준으로 계산했습니다. "
          f"앞 순번으로 접안 중 {cnt['berthed']}척, 정박지 대기 {cnt['waiting']}척, 도착 예정 {cnt['planned']}척을 넣었습니다.")
    if not d.get("busyAtTau"):
        if not d.get("queue"):
            return (f"{who} 권고는 '{COND_LABEL.get(d['condition'], d['condition'])}' 조건에서 {_fmt(d['tau'])} 기준으로 계산했습니다. "
                    "이 정보 조건에서는 선석을 쓰고 있거나 앞 순번으로 기다리는 배가 보이지 않아, 선석이 비어 있는 것으로 보고 "
                    f"원래 일정({_fmt(d['a0'])})대로 도착하라고 권합니다. 더 많은 정보를 공유하는 조건에서 앞 순번이 드러나면 권고가 달라질 수 있습니다.")
        return s1 + " 결정 시각에 선석이 비어 있어 원래 일정대로 도착하면 됩니다."
    med = _plus(d["tau"], q[len(q) // 2])
    lo, hi = _plus(d["tau"], q[1]), _plus(d["tau"], q[-2])
    s2 = (f" 선석이 비는 시각의 중앙값은 {_fmt(med)}이고, 차트의 10~90% 구간은 {_fmt(lo)}부터 {_fmt(hi)}까지입니다. "
          f"원래 도착 예정은 {_fmt(d['a0'])}입니다.")
    risk = float(d["risk"])
    if p["delayH"] < 0.05:
        s3 = (f" 위험 수준 {d['risk']}에서는 선석이 이미 비어 있을 확률이 {risk * 100:.0f}%인 시각이 원래 도착보다 이르거나 같아서, "
              "늦출 근거가 부족하므로 원래 일정을 유지합니다.")
        return s1 + s2 + s3
    capped = p["delayH"] >= d["maxDelayH"] - 0.05
    if capped:
        s3 = (f" 위험 수준 {d['risk']}의 목표 시각(선석이 이미 비어 있을 확률이 {risk * 100:.0f}%인 시각)이 남은 항해에서 감속으로 늦출 수 있는 "
              f"최대 {d['maxDelayH']:.1f}시간보다 뒤여서, 권고 도착은 최대 늦춤인 {_fmt(p['rta'])}, 권고 속도 {p['speedKn']:.1f}노트"
              f"(설계 {d['designSpeedKn']:.1f}노트)입니다. 도착한 뒤에도 정박지 대기가 남을 수 있습니다.")
    else:
        s3 = (f" 위험 수준 {d['risk']}은 선석이 이미 비어 있을 확률이 {risk * 100:.0f}%인 시각에 맞춰 도착한다는 뜻이며, "
              f"그래서 권고 도착은 {_fmt(p['rta'])}, {p['delayH']:.1f}시간 늦춤, 권고 속도 {p['speedKn']:.1f}노트(설계 {d['designSpeedKn']:.1f}노트)입니다. "
              f"늦춤은 감속으로 흡수할 수 있는 최대 {d['maxDelayH']:.1f}시간 안에 있습니다.")
    s4 = f" 정박지에서 기다릴 시간을 감속 항해로 바꿔 연료 {p['fuelT']:.1f}t, CO2 {p['co2T']:.1f}t을 줄입니다."
    return s1 + s2 + s3 + s4


def draft_template(d: dict, kind: str) -> dict:
    p = d["policy"]
    v, b = d.get("vessel") or "본선", d["berth"]
    if kind == "master":
        ko = (f"선장님께\n\n{v}의 {d['port']} {b} 접안 대기를 줄이기 위해 도착 시각을 조정해 주십시오.\n"
              f"- 권고 도착: {_fmt(p['rta'])} (원래 {_fmt(d['a0'])}, {p['delayH']:.1f}시간 늦춤)\n"
              f"- 권고 속도: {p['speedKn']:.1f}노트\n"
              f"- 근거: 선석 가용 시각 예측 분포 (K-JIT, {COND_LABEL.get(d['condition'])}, 위험 수준 {d['risk']})\n"
              "안전 운항 범위를 벗어나거나 기상으로 속도 유지가 어려우면 즉시 회신 바랍니다.\n\n운항팀")
        en = (f"To the Master,\n\nPlease adjust the arrival of {v} to reduce anchorage waiting at {b}, {d['port']}.\n"
              f"- Required time of arrival: {_fmt_en(p['rta'])} KST (originally {_fmt_en(d['a0'])}, +{p['delayH']:.1f} h)\n"
              f"- Recommended speed: {p['speedKn']:.1f} kn\n"
              f"- Basis: berth availability forecast (K-JIT, risk level {d['risk']})\n"
              "Advise immediately if this is outside safe operating limits or cannot be maintained due to weather.\n\nOperations")
    else:
        ko = (f"용선자 귀중\n\n{v}의 {d['port']} {b} 도착과 관련하여, 선석 혼잡으로 정박지 대기가 예상되어 JIT 도착 조항에 따른 도착 시각 지정을 요청드립니다.\n"
              f"- 제안 도착 시각(RTA): {_fmt(p['rta'])} (원래 예정 {_fmt(d['a0'])})\n"
              f"- 늘어나는 항해시간: {p['delayH']:.1f}시간, 권고 속도 {p['speedKn']:.1f}노트\n"
              f"- 예상 절감: 연료 {p['fuelT']:.1f}t, CO2 {p['co2T']:.1f}t\n"
              "늘어난 항해시간의 정박기간·체선료 처리는 계약 조항에 따르며, 동의하시면 본선에 지시하겠습니다.\n\n선주 운항팀")
        en = (f"Dear Charterers,\n\nBerth congestion is expected at {b}, {d['port']}. We propose that you nominate a Required Time of Arrival "
              f"for {v} under the Just in Time arrival provisions of the charter party.\n"
              f"- Proposed RTA: {_fmt_en(p['rta'])} KST (original ETA {_fmt_en(d['a0'])})\n"
              f"- Additional sailing time: {p['delayH']:.1f} h at {p['speedKn']:.1f} kn\n"
              f"- Estimated saving: {p['fuelT']:.1f} t fuel, {p['co2T']:.1f} t CO2\n"
              "Laytime and demurrage for the additional sailing time shall be treated as per the charter party. "
              "Please confirm and we will instruct the Master accordingly.\n\nOwners' operations")
    return {"ko": ko, "en": en}


# ---------------------------------------------------------------- 질의응답 (규칙)

def parse_when(q: str, now: dt.datetime) -> dt.datetime | None:
    day = now.date()
    if "모레" in q:
        day = day + dt.timedelta(days=2)
    elif "내일" in q:
        day = day + dt.timedelta(days=1)
    t = parse_times(q, now)
    if t:
        return t[0][1]
    m = re.search(r"(오전|오후|밤|새벽)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분|\s*반)?", q)
    if not m:
        return None
    h = int(m.group(2)) % 24
    if m.group(1) in ("오후", "밤") and h < 12:
        h += 12
    mi = int(m.group(3)) if m.group(3) else (30 if "반" in m.group(0) else 0)
    return dt.datetime.combine(day, dt.time(h, mi), tzinfo=KST)


def find_berth(q: str, ports: dict[str, list[dict]]) -> tuple[str, dict] | tuple[None, None]:
    nq = _norm_berth(q)
    best = None
    for port, bs in ports.items():
        for b in bs:
            n = _norm_berth(b["name"])
            if n and n in nq and (best is None or len(n) > len(_norm_berth(best[1]["name"]))):
                best = (port, b)
    return best if best else (None, None)


GROUP_WORDS = [("탱커·가스", r"탱커|유조선|가스|케미칼|lpg|lng"), ("벌크", r"벌크|석탄|광석"), ("컨테이너", r"컨테이너"),
               ("자동차운반", r"자동차"), ("일반화물", r"일반\s*화물|잡화")]


def guess_group(q: str) -> str | None:
    for g, pat in GROUP_WORDS:
        if re.search(pat, q, re.I):
            return g
    return None


# ---------------------------------------------------------------- 수치 근거 검사

_NUM = re.compile(r"(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.])\d+(?:\.\d+)?")


def _numbers_in(obj: Any, out: set[float]) -> None:
    if isinstance(obj, bool) or obj is None:
        return
    if isinstance(obj, (int, float)):
        out.add(round(float(obj), 3))
    elif isinstance(obj, str):
        for m in _NUM.finditer(obj):
            out.add(round(float(m.group().replace(",", "")), 3))
    elif isinstance(obj, dict):
        for v in obj.values():
            _numbers_in(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _numbers_in(v, out)


def ungrounded_numbers(answer: str, sources: list[Any]) -> list[str]:
    """답변의 수치 가운데 근거(도구 결과·입력)에서 찾을 수 없는 것. 반올림·백분율 표기는 허용한다."""
    have: set[float] = set()
    for s in sources:
        _numbers_in(s if not isinstance(s, str) else s, have)
        if isinstance(s, (dict, list)):
            _numbers_in(json.dumps(s, ensure_ascii=False), have)
    ok_forms = set()
    for x in have:
        for v in (x, x * 100, x / 100):
            for nd in (0, 1, 2):
                ok_forms.add(round(v, nd))
    bad = []
    for m in _NUM.finditer(answer):
        v = float(m.group().replace(",", ""))
        if v <= 12 and v == int(v):  # 순번·척수·월 같은 작은 정수
            continue
        if any(abs(v - round(v, nd)) < 1e-9 and round(v, nd) in ok_forms for nd in (0, 1, 2)):
            continue
        bad.append(m.group())
    return bad
