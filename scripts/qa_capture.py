"""화면 캡처와 브라우저 검수 (설치된 Chrome 사용).

    uv run --with playwright python scripts/qa_capture.py \
        --url http://localhost:5173/ --single web/dist-single/index.html --out docs/images/screens

1. --url 의 여섯 화면을 데스크톱(1440)·모바일(390) 폭으로 찍고 콘솔 오류와 가로 넘침을 모은다.
2. --single 단일 HTML을 file:// 로 열어 같은 화면이 뜨는지, 콘솔 오류가 없는지 본다.
   서버 주소를 넣어 빌드한 파일이면 서버가 없을 때 상단 표식이 저장본으로 바뀌는지도 본다.
결과는 out/qa.json 에 남긴다.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

SCREENS = [
    ("ports", "#ports/울산"),
    ("decision-replay", "#decision/replay/820-2026-001-V7B3580"),
    ("decision-live", "#decision/live/울산"),
    ("simulate", "#simulate"),
    ("evidence", "#evidence"),
    ("cii", "#cii"),
    ("agent-contract", "#agent/contract"),
    ("agent-settle", "#agent/settle"),
    ("agent-chat", "#agent/chat"),
]
SIZES = {"desktop": (1440, 900), "mobile": (390, 844)}


def visit(page, url: str, errors: list[str]) -> dict:
    page.goto(url)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1200)
    return page.evaluate("""() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        status: document.querySelector('.status')?.innerText ?? '',
        text: (document.querySelector('main')?.innerText ?? '').length,
    })""")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5173/")
    ap.add_argument("--single", default="web/dist-single/index.html")
    ap.add_argument("--out", default="docs/images/screens")
    ap.add_argument("--no-shots", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report: dict = {"url": args.url, "screens": {}, "single": {}}

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        for size, (w, h) in SIZES.items():
            ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=2,
                                      timezone_id="Asia/Seoul", locale="ko-KR")
            page = ctx.new_page()
            errors: list[str] = []
            page.on("console", lambda m: m.type == "error" and errors.append(m.text[:200]))
            page.on("pageerror", lambda e: errors.append(str(e)[:200]))
            for name, hsh in SCREENS:
                before = len(errors)
                info = visit(page, args.url + hsh, errors)
                if not args.no_shots:
                    page.screenshot(path=str(out / f"{name}-{size}.png"), full_page=True)
                report["screens"][f"{name}-{size}"] = info | {"errors": errors[before:]}
            ctx.close()

        single = Path(args.single).resolve()
        if single.exists():
            ctx = browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Seoul")
            page = ctx.new_page()
            errors = []
            refused = []  # 서버가 없을 때 브라우저가 찍는 연결 실패는 예상된 것으로 따로 센다
            page.on("console", lambda m: m.type == "error" and (
                refused if "ERR_CONNECTION_REFUSED" in m.text or "Failed to load resource" in m.text else errors
            ).append(m.text[:200]))
            page.on("pageerror", lambda e: errors.append(str(e)[:200]))
            for name, hsh in SCREENS:
                before = len(errors)
                info = visit(page, single.as_uri() + hsh, errors)
                report["single"][name] = info | {"errors": errors[before:], "refusedRequests": len(refused)}
            ctx.close()
        browser.close()

    (out / "qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=1))
    bad = {k: v for k, v in {**report["screens"], **{f"single:{k}": v for k, v in report["single"].items()}}.items()
           if v["errors"] or v["overflow"] > 0 or v["text"] < 50}
    print(f"화면 {len(report['screens'])}장, 단일 HTML {len(report['single'])}화면, 문제 {len(bad)}건")
    for k, v in bad.items():
        print(" ", k, v)
    for k, v in report["single"].items():
        print("  single", k, v["status"].replace("\n", " ")[:60])


if __name__ == "__main__":
    main()
