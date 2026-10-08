"""3분 시연 영상: 웹 앱을 정해진 순서로 조작하며 화면 아래에 자막을 얹어 녹화한다 (설치된 Chrome 사용).

    uv run --with playwright python scripts/demo_video.py --url http://localhost:5173/
    → build/demo/k-jit-demo.mp4

자막의 숫자는 실측 문서에 고정된 값만 쓴다. 실시간 화면의 값은 녹화 시점마다 다르므로 자막에 넣지 않는다.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

W, H = 1440, 900
CAPTION_JS = """(t) => {
  let d = document.getElementById('demo-cap')
  if (!d) {
    d = document.createElement('div'); d.id = 'demo-cap'
    Object.assign(d.style, {position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', maxWidth: '1100px',
      background: 'rgba(23,34,45,.92)', color: '#fff', padding: '12px 20px', borderRadius: '6px', font: '500 20px/1.5 "IBM Plex Sans KR", sans-serif',
      zIndex: 9999, textAlign: 'center', pointerEvents: 'none'})
    document.body.appendChild(d)
  }
  d.textContent = t; d.style.display = t ? 'block' : 'none'
}"""


def cap(page: Page, text: str, wait: float = 0) -> None:
    page.evaluate(CAPTION_JS, text)
    if wait:
        page.wait_for_timeout(int(wait * 1000))


def go(page: Page, hsh: str, wait: float = 1.5) -> None:
    page.evaluate("(h) => { location.hash = h; window.scrollTo(0, 0) }", hsh)
    page.wait_for_timeout(int(wait * 1000))


def click(page: Page, role: str, name: str, wait: float = 1.2, nth: int = 0) -> None:
    try:
        page.get_by_role(role, name=name, exact=True).nth(nth).click(timeout=3000)
    except Exception as e:  # 녹화를 멈추지 않는다
        print("건너뜀:", role, name, str(e)[:80])
    page.wait_for_timeout(int(wait * 1000))


def scroll(page: Page, dy: int, steps: int = 12, wait: float = 0.6) -> None:
    for _ in range(steps):
        page.mouse.wheel(0, dy / steps)
        page.wait_for_timeout(40)
    page.wait_for_timeout(int(wait * 1000))


def busy_berth(api: str, port: str) -> tuple[str, str]:
    """지금 선박이 접안해 있고 남은 체류 예측이 가장 긴 단일 접안 선석과, 18시간 뒤 정시(datetime-local 형식)."""
    import datetime as dt
    import json
    import urllib.parse
    import urllib.request

    st = json.load(urllib.request.urlopen(f"{api}/api/ports/{urllib.parse.quote(port)}/state", timeout=30))
    occ = sorted((b for b in st["berths"] if b.get("predQ")), key=lambda b: -(b["predQ"][3] or 0))
    kst = dt.timezone(dt.timedelta(hours=9))
    eta = (dt.datetime.now(kst) + dt.timedelta(hours=18)).replace(minute=0, second=0, microsecond=0)
    return (occ[0]["berth"] if occ else "SK7부두"), eta.strftime("%Y-%m-%dT%H:%M")


API = "http://localhost:8000"


def scenario(page: Page) -> None:
    # 1. 문제 (약 20초)
    go(page, "#evidence")
    cap(page, "국내 탱커·벌크 항만에서는 배가 정박지에서 선석이 비기를 기다리며 연료를 태웁니다.", 5)
    cap(page, "해수부 공개 입출항 기록 1년 129,831항차: 대산·울산·광양은 정박지를 거친 항차의 약 절반이 12시간 넘게 기다렸습니다.", 6)
    scroll(page, 500)
    cap(page, "K-JIT는 선석이 언제 빌지 확률로 예측하고, 그만큼 늦게 도착하도록 감속을 권고합니다.", 5)

    # 2. 항만 현황 (약 20초)
    go(page, "#ports/울산", 2)
    cap(page, "항만 현황: 공공데이터를 30분마다(울산 선박 위치는 5분마다) 수집해 선석 점유·정박지 대기·입항 예정을 만듭니다.", 7)
    cap(page, "파란 띠는 지금 접안한 배가 언제 떠날지에 대한 예측 분포입니다.", 5)
    scroll(page, 700, wait=1)

    # 3. 항차 결정 재생 (약 45초)
    go(page, "#decision/replay/820-2026-001-V7B3580", 2)
    cap(page, "항차 결정(재생): 2026-09 울산 SK7부두에 도착할 탱커를 24시간 전 시점에서 다시 결정해 봅니다.", 5)
    click(page, "radio", "공개 데이터만", 0.5)
    cap(page, "공개 데이터만 쓰면 앞 순번 배가 보이지 않아 선석이 비어 있다고 판단하고, 원래 일정대로 들어갑니다.", 5)
    click(page, "radio", "선석계획 공유", 0.5)
    cap(page, "선석계획을 공유하면 앞 순번 두 척이 드러나고, 선석이 비는 시각의 분포가 며칠 뒤로 이동합니다.", 6)
    cap(page, "위험 수준 0.1: 선석이 이미 비어 있을 확률이 10%인 시각에 맞춰 도착하도록 늦추되, 감속으로 흡수할 수 있는 한도 안에서만 권고합니다.", 7)
    click(page, "button", "왜 이 권고인가", 0.5)
    cap(page, "권고의 이유는 엔진 수치만으로 설명합니다. 선장 지시문과 용선자 요청서도 같은 수치로 만듭니다.", 6)
    click(page, "button", "실제 결과 보기", 2)
    cap(page, "실제로는 선석이 그보다 훨씬 늦게 비었습니다. 늦춘 만큼 정박지 대기 연료를 감속 항해로 바꿔 아낍니다.", 6)

    # 4. 실시간 결정 (약 20초): 지금 차 있는 선석에 내일 도착하는 탱커를 직접 입력한다
    berth, eta = busy_berth(API, "울산")
    go(page, "#decision/live/울산", 3)
    cap(page, "실시간 모드: 지금 공개 데이터로 들어오는 배의 도착을 정합니다. 직접 입력도 됩니다.")
    try:
        picker = page.locator("select").filter(has=page.locator("option", has_text="직접 입력"))
        page.wait_for_function("() => [...document.querySelectorAll('select')].some(s => s.options.length > 1 && s.options[0].text === '직접 입력')", timeout=20000)
        page.wait_for_selector(".decision .case-head", timeout=20000)  # 첫 신고 선박의 자동 권고가 끝난 뒤
        picker.select_option(value="")
        page.wait_for_timeout(500)
        page.get_by_label("선박명").fill("데모 탱커")
        page.get_by_label("총톤수").fill("30000")
        page.get_by_label("목적 선석").select_option(label=berth)
        page.get_by_label("도착 예정 (KST)").fill(eta)
        # 입력이 끝나면 화면이 스스로 계산한다. 권고 카드가 뜰 때까지 기다린다
        page.wait_for_selector(".rec .rec-time", timeout=20000)
        page.wait_for_timeout(800)
    except Exception as e:
        print("실시간 입력 건너뜀:", str(e)[:100])
    cap(page, f"울산 {berth}에 내일 도착할 탱커: 지금 접안한 배와 정박지 대기 순번으로 선석이 비는 시각을 예측하고 바로 권고합니다.", 6)
    scroll(page, 450, wait=2)

    # 5. 시뮬레이터 (약 25초)
    go(page, "#simulate", 2)
    cap(page, "항만 시뮬레이터: 같은 정책을 표본 밖 2개월(2026-08~09) 실제 항차 전체에 적용합니다.", 5)
    click(page, "radio", "공개 데이터만", 0.5)
    click(page, "radio", "대기 순번 공유", 0.5)
    click(page, "radio", "선석계획 공유", 0.5)
    cap(page, "위험 수준 0.1에서 완전 정보 상한 대비 절감: 공개 데이터만 12%, 대기 순번 공유 28%, 선석계획 공유 56%. 늦게 도착해 생긴 선석 유휴는 27~64시간입니다.", 8)
    scroll(page, 500, wait=2)

    # 6. CII (약 15초)
    go(page, "#cii", 2)
    cap(page, "CII: 정박지 대기 연료를 빼면 연간 탄소집약도 등급이 어떻게 바뀌는지 IMO 결의의 기준선과 감축률로 계산합니다.", 6)
    scroll(page, 500, wait=1)

    # 7. 계약·정산·에이전트 (약 40초)
    go(page, "#agent/contract", 1.5)
    click(page, "button", "조항 찾기", 1.5)
    cap(page, "계약: 용선계약에서 JIT 도착, 신속 항해 의무, 체선료 조항을 근거 구간과 함께 찾습니다. (예시 계약은 합성 문안)", 6)
    go(page, "#agent/lineup", 1.5)
    click(page, "button", "순번 정리", 1.5)
    cap(page, "대리점의 대기 순번 메일을 표로 정리하고, 그대로 항차 결정의 대기 순번 조건에 넣습니다.", 5)
    click(page, "button", "항차 결정에 넣기", 4)
    cap(page, "메일에서 온 순번이 대기열에 들어가 권고가 다시 계산됩니다.", 5)
    go(page, "#agent/settle", 1.5)
    cap(page, "정산: 아낀 연료비와 체선료 변화를 선주·용선자별로 나눠, 누가 손해를 보는지와 손익분기 감액률을 보여줍니다.", 6)
    go(page, "#agent/chat", 1)
    click(page, "button", "광양 정박지 대기는 보통 얼마나 길어?", 2.5)
    cap(page, "질의응답은 엔진 도구를 불러 답하고, 답변의 수치는 모두 도구 결과에서 옵니다.", 6)

    # 8. 맺음 (약 8초)
    go(page, "#decision/replay/820-2026-001-V7B3580", 1.5)
    cap(page, "K-JIT: 선석 가용 확률 예측 기반 적시 입항 코파일럿. 공개 데이터로 시작하고, 정보를 공유할수록 절감이 커집니다.", 5)
    cap(page, "")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5173/")
    ap.add_argument("--out", default="build/demo")
    ap.add_argument("--api", default="http://localhost:8000")
    args = ap.parse_args()
    global API
    API = args.api
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        ctx = browser.new_context(viewport={"width": W, "height": H}, record_video_dir=str(out), record_video_size={"width": W, "height": H},
                                  timezone_id="Asia/Seoul", locale="ko-KR")
        page = ctx.new_page()
        page.goto(args.url + "#evidence")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1500)
        scenario(page)
        video = page.video.path()
        ctx.close()
        browser.close()
    mp4 = out / "k-jit-demo.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-crf", "26", "-preset", "slow", "-movflags", "+faststart", str(mp4)], check=True)
    Path(video).unlink()
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp4)],
                         capture_output=True, text=True).stdout.strip()
    print(f"→ {mp4} ({mp4.stat().st_size / 1e6:.1f}MB, {float(dur):.0f}초)")


if __name__ == "__main__":
    main()
