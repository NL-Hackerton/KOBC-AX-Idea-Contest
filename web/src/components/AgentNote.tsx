import { useEffect, useState } from 'react'
import { agentExamples, postAgent } from '../api'
import type { AgentMeta, DecisionSummary, DraftResult, ExplainResult } from '../types'
import GenBadge from './GenBadge'
import { CardHead } from './ui'

type Kind = 'explain' | 'master' | 'charterer'
type Props = { summary: DecisionSummary; exampleKey: string | null; showDrafts: boolean; action?: 'master' | 'charterer' | 'reason'; presentation?: 'compact' | 'cards'; onSettle?: () => void }
const CHECKS = {
  master: ['권고 도착 시각이 항차 결정 화면과 같다', '위험 수준과 근거 분포를 확인했다', '선장에게 보낼 채널을 정했다'],
  charterer: ['인용한 계약 조항 원문을 확인했다', '정산 금액이 정산 계산기 결과와 같다', '용선자 담당자를 확인했다'],
}
type Out = { meta: AgentMeta; offline: boolean; text?: string; ko?: string; en?: string } | { error: string }

async function generate(summary: DecisionSummary, exampleKey: string | null, kind: Kind): Promise<Out> {
  const r = kind === 'explain' ? await postAgent<ExplainResult>('explain', summary) : await postAgent<DraftResult>('draft', { decision: summary, kind })
  if (!('error' in r)) return { meta: r, offline: false, ...r }
  const ex = agentExamples()
  const saved = exampleKey ? (kind === 'explain' ? ex?.explain[exampleKey] : ex?.drafts[exampleKey]?.[kind]) : undefined
  if (r.error === 'no-server' && saved) return { meta: saved, offline: true, ...saved }
  return { error: r.error === 'no-server' ? '배포본에서는 대표 사례의 설명과 문안을 미리 만들어 두었습니다. 다른 항차는 서버를 실행하면 만들 수 있습니다.' : r.error }
}

function NoteContent({ out, kind, onSettle }: { out: Out; kind: Kind; onSettle?: () => void }) {
  const [lang, setLang] = useState<'ko' | 'en'>('ko')
  const [checked, setChecked] = useState<boolean[]>([false, false, false])
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  if ('error' in out) return <p className="notice small">{out.error}</p>
  const text = kind === 'explain' ? out.text : lang === 'ko' ? out.ko : out.en
  const ready = checked.every(Boolean)
  async function copy() {
    if (!ready) return
    try {
      await navigator.clipboard.writeText(text ?? '')
      setCopied(true)
      setCopyError('')
    } catch {
      setCopyError('문안을 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.')
    }
  }
  return <div className="note">
    <GenBadge meta={out.meta} offline={out.offline} />
    {kind === 'explain' ? <p className="explain">{out.text}</p> : <>
      <div className="lang-switch small" aria-label="문안 언어">
        <button className={lang === 'ko' ? 'on' : ''} onClick={() => { setLang('ko'); setCopied(false) }}>한국어</button>
        <button className={lang === 'en' ? 'on' : ''} onClick={() => { setLang('en'); setCopied(false) }}>English</button>
      </div>
      <pre className="draft-document">{text}</pre>
      <fieldset className="send-checks">
        <legend className="small muted">보내기 전 확인</legend>
        {CHECKS[kind].map((c, i) => <label key={c} className={`small${checked[i] ? ' checked' : ''}`}><input type="checkbox" checked={checked[i]} onChange={(e) => { setChecked((old) => old.map((v, j) => j === i ? e.target.checked : v)); setCopied(false) }} /> <span>{c}</span></label>)}
      </fieldset>
      <div className="note-actions">
        {kind === 'charterer' && onSettle && <button className="btn" onClick={onSettle}>정산 계산기 확인</button>}
        <button className={`btn primary send-button${ready ? ' ready' : ''}`} disabled={!ready} onClick={copy}>{copied ? '문안을 복사했습니다' : kind === 'master' ? '보내기 전 문안 복사' : '확인하고 문안 복사'}</button>
      </div>
      <p className="small muted" role="status">{copyError || (copied ? '선택한 채널에 붙여 넣어 보내 주세요. 이 화면에서는 메일을 발송하지 않습니다.' : '확인 항목을 모두 체크하면 보낼 문안을 복사할 수 있습니다.')}</p>
    </>}
  </div>
}

function DraftCard({ summary, exampleKey, kind, onSettle }: { summary: DecisionSummary; exampleKey: string | null; kind: 'master' | 'charterer'; onSettle?: () => void }) {
  const [out, setOut] = useState<Out | null>(null)
  useEffect(() => {
    let active = true
    generate(summary, exampleKey, kind).then((value) => { if (active) setOut(value) })
    return () => { active = false }
  }, [summary, exampleKey, kind])
  return <section className="panel draft-card">
    <CardHead title={kind === 'master' ? '선장 지시문 (초안)' : '용선자 요청서 (초안)'} sub={kind === 'master' ? `항차 결정 화면의 현재 권고(${summary.vessel || '직접 입력 선박'} · ${summary.berth})로 만든 초안입니다.` : '감속 도착을 요청하고, 체선료 산정 기준을 함께 적습니다.'} />
    {out ? <NoteContent out={out} kind={kind} onSettle={onSettle} /> : <div className="skeleton draft-loading" aria-label="초안을 만드는 중" />}
  </section>
}

/** Existing compact actions are retained for the decision screen; cards show both drafts. */
export default function AgentNote({ summary, exampleKey, showDrafts, action, presentation = 'compact', onSettle }: Props) {
  const sig = JSON.stringify([summary.berth, summary.tau, summary.a0, summary.condition, summary.risk, summary.policy.rta])
  const [open, setOpen] = useState<Kind | null>(null)
  const [cache, setCache] = useState<Record<string, Out>>({})
  const [busy, setBusy] = useState(false)
  async function load(kind: Kind, toggle = true) {
    if (toggle && open === kind) return setOpen(null)
    setOpen(kind)
    const key = `${sig}|${kind}`
    if (cache[key]) return
    setBusy(true)
    const out = await generate(summary, exampleKey, kind)
    setCache((old) => ({ ...old, [key]: out }))
    setBusy(false)
  }
  useEffect(() => {
    if (action) void load(action === 'reason' ? 'explain' : action, false)
    // Opening from the recommendation is driven by the action and decision identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, sig])
  if (presentation === 'cards' && showDrafts) return <div className="agent-grid agent-draft-grid"><DraftCard key={`${sig}|master`} summary={summary} exampleKey={exampleKey} kind="master" /><DraftCard key={`${sig}|charterer`} summary={summary} exampleKey={exampleKey} kind="charterer" onSettle={onSettle} /></div>
  const current = open ? cache[`${sig}|${open}`] : undefined
  return <div className="agent-note">
    <div className="note-actions">
      <button className="btn" aria-expanded={open === 'explain'} onClick={() => load('explain')}>왜 이 권고인가</button>
      {showDrafts && <><button className="btn" aria-expanded={open === 'master'} onClick={() => load('master')}>선장 지시문</button><button className="btn" aria-expanded={open === 'charterer'} onClick={() => load('charterer')}>용선자 요청서</button></>}
    </div>
    {busy && !current && <p className="small muted" role="status">만드는 중</p>}
    {open && current && <NoteContent key={`${sig}|${open}`} out={current} kind={open} />}
  </div>
}
