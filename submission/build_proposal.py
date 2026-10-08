# /// script
# requires-python = ">=3.11"
# dependencies = ["python-hwpx==6.8.0", "lxml"]
# ///
"""공고 양식 HWPX에 아이디어 기획서([붙임2])를 채운다.

    uv run submission/build_proposal.py

- 입력: notice/참가신청서-기획서-양식.hwpx (공고 양식), docs/기획서-초안.md (2절 본문)
- 출력: submission/참가신청서-기획서.hwpx

참가신청서와 개인정보 동의서는 양식 그대로 둔다. 참가자 성명, 대표 Track, 서명·날짜,
신청자 개인정보는 비워 두고 신청자가 한글에서 직접 적는다.
"""

from __future__ import annotations

import re
import warnings
from pathlib import Path

from lxml import etree

from hwpx.document import HwpxDocument

warnings.simplefilter("ignore", DeprecationWarning)

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "notice" / "참가신청서-기획서-양식.hwpx"
PLAN_MD = ROOT / "docs" / "기획서-초안.md"
OUT = ROOT / "submission" / "참가신청서-기획서.hwpx"

HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"
HH = "http://www.hancom.co.kr/hwpml/2011/head"

TITLE = "K-JIT: 선석 가용 확률 예측 기반 적시 입항(JIT) 코파일럿"
KEYWORDS = "예측/최적화, 탄소 규제(CII) 대응, 계약 정산 자동화"

# 1절은 A4 1매 이내라서 초안 1절을 줄여 쓴다.
OVERVIEW = {
    "1.1": [
        "국내 벌크·탱커 항만에서 선석이 언제 비는지를 확률로 예측하고, 그 분포로 중소선사에 감속 도착 시각과 속도를 권고하는 AI 코파일럿이다.",
        "정박지에서 기다리며 버리는 연료와 CO2를 줄이되 선석 유휴는 늘리지 않는다. 공개 데이터와 선박대리점 대기 순번만으로 시작하고, 항만이 선석계획을 공유하면 효과가 커진다.",
    ],
    "1.2": [
        "- 정박지 대기 낭비: 해수부 입출항 신고 1년치(129,831항차) 분석 결과, 대산·울산·광양에서 정박지를 거친 항차의 약 절반이 12시간 넘게 선석을 기다렸다.",
        "- 탄소 규제: IMO CII 감축률이 2027년 13.625%에서 2030년 21.500%로 강화된다. 정박 대기 연료도 CII에 그대로 잡힌다.",
        "- 국내 공백: 항만 앞 20해리 저속운항제만 있고, 접근 항해 전체에서 도착 시각을 맞추는 JIT 체계는 없다(싱가포르는 2023년부터 시행).",
    ],
    "1.3": [
        "- 활용 장면: 중소 탱커선사 운항 담당자가 도착 72시간 전 선석 가용 시각 분포(P10/P50/P90)를 보고, 위험 수준을 골라 권고 도착 시각·속도, 절감 연료·CO2, 체선료 정산 영향과 선장 지시문 초안을 받는다.",
        "- AI: 분위수 gradient boosting + conformal 보정으로 선석 체류 분포 예측, 대기열 몬테카를로로 가용 시각 분포 생성, 위험 고려 최적화로 도착 시각 결정. LLM 에이전트가 대리점 메일·용선계약을 구조화하고 근거를 설명한다.",
        "- 데이터: 해수부 선박운항정보·항만시설사용정보, 울산항만공사 항내 선박위치 등 공개 API.",
    ],
    "1.4": [
        "- 정량: 시험 구간(2026-08~09, 4개 항만 1,253항차) 백테스트에서 공개 데이터와 대기 순번만으로 연료 412~983t, 선석계획 공유 시 1,923t 절감. 추가 선석 유휴는 합계 27~64시간.",
        "- 정성: 중소선사 CII 관리 부담 감소, 선주·용선자 감속 합의 지원, 정박지 혼잡·항만 대기오염 감소.",
    ],
}
OVERVIEW_ROW = {"1.1": 6, "1.2": 7, "1.3": 8, "1.4": 9}

