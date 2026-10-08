"""울산항만공사 항내 선박위치정보를 주기적으로 받아 JSONL로 쌓는다 (A 대기 추정 검증용).

한 번 호출에 항내 선박 전체(약 600척)가 오므로 회차당 1회 호출이다.
AIS 운항상태(nvgtStts)는 자기 신고라 비어 있거나 틀린 경우가 많아, 분석 때는 위치·속도로
정박지와 선석을 판정한다. 갱신 시각(updtTm)이 오래된 선박도 그대로 저장하고 분석 때 거른다.

    nohup uv run python -m kjit.ulsan_positions --every 5 > data/ulsan_positions.log 2>&1 &
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from kjit.fetch_calls import load_key

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "raw" / "ulsan_pos"
ENDPOINT = "https://apis.data.go.kr/B551938/VslPstnInfoService/getVslPstnInfo"
FIELDS = ["callsgn", "ptentYr", "vyg", "mmsiNo", "imoNo", "vslNm", "lot", "lat", "sog", "cog", "hdgAng", "drft", "nvgtStts", "updtTm"]
KST = dt.timezone(dt.timedelta(hours=9))


def poll(key: str) -> tuple[str, list[dict]]:
    q = urllib.parse.urlencode({"serviceKey": key, "pageNo": 1, "numOfRows": 1000})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(f"{ENDPOINT}?{q}", timeout=60) as r:
                root = ET.fromstring(r.read())
            if root.findtext(".//resultCode") != "00":
                raise RuntimeError(root.findtext(".//resultMsg"))
            break
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)
    now = dt.datetime.now(KST).strftime("%Y%m%d%H%M%S")
    rows = [{"fetched": now, **{f: it.findtext(f) for f in FIELDS}} for it in root.iter("item")]
    return now, rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--every", type=int, default=5, help="분 단위 주기")
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()
    key = load_key()
    OUT.mkdir(parents=True, exist_ok=True)
    last: dict[str, str] = {}  # 선박별 마지막으로 저장한 갱신 시각 (바뀐 것만 저장)
    while True:
        try:
            now, rows = poll(key)
            new = [r for r in rows if last.get(r["callsgn"] or r["mmsiNo"]) != r["updtTm"]]
            with (OUT / f"{now[:8]}.jsonl").open("a", encoding="utf-8") as f:
                for r in new:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
                    last[r["callsgn"] or r["mmsiNo"]] = r["updtTm"]
            print(f"{now} {len(rows)}척 중 갱신 {len(new)}척 저장", flush=True)
        except Exception as e:  # 한 회차 실패로 수집을 멈추지 않는다
            print(f"{dt.datetime.now(KST):%Y%m%d%H%M%S} 실패: {e}", flush=True)
        if args.once:
            break
        time.sleep(args.every * 60)


if __name__ == "__main__":
    main()
