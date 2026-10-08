import { useState } from 'react'
import type { DecisionSummary, Policy, Risk } from '../types'
import AgentNote from './AgentNote'
import { fmtDT } from '../lib/time'

interface Props {
  policies: Record<Risk, Policy>
  risk: Risk
  a0: string
  designSpeedKn: number
  busy: boolean
  replay: boolean
  summary: DecisionSummary
  exampleKey: string | null
}

export default function RecommendationCard({ policies, risk, a0, designSpeedKn, busy, replay, summary, exampleKey }: Props) {
  const p = policies[risk]
  const [open, setOpen] = useState(false)
  const keep = !busy || p.delayH < 0.05
  return (
    <section className="panel rec" aria-label="권고">
      <h3>권고</h3>
      {keep ? (
        <>
          <p className="rec-time num">{fmtDT(a0)}</p>
          <p className="muted">원래 일정대로 도착합니다. {busy ? '이 위험 수준에서는 늦출 근거가 부족합니다.' : '이 정보 조건에서는 선석을 쓰거나 기다리는 앞 순번 배가 보이지 않습니다.'}</p>
        </>
      ) : (
        <>
          <p className="rec-label small muted">권고 도착</p>
          <p className="rec-time num">
            <span className="rta-key" aria-hidden />
            {fmtDT(p.rta)}
          </p>
          <dl className="rec-facts num">
            <div>
              <dt>늦춤</dt>
              <dd>{p.delayH.toFixed(1)}시간</dd>
            </div>
            <div>
              <dt>권고 속도</dt>
              <dd>
                {p.speedKn.toFixed(1)}노트 <span className="muted small">(설계 {designSpeedKn.toFixed(1)})</span>
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
          </dl>
          <p className="small muted memo">
            체선료 메모: BIMCO JIT 도착 조항(2021)을 쓰면 늘어난 항해 {p.delayH.toFixed(1)}시간에는 감액 체선료율이 적용되고, 용선자 요청에 따른 감속은 신속 항해 의무 위반이 아닙니다.
          </p>
        </>
      )}

      <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
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

      <AgentNote summary={summary} exampleKey={exampleKey} showDrafts={!keep} />
    </section>
  )
}
