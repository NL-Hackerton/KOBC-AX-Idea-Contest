"""data/raw/vssl 의 원문 XML을 항차 단위 표(data/processed/calls.parquet)로 바꾼다.

한 항차(item)에는 입항·출항 신고(detail)가 최대 한 건씩 들어 있다.
입항 신고의 계선시설은 처음 들어간 자리, 출항 신고의 계선시설은 떠난 자리이다.

    uv run python -m kjit.parse_calls
"""

from __future__ import annotations

import glob
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "vssl"
OUT = ROOT / "data" / "processed" / "calls.parquet"

ITEM_FIELDS = [
    "prtAgCd", "prtAgNm", "etryptYear", "etryptCo", "clsgn", "vsslNm",
    "vsslNltyCd", "vsslKndCd", "vsslKndNm", "etryptPurpsNm",
    "prvsDpmprtNatPrtCd", "prvsDpmprtPrtNm", "nxlnptNatPrtCd", "nxlnptPrtNm",
]
DETAIL_FIELDS = [
    "reqstSeNm", "ibobprtNm", "laidupFcltyCd", "laidupFcltySubCd", "laidupFcltyNm",
    "tugYn", "piltgYn", "ldadngFrghtClCd", "ldadngTon", "grtg", "intrlGrtg",
    "satmntEntrpsNm", "crewCo", "frgnrCrewCo",
]


def parse_item(it: ET.Element) -> dict:
    row = {f: it.findtext(f) for f in ITEM_FIELDS}
    for d in it.findall("./details/detail"):
        kind = d.findtext("etryndNm")
        prefix = {"입항": "in_", "출항": "out_"}.get(kind)
        if prefix is None:
            continue
        for f in DETAIL_FIELDS:
            row[prefix + f] = d.findtext(f)
        if kind == "입항":
            row["in_time"] = d.findtext("etryptDt")
            row["in_planned_out"] = d.findtext("tkoffPrrrnDt")  # 입항 시 신고한 출항 예정
        else:
            row["out_time"] = d.findtext("tkoffDt")
            row["out_next_eta"] = d.findtext("dstnEtryptDt")  # 출항 시 신고한 목적지 도착 예정
    return row


def main() -> None:
    rows = []
    for f in sorted(glob.glob(str(RAW / "*" / "*.xml"))):
        for it in ET.parse(f).getroot().iter("item"):
            rows.append(parse_item(it))
    df = pd.DataFrame(rows)
    df = df.drop_duplicates(subset=["prtAgCd", "etryptYear", "etryptCo", "clsgn"], keep="last")

    for c in ["in_time", "out_time"]:
        df[c] = pd.to_datetime(df[c], utc=True, errors="coerce").dt.tz_convert("Asia/Seoul")
    for c in ["in_planned_out", "out_next_eta"]:
        df[c] = pd.to_datetime(df[c], errors="coerce").dt.tz_localize("Asia/Seoul", ambiguous="NaT", nonexistent="NaT")
    for c in ["in_grtg", "in_intrlGrtg", "in_ldadngTon", "in_crewCo", "in_frgnrCrewCo"]:
        if c in df:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT, index=False)
    print(f"{len(df):,}개 항차 → {OUT.relative_to(ROOT)}")
    print(df.groupby("prtAgNm").size().sort_values(ascending=False).to_string())


if __name__ == "__main__":
    main()