SECTIONS = [
    "2.1 문제 정의 / 적용 대상",
    "2.2 접근 방식 / 핵심 아이디어",
    "2.3 활용 시나리오 및 화면 구성",
    "2.4 AI/데이터 활용 및 구현 구조",
    "2.5 실행 계획",
    "2.6 기대효과 및 성과 지표",
    "2.7 리스크 및 대응 방안",
]

BODY_WIDTH = 47600  # 본문 폭(59528 - 좌우 여백 5669×2 = 48190)보다 조금 좁게


def parse_plan(md: str) -> dict[str, list[tuple]]:
    """초안의 2.1~2.7 절을 블록 목록으로 나눈다."""
    sections: dict[str, list[tuple]] = {}
    current = None
    lines = md.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        m = re.match(r"### (2\.\d)", line)
        if m:
            current = sections.setdefault(m.group(1), [])
            i += 1
            continue
        if line.startswith(("## ", "---")) and not line.startswith("### "):
            current = None
            i += 1
            continue
        if current is None or not line.strip():
            i += 1
            continue
        if line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-+:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            current.append(("table", rows))
            continue
        if m := re.fullmatch(r"!\[(.*?)\]\((.*?)\)", line):
            current.append(("image", m.group(2)))
        elif m := re.fullmatch(r'<p align="center">(.*)</p>', line):
            current.append(("caption", m.group(1)))
        elif line.startswith("- "):
            current.append(("bullet", line[2:]))
        elif re.match(r"\s+- ", line):  # 들여쓴 하위 목록
            current.append(("num", "   – " + line.strip()[2:]))
        elif re.match(r"\d+\. ", line):
            current.append(("num", line))
        else:
            current.append(("p", line))
        i += 1
    return sections


def runs_of(text: str) -> list[tuple[str, bool]]:
    text = text.replace("`", "").replace("\\~", "~")
    out = []
    for part in re.split(r"(\*\*.+?\*\*)", text):
        if part:
            out.append((part[2:-2], True) if part.startswith("**") and part.endswith("**") else (part, False))
    return out


PICTURE_WIDTH_MM = 150


def new_picture(doc: HwpxDocument, path: Path):
    """PNG를 본문 폭에 맞춰 가운데 정렬로 넣고, 그 그림이 든 문단을 돌려준다."""
    import struct

    data = path.read_bytes()
    w, h = struct.unpack(">II", data[16:24])  # PNG IHDR
    obj = doc.add_picture(data, "png", section=doc.sections[0], width_mm=PICTURE_WIDTH_MM,
                          height_mm=PICTURE_WIDTH_MM * h / w, align="CENTER")
    return next(a for a in obj.element.iterancestors() if a.tag == f"{{{HP}}}p")


def strip_cache(el) -> None:
    for p in el.iter(f"{{{HP}}}p"):
        for lsa in p.findall(f"{{{HP}}}linesegarray"):
            p.remove(lsa)


