import { useState } from 'react'
import { fmtDT } from '../lib/time'
import type { DecisionSummary, Policy, Risk } from '../types'
import AgentNote from './AgentNote'

interface Props {
  policies: Record<Risk, Policy>
  risk: Risk
  a0: string
  designSpeedKn: number
  busy: boolean
  replay: boolean
  summary: DecisionSummary
  exampleKey: string | null
  conditionLabel: string
  loading?: boolean
  empty?: boolean
}

export default function RecommendationCard({ policies, risk, a0, designSpeedKn, busy, replay, summary, exampleKey, conditionLabel, loading, empty }: Props) {
  const p = policies[risk]
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState(false)
  const keep = !busy || p.delayH < 0.05
  const state = loading ? 'is-loading' : empty ? 'is-empty' : picked ? 'is-selected' : ''

  return (
    <section
      className={`panel rec rec-card ${state}`}
      aria-label="권고 도착"
      aria-busy={loading || undefined}
      tabIndex={0}
      onClick={() => setPicked((v) => !v)}
    >
      <header className="rec-head">
        <h3>권고 도착</h3>
        <span className="pill">위험 수준 {risk}</span>
      </header>
      {loading ? (
        <>
          <div className="skel skel-xl" />
          <div className="skel skel-sm" />
          <div className="skel skel-btn" />
        </>
      ) : empty ? (
        <>
          <p className="rec-time num faint">—:—</p>
          <p className="muted small">선박과 목적 선석, 도착 예정을 고르면 권고를 계산합니다.</p>
          <button type="button" className="btn primary block" disabled>
            계산 중
          </button>
        </>
      ) : keep ? (
        <>
          <p className="rec-time num faint">{fmtDT(a0)}</p>
          <p className="muted small">
            원래 일정대로 도착합니다. {busy ? '이 위험 수준에서는 늦출 근거가 부족합니다.' : '이 정보 조건에서는 선석을 쓰거나 기다리는 앞 순번 배가 보이지 않습니다.'}
          </p>
          <AgentNote summary={summary} exampleKey={exampleKey} showDrafts={false} layout="stack" />
        </>
      ) : (
        <>
          <p className="rec-time num">{fmtDT(p.rta)}</p>
          <p className="rec-delta small">
            도착 예정 {fmtDT(a0)}보다 <strong className="num">{p.delayH.toFixed(1)}시간</strong> 늦춤
          </p>
          <dl className="rec-lines num">
            <div>
              <dt>권고 속도</dt>
              <dd>
                {p.speedKn.toFixed(1)}노트 <span className="muted">(설계 {designSpeedKn.toFixed(1)})</span>
              </dd>
            </div>
            <div>
              <dt>절감 연료</dt>
              <dd>{p.fuelT.toFixed(1)} t</dd>
            </div>
            <div>
              <dt>절감 CO2</dt>
              <dd>{p.co2T.toFixed(1)} t</dd>
            </div>
            <div>
              <dt>정보 조건</dt>
              <dd>{conditionLabel}</dd>
            </div>
          </dl>
          <AgentNote summary={summary} exampleKey={exampleKey} showDrafts layout="stack" />
          <button type="button" className="link rec-compare" aria-expanded={open} onClick={(e) => (e.stopPropagation(), setOpen(!open))}>
            위험 수준별 비교 {open ? '접기' : '펼치기'}
          </button>
          {open && (
            <table className="data-table small num">
              <thead>
                <tr>
                  <th>위험 수준</th>
                  <th>권고 도착</th>
                  <th>늦춤</th>
                  <th>연료</th>
                  {replay && <th>남은 대기</th>}
                  {replay && <th>추가 유휴</th>}
                </tr>
              </thead>
              <tbody>
                {(Object.keys(policies) as Risk[]).map((r) => (
                  <tr key={r} className={r === risk ? 'sel' : ''}>
                    <td>{r}</td>
                    <td>{fmtDT(policies[r].rta)}</td>
                    <td>{policies[r].delayH.toFixed(1)}h</td>
                    <td>{policies[r].fuelT.toFixed(1)} t</td>
                    {replay && <td>{policies[r].residualWaitH?.toFixed(1)}h</td>}
                    {replay && <td>{policies[r].extraIdleH?.toFixed(1)}h</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  )
}
