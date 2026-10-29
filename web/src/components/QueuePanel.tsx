import type { QueueMember } from '../types'
import { fmtDT, ms } from '../lib/time'
import { useTween } from '../lib/motion'
import { useWidth } from '../lib/useWidth'

interface Props { queue: QueueMember[]; busy: boolean; berth: string; revealed: boolean; tau: string; a0: string; rta: string; vessel: string; quantilesH: number[]; maxDelayH: number }

export default function QueuePanel({ queue, busy, berth, revealed, tau, a0, rta, vessel, quantilesH, maxDelayH }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const t0 = ms(tau)
  const hour = (iso: string) => Math.max(0, (ms(iso) - t0) / 3600000)
  const end = Math.ceil(Math.max(quantilesH.at(-1) ?? 0, hour(a0) + maxDelayH, 24) * 1.08 / 6) * 6
  let previous = [0, 0, 0]
  const rows: { m: QueueMember; eta: number; start: number; lower: number; median: number; upper: number }[] = []
  for (const m of queue) {
    const eta = m.plannedAt ? hour(m.plannedAt) : 0
    const start = Math.max(eta, previous[1])
    const lower = Math.max(eta, previous[0]) + (m.predQ[0] ?? 0)
    const median = start + (m.predQ[3] ?? 0)
    const upper = Math.max(eta, previous[2]) + (m.predQ[6] ?? 0)
    previous = [lower, median, upper]
    rows.push({ m, eta, start, lower, median, upper })
  }
  const animated = useTween(rows.flatMap(r => [r.start, r.lower, r.median, r.upper]).concat(hour(rta)))
  const pct = (h: number) => `${Math.min(100, Math.max(0, h / end * 100))}%`
  const step = [6, 12, 24, 48, 72, 96, 168].find(h => h / end * (width - 52) >= 80) ?? 168
  const ticks = Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => step * i)
  return <section className="card queue" aria-label="선석 대기열"><div className="panel-head"><div><h3>선석 대기열 · {berth}</h3><p className="small muted">같은 선석을 먼저 쓰는 배와 출항 예측</p></div><span className="small muted">시간축은 아래 그래프와 같습니다</span></div>
    {!busy && !queue.length && <p className="small muted">결정 시각에 이 선석은 비어 있습니다. 앞 순번 배도 없습니다.</p>}
    <div className="queue-timeline" ref={ref}>{rows.map(({ m, eta }, i) => {
      const [start, lower, median, upper] = animated.slice(i * 4, i * 4 + 4)
      return <div className="timeline-row" key={`${m.callsign}-${i}`}><div className="timeline-caption"><strong>{m.vessel || m.callsign}</strong><span>{m.status === 'berthed' ? '접안 중' : m.status === 'waiting' ? '정박지 대기' : `도착 예정 ${fmtDT(m.plannedAt!)}`} · {m.status === 'berthed' ? '남은 체류' : '체류'} 예측 {m.predQ[3]?.toFixed(0)}시간 ({m.predQ[0]?.toFixed(0)}–{m.predQ[6]?.toFixed(0)})</span></div><div className="timeline-track"><span className="timeline-wait" style={{ left: pct(eta), width: pct(start - eta) }} /><span className="timeline-stay" style={{ left: pct(start), width: pct(lower - start) }} /><span className="timeline-band" style={{ left: pct(lower), width: pct(upper - lower) }} /><span className="timeline-tick median" style={{ left: pct(median) }} />{m.plannedAt && <span className="timeline-tick eta" style={{ left: pct(eta) }} />}{revealed && m.actualDepart && <span className="timeline-tick actual" title={`실제 출항 ${fmtDT(m.actualDepart)}`} style={{ left: pct(hour(m.actualDepart)) }} />}</div></div>
    })}<div className="timeline-row this-vessel"><div className="timeline-caption"><strong>{vessel} (이 항차)</strong><span>도착 예정 {fmtDT(a0)} → 권고 도착 {fmtDT(rta)}</span></div><div className="timeline-track"><span className="timeline-available" style={{ left: pct(hour(a0)), width: pct(maxDelayH) }} /><span className="timeline-tick eta" style={{ left: pct(hour(a0)) }} /><span className="timeline-dot" style={{ left: pct(animated.at(-1) ?? hour(rta)) }} /></div></div><div className="timeline-axis">{ticks.map(h => <span key={h} style={{ left: pct(h) }}>{fmtDT(t0 + h * 3600000)}</span>)}</div></div>
    <ul className="timeline-legend"><li><i className="stay" />접안 (최소 체류)</li><li><i className="waiting" />정박지 대기 (예상)</li><li><i className="band" />출항 예측 10–90%</li><li><i className="median" />출항 예측 중앙</li><li><i className="eta" />도착 예정</li><li><i className="rta" />권고 도착</li></ul>
  </section>
}