class Styles:
    def __init__(self, doc: HwpxDocument):
        h = doc.headers[0]

        def char(size: float, bold: bool = False, color: str = "#000000") -> str:
            def modify(el):
                el.set("height", str(int(size * 100)))
                el.set("textColor", color)
                for b in el.findall(f"{{{HH}}}bold"):
                    el.remove(b)
                if bold:
                    b = etree.Element(f"{{{HH}}}bold")
                    el.find(f"{{{HH}}}underline").addprevious(b)

            def same(el):
                return (el.get("height") == str(int(size * 100)) and el.get("textColor") == color
                        and (el.find(f"{{{HH}}}bold") is not None) == bold
                        and el.find(f"{{{HH}}}fontRef").get("hangul") == font)

            return h.ensure_char_property(predicate=same, modifier=modify, base_char_pr_id=48).get("id")

        font = h.element.find(f".//{{{HH}}}charPr[@id='48']").find(f"{{{HH}}}fontRef").get("hangul")
        self.body, self.body_b = char(10), char(10, True)
        self.cell, self.cell_b = char(9), char(9, True)
        self.cap = char(9, color="#404040")
        self.ov, self.ov_b = char(9.5), char(9.5, True)

        def para(align, spacing, prev=0, nxt=0, left=0, indent=0, keep=False):
            return h.ensure_paragraph_format(
                base_para_pr_id=19, alignment=align, line_spacing_percent=spacing,
                margins={"intent": indent, "left": left, "right": 0, "prev": prev, "next": nxt},
                break_setting={"keepWithNext": keep, "widowOrphan": True})

        self.p_body = para("JUSTIFY", 150, nxt=300)
        self.p_bullet = para("JUSTIFY", 150, nxt=150, left=1100, indent=-1100)
        self.p_caption = para("CENTER", 130, prev=100, nxt=400)
        self.p_cell = para("LEFT", 130)
        self.p_cell_c = para("CENTER", 130)
        self.p_ov = para("JUSTIFY", 140, nxt=100, left=500, indent=-500)


def new_paragraph(doc, st, para_pr, runs, normal, bold):
    p = doc.add_paragraph("", para_pr_id_ref=para_pr, include_run=False)
    for text, b in runs:
        p.add_run(text, char_pr_id_ref=bold if b else normal)
    return p


def column_weights(rows):
    lengths = [max(len(re.sub(r"\*\*|`", "", r[c])) for r in rows) for c in range(len(rows[0]))]
    if len(lengths) == 2:
        first = min(max(lengths[0], 6), 24)
        return [first, 100 - first]
    return [min(max(n, 5), 60) for n in lengths]


def new_table(doc, st, rows):
    tbl = doc.add_table(len(rows), len(rows[0]), width=BODY_WIDTH, border_fill_id_ref=3)
    tbl.set_column_widths(column_weights(rows))
    for r, row in enumerate(rows):
        for c, text in enumerate(row):
            tc = tbl.cell(r, c)
            old = list(tc.paragraphs)
            p = tc.add_paragraph(para_pr_id_ref=st.p_cell_c if r == 0 else st.p_cell)
            for t, b in runs_of(text):
                p.add_run(t, char_pr_id_ref=st.cell_b if (b or r == 0) else st.cell)
            for o in old:
                o.remove()
            if r == 0:
                tbl.set_cell_shading(r, c, "#E7E6E6")
    tbl.element.set("pageBreak", "CELL")
    tbl.element.set("repeatHeader", "1")
    return tbl


