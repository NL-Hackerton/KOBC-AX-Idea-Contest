import type { QueueMember } from '../types'
import { fmtDT } from '../lib/time'

const STATUS = {
  berthed: { mark: '●', label: '접안 중' },
  waiting: { mark: '○', label: '정박지 대기' },
  planned: { mark: '◌', label: '도착 예정' },
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

export default function QueuePanel({ queue, busy, berth, revealed }: { queue: QueueMember[]; busy: boolean; berth: string; revealed: boolean }) {
  return (
    <section className="panel queue" aria-label="선석 대기열">
      <h3>
        선석 대기열 <span className="muted small">{berth}</span>
      </h3>
      {!busy && queue.length === 0 && <p className="muted small">결정 시각에 이 선석은 비어 있습니다. 앞 순번 배도 없습니다.</p>}
      <ol className="queue-list">
        {queue.map((m, i) => {
          const s = STATUS[m.status]
          const med = m.predQ[3]
          return (
            <li key={`${m.callsign}-${i}`} className={`q-${m.status}`}>
              <div className="q-head">
                <span className="q-mark" aria-hidden>
                  {s.mark}
                </span>
                <span className="q-name">{m.vessel || m.callsign}</span>
                <span className="q-status small muted">
                  {s.label}
                  {m.source && SOURCE[m.source] ? ` · ${SOURCE[m.source]}` : ''}
                </span>
              </div>
              <div className="q-meta small muted num">
                {m.status === 'berthed' && m.elapsedH != null && <>접안 후 {m.elapsedH.toFixed(1)}시간 · </>}
                {m.status === 'waiting' && m.arrivedAt && <>정박지 도착 {fmtDT(m.arrivedAt)} · </>}
                {m.status === 'planned' && m.plannedAt && <>도착 예정 {fmtDT(m.plannedAt)} · </>}
                {m.status === 'berthed' ? '남은 체류' : '체류'} 예측 {med.toFixed(0)}시간 ({m.predQ[0].toFixed(0)}~{m.predQ[6].toFixed(0)})
              </div>
              {revealed && m.actualDepart && <div className="q-actual small num">실제 출항 {fmtDT(m.actualDepart)}</div>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
