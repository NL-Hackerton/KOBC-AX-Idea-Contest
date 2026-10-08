import type { Policy } from '../types'
import { fmtDT } from '../lib/time'

export default function RevealPanel({ revealed, onReveal, actualFree, actualWaitH, policy, busy }: { revealed: boolean; onReveal: () => void; actualFree: string; actualWaitH: number; policy: Policy; busy: boolean }) {
  if (!revealed)
    return (
      <section className="panel reveal">
        <button className="btn primary" onClick={onReveal}>
          실제 결과 보기
        </button>
        <span className="small muted">이 항차가 실제로 언제 선석에 들어갈 수 있었는지 공개합니다.</span>
      </section>
    )
  const idle = policy.extraIdleH ?? 0
  return (
    <section className="panel reveal open" aria-live="polite">
      <div className="reveal-grid num">
        <div>
          <p className="small muted">실제 선석 가용</p>
          <p className="big">{fmtDT(actualFree)}</p>
        </div>
        <div>
          <p className="small muted">현행(원래 도착)이면 대기</p>
          <p className="big">
            <span className="bar wait" style={{ width: `${Math.min(100, actualWaitH * 2)}px` }} />
            {actualWaitH.toFixed(1)}시간
          </p>
        </div>
        <div>
          <p className="small muted">권고대로면 남은 대기</p>
          <p className="big">{(policy.residualWaitH ?? 0).toFixed(1)}시간</p>
        </div>
        <div>
          <p className="small muted">늦게 도착해 생긴 선석 유휴</p>
          <p className="big">
            {idle > 0 && <span className="bar idle" style={{ width: `${Math.min(100, idle * 4)}px` }} />}
            {idle.toFixed(1)}시간
          </p>
        </div>
      </div>
      {!busy && <p className="small muted">결정 시각에 선석이 비어 있던 항차입니다. 권고는 원래 일정 유지였습니다.</p>}
    </section>
  )
}
