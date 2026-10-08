"""제출 zip 구성 (기획 9절): 서명 PDF, 단일 HTML, 시연 영상, 여는 방법.

    cd web && npm run build:single && cd ..   # 서버 없는 배포본
    uv run --with playwright python scripts/demo_video.py
    uv run python scripts/package_submission.py --pdf <성명>_해운항만물류_AX공모전.pdf --pages https://nl-hackerton.github.io/KOBC-AX-Idea-Contest/

서명 PDF가 없으면 경고하고 나머지만 묶는다(리허설용). 결과: build/submission/k-jit-submission.zip
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

README = """K-JIT 선석 가용 확률 예측 기반 적시 입항 코파일럿
2026 해운·항만·물류 AX 혁신 아이디어 공모전 제출물

1. 웹 주소: {pages}
   저장소: {repo}
   웹 앱은 {snapshot} 기준 공개 데이터로 고정한 배포본입니다. 입항 예정 선박의 권고와 시뮬레이터
   결과는 저장소의 Python 엔진으로 그 시각에 계산했습니다. 공공데이터를 30분마다 수집해 실시간으로
   계산하는 서버와 질의응답은 저장소의 README에 따라 실행할 수 있으며, 시연 영상에 실제 동작이 있습니다.

2. k-jit.html (단일 파일)
   인터넷 연결 없이 더블클릭으로 열리는 같은 웹 앱입니다. 크롬·엣지·사파리 최신판 권장.

3. k-jit-demo.mp4 (약 3분 시연 영상)

화면 구성: 항만 현황, 항차 결정(재생·실시간), 항만 시뮬레이터, 근거, CII, 계약·정산·에이전트.
재생·근거·시뮬레이터 수치는 2025-10~2026-09 해양수산부 선박운항정보 실데이터에서 계산했고,
코드와 저장본은 {freeze}에 고정했습니다. 실시간 화면은 공개 API의 현재 값을 반영합니다.
에이전트의 예시 계약·메일은 합성 문안이며, LLM 생성 결과는 사람 검토가 필요합니다.
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", default=None)
    ap.add_argument("--single", default=str(ROOT / "web" / "dist-single" / "index.html"))
    ap.add_argument("--video", default=str(ROOT / "build" / "demo" / "k-jit-demo.mp4"))
    ap.add_argument("--server", default="")
    ap.add_argument("--repo", default="https://github.com/NL-Hackerton/KOBC-AX-Idea-Contest")
    ap.add_argument("--pages", default="(공개 전환 후 기입)")
    ap.add_argument("--out", default=str(ROOT / "build" / "submission" / "k-jit-submission.zip"))
    args = ap.parse_args()

    single, video = Path(args.single), Path(args.video)
    html = single.read_text()
    m = re.search(r'snapshotDate"?:["`](20[^"`]+)["`]', html)
    snapshot = m.group(1)[:16].replace("T", " ") if m else "(알 수 없음)"
    files = {
        "k-jit.html": single.read_bytes(),
        "k-jit-demo.mp4": video.read_bytes(),
        "README.txt": README.format(pages=args.pages, repo=args.repo, snapshot=snapshot,
                                    freeze=dt.date.today().isoformat()).encode("utf-8"),
    }
    if args.pdf:
        files[Path(args.pdf).name] = Path(args.pdf).read_bytes()
    else:
        print("경고: 서명 PDF가 없습니다 (리허설)")
    if args.server.startswith("http") and args.server not in html:
        print(f"경고: 단일 HTML에 서버 주소 {args.server} 가 없습니다. VITE_API_BASE 로 다시 빌드하세요.")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
    print(f"→ {out} ({out.stat().st_size / 1e6:.1f}MB)")
    for name, data in files.items():
        print(f"  {name:28s} {len(data) / 1e6:6.2f}MB  sha256 {hashlib.sha256(data).hexdigest()[:16]}")
    print(f"  저장본 기준 {snapshot}")


if __name__ == "__main__":
    main()
