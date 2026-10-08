import { useState } from 'react'
import { agentExamples, postAgent } from '../api'
import type { AgentMeta, DecisionSummary, DraftResult, ExplainResult } from '../types'
import GenBadge from './GenBadge'

type Kind = 'explain' | 'master' | 'charterer'
type Out = { meta: AgentMeta; offline: boolean; text?: string; ko?: string; en?: string } | { error: string }

/** 권고 설명과 지시문·요청서. 서버가 없으면 저장된 예시(대표 사례)로 보여준다. */
export default function AgentNote({ summary, exampleKey, showDrafts }: { summary: DecisionSummary; exampleKey: string | null; showDrafts: boolean }) {
  const sig = JSON.stringify([summary.berth, summary.tau, summary.a0, summary.condition, summary.risk, summary.policy.rta])
  const [open, setOpen] = useState<Kind | null>(null)
  const [cache, setCache] = useState<Record<string, Out>>({})
  const [busy, setBusy] = useState(false)
  const [lang, setLang] = useState<'ko' | 'en'>('ko')

  async function run(kind: Kind) {
    if (open === kind) return setOpen(null)
    setOpen(kind)
    const k = `${sig}|${kind}`
    if (cache[k]) return
    setBusy(true)
    const r =
      kind === 'explain'
        ? await postAgent<ExplainResult>('explain', summary)
        : await postAgent<DraftResult>('draft', { decision: summary, kind })
    setBusy(false)
    let out: Out
    if ('error' in r) {
      const ex = agentExamples()
      const saved = exampleKey ? (kind === 'explain' ? ex?.explain[exampleKey] : ex?.drafts[exampleKey]?.[kind]) : undefined
      if (r.error === 'no-server' && saved) out = { meta: saved, offline: true, ...saved }
      else out = { error: r.error === 'no-server' ? '배포본에서는 대표 사례의 설명과 문안을 미리 만들어 두었습니다. 다른 항차는 서버를 실행하면 만들 수 있습니다.' : r.error }
    } else out = { meta: r, offline: false, ...r }
    setCache((c) => ({ ...c, [k]: out }))
  }

  const cur = open ? cache[`${sig}|${open}`] : undefined
  return (
    <div className="agent-note">
      <div className="note-actions">
        <button className="btn" aria-expanded={open === 'explain'} onClick={() => run('explain')}>
          왜 이 권고인가
        </button>
        {showDrafts && (
          <>
            <button className="btn" aria-expanded={open === 'master'} onClick={() => run('master')}>
              선장 지시문
            </button>
            <button className="btn" aria-expanded={open === 'charterer'} onClick={() => run('charterer')}>
              용선자 요청서
            </button>
          </>
        )}
      </div>
      {open && (busy && !cur ? <p className="small muted">만드는 중</p> : null)}
      {open && cur && ('error' in cur ? <p className="notice small">{cur.error}</p> : (
        <div className="note">
          <GenBadge meta={cur.meta} offline={cur.offline} />
          {open === 'explain' ? (
            <p className="explain">{cur.text}</p>
          ) : (
            <>
              <div className="lang-switch small">
                <button className={lang === 'ko' ? 'on' : ''} onClick={() => setLang('ko')}>한국어</button>
                <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
                <button className="link" onClick={() => navigator.clipboard?.writeText((lang === 'ko' ? cur.ko : cur.en) ?? '')}>복사</button>
              </div>
              <pre>{lang === 'ko' ? cur.ko : cur.en}</pre>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
