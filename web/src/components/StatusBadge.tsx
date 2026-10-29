import { useEffect, useState } from 'react'
import { getMode, hasServer, onModeChange, snapshotMeta } from '../api'
import { fmtDT } from '../lib/time'

/** 헤더 알림. 서버 연결·저장본 시각만 보여 주고, 없는 알림은 만들지 않는다. */
export default function StatusBadge({ replay }: { replay: boolean }) {
  const [mode, setMode] = useState(getMode())
  const [open, setOpen] = useState(false)
  useEffect(() => onModeChange(setMode), [])
  const when = snapshotMeta.snapshotDate ? fmtDT(snapshotMeta.snapshotDate) : ''
  const label = replay ? '재생 · 2026-08-09 실제 항차' : mode === 'live' && hasServer() ? '실시간 · 서버 연결' : `실시간 · 공개 데이터 ${when} 기준`
  return (
    <div className="status-wrap">
      <div className={`status small ${replay ? 'is-replay' : 'is-live'}`} role="status">
        <span className="dot" aria-hidden />
        {label}
      </div>
      <button type="button" className="icon-btn" aria-label="데이터 상태" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2H4.5L6 16z" />
          <path d="M10 18a2 2 0 0 0 4 0" />
        </svg>
      </button>
      {open && (
        <div className="status-pop" role="dialog" aria-label="데이터 상태">
          <p className="small">
            {mode === 'live' && hasServer() ? '실시간 서버에 연결되어 있습니다.' : `이 화면은 공개 데이터 ${when} 기준 저장본입니다.`}
          </p>
          <p className="small muted">재생 사례는 2026-08~09 해수부 입출항 신고 실데이터입니다. 별도의 알림 목록은 없습니다.</p>
        </div>
      )}
    </div>
  )
}
