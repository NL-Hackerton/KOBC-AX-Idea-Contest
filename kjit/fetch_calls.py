"""해양수산부 선박운항정보(VsslEtrynd5) 입출항 신고 기록을 항만·월 단위로 내려받는다.

원문 XML을 data/raw/vssl/{항만코드}/{YYYYMM}_p{쪽}.xml 로 그대로 보관하고,
이미 받은 쪽은 다시 요청하지 않는다. 인증키는 .env 의 DATA_GO_KR_KEY 를 쓴다.

    uv run python -m kjit.fetch_calls --start 2025-10 --end 2026-09 --ports 820 622
"""

from __future__ import annotations

import argparse
import calendar
import concurrent.futures as cf
import os
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "vssl"
ENDPOINT = "https://apis.data.go.kr/1192000/VsslEtrynd5/Info5"
PAGE_SIZE = 50  # API 최대값

# 탐색으로 확인한 항만청 코드 (2026-10-08)
PORTS = {
    "020": "부산",
    "030": "인천",
    "031": "평택",
    "300": "대산",
    "620": "여수",
    "621": "여천",
    "622": "광양",
    "701": "포항신항",
    "820": "울산",
}


def load_key() -> str:
    key = os.environ.get("DATA_GO_KR_KEY")
    if key:
        return key
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("DATA_GO_KR_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("DATA_GO_KR_KEY 가 없습니다 (.env 확인)")


def months(start: str, end: str) -> list[str]:
    y, m = map(int, start.split("-"))
    ey, em = map(int, end.split("-"))
    out = []
    while (y, m) <= (ey, em):
        out.append(f"{y:04d}{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def request(key: str, port: str, ym: str, page: int, retries: int = 5) -> bytes:
    y, m = int(ym[:4]), int(ym[4:])
    last = calendar.monthrange(y, m)[1]
    q = urllib.parse.urlencode({
        "serviceKey": key, "pageNo": page, "numOfRows": PAGE_SIZE,
        "prtAgCd": port, "sde": f"{ym}01", "ede": f"{ym}{last:02d}",
    })
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(f"{ENDPOINT}?{q}", timeout=60) as r:
                body = r.read()
            code = ET.fromstring(body).findtext(".//resultCode")
            if code != "00":
                raise RuntimeError(f"resultCode={code}")
            return body
        except Exception as e:  # 네트워크·일시 오류는 지수 백오프로 재시도
            if attempt == retries - 1:
                raise RuntimeError(f"{port} {ym} p{page}: {e}") from e
            time.sleep(2 ** attempt)
    raise AssertionError


def fetch_month(key: str, port: str, ym: str) -> tuple[str, str, int, int]:
    d = RAW / port
    d.mkdir(parents=True, exist_ok=True)
    first = d / f"{ym}_p1.xml"
    if not first.exists():
        first.write_bytes(request(key, port, ym, 1))
    total = int(ET.parse(first).getroot().findtext(".//totalCount") or 0)
    pages = max(1, -(-total // PAGE_SIZE))
    fetched = 0
    for p in range(2, pages + 1):
        f = d / f"{ym}_p{p}.xml"
        if f.exists():
            continue
        f.write_bytes(request(key, port, ym, p))
        fetched += 1
    return port, ym, total, pages


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2025-10")
    ap.add_argument("--end", default="2026-09")
    ap.add_argument("--ports", nargs="*", default=list(PORTS))
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    key = load_key()
    jobs = [(p, ym) for p in args.ports for ym in months(args.start, args.end)]
    with cf.ThreadPoolExecutor(args.workers) as ex:
        futs = [ex.submit(fetch_month, key, p, ym) for p, ym in jobs]
        for f in cf.as_completed(futs):
            port, ym, total, pages = f.result()
            print(f"{port} {PORTS.get(port, '?')} {ym}: {total}건 {pages}쪽", flush=True)


if __name__ == "__main__":
    main()
