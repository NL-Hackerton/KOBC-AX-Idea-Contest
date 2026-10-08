import { useEffect, useState } from 'react'
import { getMode, hasServer, onModeChange, snapshotMeta } from '../api'
import { fmtDT } from '../lib/time'

export default function StatusBadge({ screen }: { screen: string }) {
  const [mode, setMode] = useState(getMode())
  useEffect(() => onModeChange(setMode), [])
  const label =
    mode === 'live'
      ? '실시간 서버 연결'
      : hasServer()
        ? `저장본 ${snapshotMeta.snapshotDate ? fmtDT(snapshotMeta.snapshotDate) : ''} 기준 (서버 연결 없음)`
        : `공개 데이터 ${snapshotMeta.snapshotDate ? fmtDT(snapshotMeta.snapshotDate) : ''} 기준`
  return (
    <div className="status small" role="status">
      <span className={`dot ${mode}`} aria-hidden />
      {label}
      {screen === 'decision' && <span className="muted"> · 재생 사례는 2026-08~09 해수부 입출항 신고 실데이터</span>}
    </div>
  )
}