def build() -> Path:
    doc = HwpxDocument.open(TEMPLATE)
    st = Styles(doc)
    sections = parse_plan(PLAN_MD.read_text(encoding="utf-8"))

    # 붙임2 머리 표와 1절
    paragraphs = doc.paragraphs
    form = next(t for p in paragraphs for t in p.tables if t.row_count == 10)
    for row, lines in [(2, [TITLE]), (4, [KEYWORDS])]:
        tc = form.cell(row, 2)
        old = list(tc.paragraphs)
        for line in lines:
            tc.add_paragraph(line, para_pr_id_ref=st.p_cell, char_pr_id_ref=st.body_b if row == 2 else st.body)
        for o in old:
            o.remove()
    for key, row in OVERVIEW_ROW.items():
        tc = form.cell(row, 1)
        old = list(tc.paragraphs)
        for line in OVERVIEW[key]:
            p = tc.add_paragraph(para_pr_id_ref=st.p_ov)
            label, sep, rest = line.partition(": ")
            if sep and line.startswith("- "):
                p.add_run(label + sep, char_pr_id_ref=st.ov_b)
                p.add_run(rest, char_pr_id_ref=st.ov)
            else:
                p.add_run(line, char_pr_id_ref=st.ov)
        for o in old:
            o.remove()

    # 2절: 각 제목 아래의 회색 안내 상자 문단을 지우고 본문을 넣는다
    body = doc.sections[0].element
    for title in SECTIONS:
        heading = next(p for p in body.findall(f"{{{HP}}}p") if "".join(p.itertext()).strip() == title)
        guide = heading.getnext()
        if guide is not None and guide.find(f".//{{{HP}}}rect") is not None:
            body.remove(guide)
        anchor = heading
        for kind, value in sections[title[:3]]:
            if kind == "table":
                el = new_table(doc, st, value).element
                el = next(a for a in el.iterancestors() if a.tag == f"{{{HP}}}p")
            elif kind == "image":
                el = new_picture(doc, ROOT / "docs" / value)
            elif kind == "caption":
                el = new_paragraph(doc, st, st.p_caption, runs_of(re.sub(r"<[^>]+>", "", value)), st.cap, st.cap).element
            elif kind == "bullet":
                el = new_paragraph(doc, st, st.p_bullet, runs_of("• " + value), st.body, st.body_b).element
            elif kind == "num":
                el = new_paragraph(doc, st, st.p_bullet, runs_of(value), st.body, st.body_b).element
            else:
                el = new_paragraph(doc, st, st.p_body, runs_of(value), st.body, st.body_b).element
            anchor.addnext(el)
            anchor = el

    # 작성 시 유의사항 안내문은 지운다
    ps = body.findall(f"{{{HP}}}p")
    start = next(i for i, p in enumerate(ps) if "".join(p.itertext()).strip() == "※ 아이디어 기획서 작성 시 유의사항")
    end = next(i for i, p in enumerate(ps) if "".join(p.itertext()).strip() == "※ 선택 제출자료 안내사항")
    for p in ps[start:end]:
        body.remove(p)

    # 선택 제출자료 안내사항
    opt = next(t for p in doc.paragraphs for t in p.tables if t.row_count == 4 and t.cell(0, 0).text.strip() == "구분")
    # 체크박스는 "□ " 런 다음에 항목 이름 런이 오는 구조이다
    checks = {1: ("HTML/웹페이지", "데모 영상"), 2: ("파일 첨부", "URL 제출")}
    for row, labels in checks.items():
        ts = [t for t in opt.cell(row, 1).element.iter(f"{{{HP}}}t")]
        for box, label in zip(ts, ts[1:]):
            if label.text and label.text.strip() in labels and box.text and "□" in box.text:
                box.text = box.text.replace("□", "■")
    tc = opt.cell(3, 1)
    old = list(tc.paragraphs)
    for line in ["- 웹 앱 URL: https://nl-hackerton.github.io/KOBC-AX-Idea-Contest/ (저장소: https://github.com/NL-Hackerton/KOBC-AX-Idea-Contest)",
                 "- 파일: k-jit.html (서버 연결 없이 열리는 단일 HTML 저장본), k-jit-demo.mp4 (시연 영상)",
                 "※ 로그인, 별도 설치, 권한 승인 없이 확인 가능"]:
        tc.add_paragraph(line, para_pr_id_ref=st.p_cell, char_pr_id_ref=st.body)
    for o in old:
        o.remove()

    # 대표 Track: 해운 AX (2026-10-08 확정). 양식의 "□ 해운 AX" 표시를 채운다
    ts = list(body.iter(f"{{{HP}}}t"))
    for t, nxt in zip(ts, ts[1:] + [None]):
        if t.text and "□ 해운 AX" in t.text:
            t.text = t.text.replace("□ 해운 AX", "■ 해운 AX")
        elif t.text and t.text.strip() == "□" and nxt is not None and (nxt.text or "").strip() == "해운 AX":
            t.text = t.text.replace("□", "■")

    strip_cache(body)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save_to_path(OUT)
    return OUT


if __name__ == "__main__":
    out = build()
    print(out.relative_to(ROOT))
    print(HwpxDocument.open(out).validate())
