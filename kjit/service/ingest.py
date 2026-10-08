"""수집 작업: 해수부 입출항 신고(30분)와 울산항 선박 위치(5분)를 운영 DB에 쌓는다.

입출항 신고는 지난 LOOKBACK_DAYS 일부터 앞으로 AHEAD_DAYS 일까지의 입항분을 받는다.
미래 날짜에는 최초·변경 신고(입항 예정과 목적 계선시설)가 들어 있다.

    uv run python -m kjit.service.ingest --once     # 한 번 수집
"""

from __future__ import annotations

import argparse
import datetime as dt
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from kjit.fetch_calls import ENDPOINT as CALLS_ENDPOINT
from kjit.fetch_calls import PAGE_SIZE
from kjit.parse_calls import parse_item
from kjit.service import config, db

KST = dt.timezone(dt.timedelta(hours=9))
PORTS = {"300": "대산", "820": "울산", "622": "광양", "621": "여천"}
LOOKBACK_DAYS = 14
AHEAD_DAYS = 5
POS_ENDPOINT = "https://apis.data.go.kr/B551938/VslPstnInfoService/getVslPstnInfo"
POS_FIELDS = ["callsgn", "ptentYr", "vyg", "mmsiNo", "imoNo", "vslNm", "lot", "lat", "sog", "cog", "hdgAng", "drft",
              "nvgtStts", "updtTm"]


def _get(url: str, params: dict, retries: int = 4) -> ET.Element:
    q = urllib.parse.urlencode({"serviceKey": config.DATA_GO_KR_KEY, **params})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(f"{url}?{q}", timeout=60) as r:
                root = ET.fromstring(r.read())
            if root.findtext(".//resultCode") != "00":
                raise RuntimeError(root.findtext(".//resultMsg") or "resultCode != 00")
            return root
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
    raise AssertionError


def ingest_calls(now: dt.datetime | None = None) -> int:
    now = now or dt.datetime.now(KST)
    sde = (now - dt.timedelta(days=LOOKBACK_DAYS)).strftime("%Y%m%d")
    ede = (now + dt.timedelta(days=AHEAD_DAYS)).strftime("%Y%m%d")
    stamp = now.isoformat(timespec="seconds")
    changed = 0
    with db.session() as con:
        for port in PORTS:
            try:
                first = _get(CALLS_ENDPOINT, {"pageNo": 1, "numOfRows": PAGE_SIZE, "prtAgCd": port, "sde": sde, "ede": ede})
                items = list(first.iter("item"))
                total = int(first.findtext(".//totalCount") or 0)
                for p in range(2, -(-total // PAGE_SIZE) + 1):
                    items += list(_get(CALLS_ENDPOINT, {"pageNo": p, "numOfRows": PAGE_SIZE, "prtAgCd": port,
                                                        "sde": sde, "ede": ede}).iter("item"))
                n = db.upsert_calls(con, [parse_item(it) for it in items], stamp)
                changed += n
                db.log(con, f"calls:{port}", stamp, True, n, f"{len(items)} items")
            except Exception as e:  # 한 항만 실패가 다른 항만 수집을 막지 않는다
                db.log(con, f"calls:{port}", stamp, False, 0, str(e))
            # 항만마다 커밋한다. 다음 항만을 받는 동안 쓰기 잠금을 쥐고 있으면 결정·에이전트 기록이 막힌다
            con.commit()
    return changed


def ingest_positions(now: dt.datetime | None = None) -> int:
    now = now or dt.datetime.now(KST)
    stamp = now.strftime("%Y%m%d%H%M%S")
    try:
        root = _get(POS_ENDPOINT, {"pageNo": 1, "numOfRows": 1000})
        rows = [{"fetched": stamp, **{f: it.findtext(f) for f in POS_FIELDS}} for it in root.iter("item")]
    except Exception as e:
        with db.session() as con:
            db.log(con, "positions", now.isoformat(timespec="seconds"), False, 0, str(e))
        return 0
    with db.session() as con:
        n = db.insert_positions(con, rows)
        db.log(con, "positions", now.isoformat(timespec="seconds"), True, n, f"{len(rows)} ships")
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()
    if args.once:
        print("calls changed:", ingest_calls())
        print("positions new:", ingest_positions())


if __name__ == "__main__":
    main()
