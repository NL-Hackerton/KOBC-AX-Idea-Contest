"""입출항 신고를 주기적으로 찍어 두어, 최종 신고로 덮어쓰기 전의 값을 보존한다.

선박운항정보 API는 최종 신고본만 돌려주므로 입항 때 신고한 출항 예정 시각이 나중에
실제 출항 시각으로 바뀐다(1년치에서 42~69%가 실제 출항과 정확히 일치). 사전 정보만으로
예측을 평가하려면 신고 직후의 값을 따로 모아야 한다.

매 회차마다 최근 LOOKBACK_DAYS 일 입항분을 받아 data/raw/snap/{회차시각}/{항만}_p{쪽}.xml 로 저장한다.

    nohup uv run python -m kjit.snapshot --every 120 > data/snapshot.log 2>&1 &
"""

from __future__ import annotations

import argparse
import datetime as dt
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from kjit.fetch_calls import ENDPOINT, PAGE_SIZE, load_key

ROOT = Path(__file__).resolve().parents[1]
SNAP = ROOT / "data" / "raw" / "snap"
PORTS = ["300", "820", "622", "621"]  # 대산, 울산, 광양, 여천
LOOKBACK_DAYS = 7
KST = dt.timezone(dt.timedelta(hours=9))


def get(key: str, port: str, sde: str, ede: str, page: int) -> bytes:
    q = urllib.parse.urlencode({
        "serviceKey": key, "pageNo": page, "numOfRows": PAGE_SIZE,
        "prtAgCd": port, "sde": sde, "ede": ede,
    })
    for attempt in range(5):
        try:
            with urllib.request.urlopen(f"{ENDPOINT}?{q}", timeout=60) as r:
                body = r.read()
            if ET.fromstring(body).findtext(".//resultCode") == "00":
                return body
            raise RuntimeError("resultCode != 00")
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)
    raise AssertionError


def take(key: str) -> tuple[str, int]:
    now = dt.datetime.now(KST)
    stamp = now.strftime("%Y%m%d%H%M")
    sde = (now - dt.timedelta(days=LOOKBACK_DAYS)).strftime("%Y%m%d")
    ede = now.strftime("%Y%m%d")
    out = SNAP / stamp
    out.mkdir(parents=True, exist_ok=True)
    n = 0
    for port in PORTS:
        first = get(key, port, sde, ede, 1)
        (out / f"{port}_p1.xml").write_bytes(first)
        total = int(ET.fromstring(first).findtext(".//totalCount") or 0)
        for p in range(2, -(-total // PAGE_SIZE) + 1):
            (out / f"{port}_p{p}.xml").write_bytes(get(key, port, sde, ede, p))
        n += total
    return stamp, n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--every", type=int, default=120, help="분 단위 주기")
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()
    key = load_key()
    while True:
        try:
            stamp, n = take(key)
            print(f"{stamp} 항차 {n}건 저장", flush=True)
        except Exception as e:  # 한 회차 실패로 수집을 멈추지 않는다
            print(f"{dt.datetime.now(KST):%Y%m%d%H%M} 실패: {e}", flush=True)
        if args.once:
            break
        time.sleep(args.every * 60)


if __name__ == "__main__":
    main()
