import { useState } from 'react'
import type { DecisionSummary, Policy, Risk } from '../types'
import AgentNote from './AgentNote'
import { fmtDT } from '../lib/time'
import { CountUp } from './ui'
import { useTween } from '../lib/motion'
import Icon from './Icon'
import sendIcon from '../assets/icons/decision-send.svg'
import docIcon from '../assets/icons/doc.svg'
import infoIcon from '../assets/icons/decision-info.svg'

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
  const [action, setAction] = useState<'master' | 'charterer' | 'reason' | null>(null)
  const [arrival] = useTween([new Date(p.rta).getTime()], 600)
  const keep = !busy || p.delayH < 0.05
  return (
    <>
    <section className="card rec raised" aria-label="권고">
      <div className="rec-heading"><span>권고 도착</span><span className="chip-soft">위험 수준 {risk}</span></div>
      <p className="rec-time num">{fmtDT(arrival)}</p>
      <p className="rec-delay">{keep ? '원래 일정대로 도착합니다.' : <>도착 예정 {fmtDT(a0)}보다 <CountUp value={p.delayH} format={n => n.toFixed(1)} />시간 늦춤</>}</p>
      {keep && <p className="small muted">{busy ? '이 위험 수준에서는 늦출 근거가 부족합니다.' : '이 정보 조건에서는 선석을 쓰거나 기다리는 앞 순번 배가 보이지 않습니다.'}</p>}
      <dl className="rec-facts num"><div><dt>권고 속도</dt><dd><CountUp value={p.speedKn} format={n => n.toFixed(1)} />노트 (설계 {designSpeedKn.toFixed(1)})</dd></div><div><dt>절감 연료</dt><dd><CountUp value={p.fuelT} format={n => n.toFixed(1)} /> t</dd></div><div><dt>절감 CO2</dt><dd><CountUp value={p.co2T} format={n => n.toFixed(1)} /> t</dd></div><div><dt>정보 조건</dt><dd>{{ public: '공개 데이터만', lineup: '대기 순번 공유', plan: '선석계획 공유' }[summary.condition]}</dd></div></dl>
      <button className="btn primary big block" onClick={() => setAction(action === 'master' ? null : 'master')} aria-expanded={action === 'master'}><Icon src={sendIcon} />선장 지시문</button>
      <button className="btn block" onClick={() => setAction(action === 'charterer' ? null : 'charterer')} aria-expanded={action === 'charterer'}><Icon src={docIcon} />용선자 요청서</button>
      <button className="btn ghost block" onClick={() => setAction(action === 'reason' ? null : 'reason')} aria-expanded={action === 'reason'}><Icon src={infoIcon} />왜 이 권고인가</button>
      {action && <div className="rec-note"><AgentNote summary={summary} exampleKey={exampleKey} showDrafts={!keep} action={action} /></div>}
      <button className="link rec-compare" aria-expanded={open} onClick={() => setOpen(!open)}>위험 수준별 비교 {open ? '접기' : '펼치기'}</button>
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

    </section>
    <section className="card demurrage-memo"><h3>체선료 메모</h3><p>체선료 메모: BIMCO JIT 도착 조항(2021)을 쓰면 늘어난 항해 {p.delayH.toFixed(1)}시간에는 감액 체선료율이 적용되고, 용선자 요청에 따른 감속은 신속 항해 의무 위반이 아닙니다.</p></section>
    </>
  )
}
