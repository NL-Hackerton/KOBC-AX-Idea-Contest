"""3분 시연 영상. 설치된 Chrome으로 웹을 조작하고 한국어 자막을 얹는다.

    python scripts/demo_video.py --url http://127.0.0.1:5173/ --server-url http://127.0.0.1:5174/
    → build/demo/k-jit-demo.mp4

--url 은 저장본 웹(서버 주소 없음), --server-url 은 API에 연결된 웹이다.
자막의 숫자는 저장본·실측 문서의 고정값만 쓴다. LLM을 쓰지 않았으면 그렇게 말한다.
대본: docs/시연영상-대본.md
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
W, H = 1440, 900
CHROME = "/usr/local/bin/google-chrome"

CAPTION_JS = """(t) => {
  let d = document.getElementById('demo-cap')
  if (!d) {
    d = document.createElement('div'); d.id = 'demo-cap'
    Object.assign(d.style, {
      position: 'fixed', left: '50%', bottom: '22px', transform: 'translateX(-50%)',
      maxWidth: '1080px', background: 'rgba(15, 23, 40, .92)', color: '#fff',
      padding: '12px 22px', borderRadius: '12px',
      font: '600 20px/1.45 "Pretendard Variable", Pretendard, "IBM Plex Sans KR", sans-serif',
      zIndex: 9999, textAlign: 'center', pointerEvents: 'none'
    })
    document.body.appendChild(d)
  }
  d.textContent = t
  d.style.display = t ? 'block' : 'none'
}"""

TITLE_JS = """(spec) => {
  let d = document.getElementById('demo-title')
  if (!spec) { if (d) d.remove(); return }
  if (!d) {
    d = document.createElement('div'); d.id = 'demo-title'
    Object.assign(d.style, {
      position: 'fixed', inset: '0', zIndex: 10000, display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px',
      background: '#0b1220', color: '#e8eef8', textAlign: 'center', padding: '48px',
      fontFamily: '"Pretendard Variable", Pretendard, "IBM Plex Sans KR", sans-serif'
    })
    document.body.appendChild(d)
  }
  d.innerHTML = ''
  const h = document.createElement('div')
  h.textContent = spec.title
  Object.assign(h.style, {fontSize: '54px', fontWeight: '800', letterSpacing: '-0.03em'})
  const p = document.createElement('div')
  p.textContent = spec.sub || ''
  Object.assign(p.style, {fontSize: '24px', fontWeight: '500', maxWidth: '820px', lineHeight: '1.5', color: '#b7c3d6'})
  d.append(h, p)
}"""


def cap(page: Page, text: str, wait: float = 0) -> None:
    page.evaluate(CAPTION_JS, text)
    if wait:
        page.wait_for_timeout(int(wait * 1000))


def title(page: Page, heading: str, sub: str = "") -> None:
    page.evaluate(TITLE_JS, {"title": heading, "sub": sub})


def title_off(page: Page) -> None:
    page.evaluate(TITLE_JS, None)


def go(page: Page, base: str, hsh: str, wait: float = 1.1) -> None:
    if page.url.startswith(base.rstrip("/")):
        page.evaluate("(h) => { location.hash = h; window.scrollTo(0, 0) }", hsh)
    else:
        page.goto(base.rstrip("/") + "/" + hsh, wait_until="networkidle")
    page.wait_for_timeout(int(wait * 1000))


def click(page: Page, role: str, name: str, wait: float = 0.8, exact: bool = True) -> None:
    try:
        page.get_by_role(role, name=name, exact=exact).first.click(timeout=5000)
    except Exception as e:
        print("건너뜀:", role, name, str(e)[:120])
    page.wait_for_timeout(int(wait * 1000))


def scroll(page: Page, dy: int, steps: int = 10, wait: float = 0.4) -> None:
    for _ in range(steps):
        page.mouse.wheel(0, dy / steps)
        page.wait_for_timeout(30)
    page.wait_for_timeout(int(wait * 1000))


def examples() -> dict:
    return json.loads((ROOT / "data/processed/web/agent_examples.json").read_text())


def scenario(page: Page, snap: str, server: str) -> None:
    ex = examples()
    page.goto(snap + "#ports/울산", wait_until="networkidle")
    page.wait_for_timeout(800)

    title(page, "K-JIT, 적시 입항 코파일럿")
    page.wait_for_timeout(2500)
    title(page, "K-JIT, 적시 입항 코파일럿", "선석이 언제 비는지 확률로 보고, 그 시각에 맞춰 속도를 늦춥니다.")
    page.wait_for_timeout(2500)
    title_off(page)

    click(page, "button", "실시간", 0.6)
    cap(page, "울산항입니다. 10월 8일 22시 24분 공개 데이터로, 접안 14척, 정박지 대기 33척입니다.", 6)
    scroll(page, 620, wait=0.2)
    cap(page, "입항 예정에서 예측 대상 선석으로 신고된 배는 권고를 바로 볼 수 있습니다.", 5)

    click(page, "button", "권고 보기", 1.2, exact=False)
    page.wait_for_selector(".rec-time", timeout=15000)
    cap(page, "ARGENT HIBISCUS, OTK부두. 같은 시각에 엔진이 미리 계산한 권고는 23시 32분 도착, 0.5시간 늦춤입니다.", 6)
    click(page, "radio", "대기 순번 공유", 0.7)
    click(page, "radio", "선석계획 공유", 0.4)
    cap(page, "정보 조건을 바꾸면 대기열과 선석이 비는 분포가 함께 바뀝니다.", 6)

    click(page, "button", "재생", 1.4)
    page.wait_for_selector("text=SPLENDOR", timeout=10000)
    cap(page, "재생입니다. 2026년 9월 울산 SK7부두의 SPLENDOR를, 도착 하루 전으로 돌려 다시 결정합니다.", 6)
    cap(page, "위험 수준 0.1의 권고 도착은 9월 29일 10시 55분입니다. 연료 20.3톤, 이산화탄소 64.1톤을 줄입니다.", 6)
    click(page, "button", "왜 이 권고인가", 0.8)
    cap(page, "이유는 엔진이 계산한 대기열과 분포만 가지고 적습니다.", 5)
    click(page, "button", "실제 결과 보기", 1.0)
    cap(page, "실제 선석 가용은 9월 30일 20시 30분입니다. 원래 일정이면 46.5시간을 기다렸고, 권고대로 와도 33.6시간이 남습니다. 추가 선석 유휴는 없습니다.", 8)

    go(page, snap, "#simulate", 1.2)
    click(page, "radio", "공개 데이터만", 0.45)
    click(page, "radio", "대기 순번 공유", 0.45)
    click(page, "radio", "선석계획 공유", 0.3)
    cap(page, "표본 밖 두 달(2026년 8–9월)에 같은 정책을 적용합니다. 선석계획 공유, 위험 수준 0.1이면 완전 정보 상한의 56%, 연료 1,922.6톤입니다.", 8)

    go(page, snap, "#cii", 1.2)
    cap(page, "정박지에서 태운 연료를 빼면 이 예시 탱커의 연간 CII는 5.73에서 5.54로 내려갑니다. 2023년과 2028년에 등급이 오릅니다.", 7)

    go(page, snap, "#evidence", 1.2)
    cap(page, "중앙값 오차는 기준선 30.28시간에서 23.98시간으로 줄었습니다. 80% 구간 적중률은 재보정 뒤 77.7%이고, 목표 80%에는 아직 못 미칩니다.", 8)

    go(page, snap, "#agent/lineup", 1.2)
    page.locator("textarea").first.fill(ex["mails"][0]["text"])
    page.wait_for_timeout(400)
    click(page, "button", "순번 정리", 1.2)
    cap(page, "대리점 메일을 붙여 대기 순번을 표로 만듭니다. 운항 DB가 없는 서버라, 이 예시 메일은 저장해 둔 표를 보여 줍니다.", 8)
    click(page, "button", "항차 결정에 넣기", 1.0)
    cap(page, "그 표를 항차 결정의 대기 순번 조건으로 넘깁니다.", 6)

    go(page, snap, "#agent/settle", 1.1)
    cap(page, "아낀 연료비와 체선료 변화를 선주와 용선자로 나눕니다. 요율과 단가는 예시입니다.", 7)

    # 서버가 실제로 처리하는 부분. 조항·문안은 규칙 폴백, 직접 입력과 질의응답은 모델이 없어 준비 중.
    go(page, server, "#agent/contract", 1.6)
    page.locator("textarea").first.fill(ex["contracts"][0]["text"])
    page.wait_for_timeout(300)
    click(page, "button", "조항 찾기", 1.6)
    cap(page, "서버가 용선계약에서 조항을 고릅니다. LLM 키는 없어서 규칙으로 찾았고, 화면에도 규칙·템플릿이라고 나옵니다.", 8)

    go(page, server, "#decision/replay/820-2026-001-V7B3580", 1.6)
    click(page, "button", "선장 지시문", 1.0)
    try:
        page.locator(".agent-note pre").first.scroll_into_view_if_needed(timeout=5000)
    except Exception as e:
        print("문안 스크롤 건너뜀:", str(e)[:120])
    cap(page, "선장 지시문과 용선자 요청서도 서버의 규칙·템플릿입니다. 시각과 연료는 화면의 권고를 그대로 옮깁니다.", 5)
    click(page, "button", "용선자 요청서", 0.6)
    cap(page, "선장 지시문과 용선자 요청서도 서버의 규칙·템플릿입니다. 시각과 연료는 화면의 권고를 그대로 옮깁니다.", 3)

    go(page, server, "#decision/live/울산", 1.6)
    try:
        form = page.locator(".manual")
        page.locator("select").filter(has=page.locator("option", has_text="직접 입력")).first.select_option(value="")
        page.wait_for_timeout(400)
        form.get_by_label("선박명").fill("데모 탱커")
        form.get_by_label("총톤수").fill("30000")
        form.get_by_label("목적 선석").select_option(label="SK7부두")
        form.get_by_label("도착 예정 (KST)").fill("2026-10-30T18:00")
        page.get_by_role("button", name="권고 계산").click(timeout=4000)
        page.wait_for_timeout(1200)
    except Exception as e:
        print("직접 입력 건너뜀:", str(e)[:180])
    cap(page, "목록에 없는 배는 서버가 그 자리에서 계산합니다. 예측 모델 파일이 없어, 지금은 준비 중이라는 안내만 돌아옵니다.", 7)

    go(page, server, "#agent/chat", 1.3)
    click(page, "button", "내일 오후 2시에 울산 SK7부두에 들어가는 탱커인데 언제 도착하면 돼?", 2.0)
    cap(page, "질의응답도 엔진을 부르지 못했습니다. 모델과 운항 DB가 이 저장소에 없기 때문입니다.", 6)

    go(page, snap, "#decision/replay/820-2026-001-V7B3580", 1.3)
    cap(page, "K-JIT는 공개 데이터로 시작합니다. 선석 정보를 나눌수록, 정박지에서 태우는 연료를 더 줄일 수 있습니다.", 5)
    cap(page, "")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:5173/")
    ap.add_argument("--server-url", default="http://127.0.0.1:5174/")
    ap.add_argument("--out", default="build/demo")
    args = ap.parse_args()
    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT / out
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox", "--disable-gpu"])
        ctx = browser.new_context(
            viewport={"width": W, "height": H},
            record_video_dir=str(out),
            record_video_size={"width": W, "height": H},
            timezone_id="Asia/Seoul",
            locale="ko-KR",
        )
        page = ctx.new_page()
        scenario(page, args.url if args.url.endswith("/") else args.url + "/", args.server_url if args.server_url.endswith("/") else args.server_url + "/")
        video = page.video.path()
        ctx.close()
        browser.close()
    mp4 = out / "k-jit-demo.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-crf", "28", "-preset", "veryfast", "-movflags", "+faststart", str(mp4)],
        check=True,
    )
    Path(video).unlink(missing_ok=True)
    dur = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp4)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    copy = ROOT / "docs" / "video" / "K-JIT-시연영상.mp4"
    copy.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(mp4, copy)
    print(f"→ {mp4} ({mp4.stat().st_size / 1e6:.1f}MB, {float(dur):.0f}초)")
    print(f"→ {copy}")


if __name__ == "__main__":
    main()
