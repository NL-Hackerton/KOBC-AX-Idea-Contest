import { scaleLinear } from 'd3-scale'
import { useState, type Ref } from 'react'
import { useWidth } from '../lib/useWidth'
import { fmtDT, ms } from '../lib/time'
import type { QueueMember } from '../types'

const STATUS = {
  berthed: '접안 중',
  waiting: '정박지 대기',
  planned: '도착 예정',
} as const

const SOURCE: Record<string, string> = {
  history: '',
  declared: '신고',
  live: '실시간',
  'live+position': '위치 보정',
  user: '직접 입력',
  pre: '사전 신고',
  final: '최종 신고',
  state: '',
}

const INSET = { l: 36, r: 8 }

export interface QueueCurrent {
  vessel: string
  a0: string
  rta: string | null
}

export default function QueuePanel({
  queue,
  busy,
  berth,
  revealed,
  tau,
  windowH,
  current,
  loading,
}: {
  queue: QueueMember[]
  busy: boolean
  berth: string
  revealed: boolean
  tau: string
  windowH: [number, number]
  current?: QueueCurrent
  loading?: boolean
}) {
  const [plot, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const t0 = ms(tau)
  const x = scaleLinear().domain(windowH).range([INSET.l, Math.max(INSET.l + 10, width - INSET.r)])
  const hOf = (iso: string | null | undefined) => (iso ? (ms(iso) - t0) / 3600000 : null)

  return (
    <section className="panel queue-panel" aria-label="선석 대기열" aria-busy={loading || undefined}>
      <header className="panel-head">
        <h3>
          선석 대기열 <span className="muted">· {berth}</span>
        </h3>
        <span className="small muted">시간축은 아래 그래프와 같음</span>
      </header>
      {!loading && !busy && queue.length === 0 && <p className="muted small q-empty">결정 시각에 이 선석은 비어 있습니다. 앞 순번 배도 없습니다.</p>}
      {loading ? (
        <div className="q-loading" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div className="q-row is-loading" key={i}>
              <div className="q-copy">
                <div className="skel skel-sm" />
                <div className="skel skel-xs" />
              </div>
              <div className="skel skel-bar" />
            </div>
          ))}
        </div>
      ) : (
        <div className="q-list" role="list">
          {queue.map((m, i) => (
            <QueueRow
              key={`${m.callsign}-${m.vessel}-${i}`}
              m={m}
              x={x}
              width={width}
              revealed={revealed}
              hover={hover === i}
              onHover={(v) => setHover(v ? i : null)}
              startH={startHour(m, hOf)}
              trackRef={i === 0 ? plot : undefined}
            />
          ))}
          {current && (
            <div className="q-row is-selected" role="listitem" onMouseEnter={() => setHover(-1)} onMouseLeave={() => setHover(null)}>
              <div className="q-copy">
                <div className="q-head">
                  <span className="q-name">{current.vessel || '이 항차'}</span>
                  <span className="q-tag">이 항차</span>
                </div>
                <p className="q-meta small muted num">
                  도착 예정 {fmtDT(current.a0)}
                  {current.rta ? ` → 권고 도착 ${fmtDT(current.rta)}` : ''}
                </p>
              </div>
              <div className="q-track-wrap" ref={queue.length === 0 ? plot : undefined}>
                <svg className="q-track" width={width} height={36} aria-hidden>
                  {width > 0 && <CurrentBar x={x} a0={hOf(current.a0)} rta={current.rta ? hOf(current.rta) : null} width={width} />}
                </svg>
              </div>
            </div>
          )}
        </div>
      )}
      <ul className="fan-legend small q-legend">
        <li><span className="k k-occ" />정박지 대기</li>
        <li><span className="k k-band" />체류 예측 범위</li>
        <li><span className="k k-rta" />체류 중앙</li>
        <li><span className="k k-a0" />도착 예정</li>
        <li><span className="k k-dot-ink" />권고 도착</li>
      </ul>
    </section>
  )
}

function startHour(m: QueueMember, hOf: (iso: string | null | undefined) => number | null) {
  if (m.status === 'berthed' && m.elapsedH != null) return -m.elapsedH
  if (m.status === 'waiting' && m.arrivedAt) return hOf(m.arrivedAt) ?? 0
  if (m.status === 'planned' && m.plannedAt) return hOf(m.plannedAt) ?? 0
  return 0
}

function QueueRow({
  m,
  x,
  width,
  revealed,
  hover,
  onHover,
  startH,
  trackRef,
}: {
  m: QueueMember
  x: (n: number) => number
  width: number
  revealed: boolean
  hover: boolean
  onHover: (v: boolean) => void
  startH: number
  trackRef?: Ref<HTMLDivElement>
}) {
  const s = STATUS[m.status]
  const med = m.predQ[3] ?? m.predQ[Math.floor(m.predQ.length / 2)] ?? 0
  const lo = m.predQ[0] ?? med
  const hi = m.predQ[m.predQ.length - 1] ?? med
  return (
    <div className={`q-row q-${m.status}${hover ? ' is-hover' : ''}`} role="listitem" onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <div className="q-copy">
        <div className="q-head">
          <span className="q-name">{m.vessel || m.callsign}</span>
          <span className="q-status small muted">
            {s}
            {m.source && SOURCE[m.source] ? ` · ${SOURCE[m.source]}` : ''}
          </span>
        </div>
        <p className="q-meta small muted num">
          {m.status === 'berthed' && m.elapsedH != null && <>접안 후 {m.elapsedH.toFixed(0)}시간 · </>}
          {m.status === 'waiting' && m.arrivedAt && <>정박지 도착 {fmtDT(m.arrivedAt)} · </>}
          {m.status === 'planned' && m.plannedAt && <>도착 예정 {fmtDT(m.plannedAt)} · </>}
          {m.status === 'berthed' ? '남은 체류' : '체류'} 예측 {med.toFixed(0)}시간 ({lo.toFixed(0)}~{hi.toFixed(0)})
        </p>
        {revealed && m.actualDepart && <p className="q-actual small num">실제 출항 {fmtDT(m.actualDepart)}</p>}
      </div>
      <div className="q-track-wrap" ref={trackRef}>
        <svg className="q-track" width={width} height={36} aria-hidden>
          {width > 0 && (
            <>
              <line className="q-base" x1={INSET.l} x2={width - INSET.r} y1={18} y2={18} />
              {m.status !== 'planned' && startH < 0 && <rect className="q-past" x={x(startH)} width={Math.max(2, x(0) - x(startH))} y={12} height={12} rx={3} />}
              <rect className="q-range" x={x(startH + lo)} width={Math.max(2, x(startH + hi) - x(startH + lo))} y={13} height={10} rx={3} />
              <rect className="q-med" x={x(startH + med) - 1.5} width={3} height={18} y={9} rx={1} />
            </>
          )}
        </svg>
      </div>
    </div>
  )
}

function CurrentBar({ x, a0, rta, width }: { x: (n: number) => number; a0: number | null; rta: number | null; width: number }) {
  return (
    <>
      <line className="q-base" x1={INSET.l} x2={Math.max(INSET.l, width - INSET.r)} y1={18} y2={18} />
      {a0 != null && rta != null && <rect className="q-delay" x={x(Math.min(a0, rta))} width={Math.max(2, Math.abs(x(rta) - x(a0)))} y={14} height={8} rx={3} />}
      {a0 != null && <circle className="q-eta" cx={x(a0)} cy={18} r={4} />}
      {rta != null && <circle className="q-rta" cx={x(rta)} cy={18} r={5} />}
    </>
  )
}
