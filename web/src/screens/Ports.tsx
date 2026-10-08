import { scaleLinear } from 'd3-scale'
import { useEffect, useMemo, useState } from 'react'
import { getPortState, hasServer } from '../api'
import { fmtDT, fmtT, fromLocalInput, ms, toLocalInput } from '../lib/time'
import { useWidth } from '../lib/useWidth'
import type { Action, AppState } from '../state'
import type { BerthOcc, PortState } from '../types'

const PORTS = ['울산', '대산', '광양', '여천']
const SRC: Record<string, string> = { history: '이력', declared: '출항 예정 신고', live: '입항 신고', 'live+position': '위치로 확인', pre: '사전 신고', final: '최종 신고' }

export default function Ports({ state, dispatch }: { state: AppState; dispatch: (a: Action) => void }) {
  const port = PORTS.includes(state.port) ? state.port : '울산'
  const [at, setAt] = useState<string | null>(null)
  const [ps, setPs] = useState<PortState | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getPortState(port, at ?? undefined).then((s) => {
      setPs(s)
      setLoading(false)
    })
  }, [port, at])

  return (
    <div className="screen ports">
      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="항만">
          {PORTS.map((p) => (
            <button key={p} role="tab" aria-selected={p === port} className={p === port ? 'on' : ''} onClick={() => dispatch({ type: 'port', port: p })}>
              {p}
            </button>
          ))}
        </div>
        <label className="small muted at-pick">
          시각{' '}
          <input type="datetime-local" value={at ? toLocalInput(at) : ''} min="2025-10-01T00:00" onChange={(e) => setAt(e.target.value ? fromLocalInput(e.target.value) : null)} disabled={!hasServer()} />
          <button className="btn" onClick={() => setAt(null)} disabled={!at}>
            지금
          </button>
        </label>
        {!hasServer() && <span className="small muted">이 배포본은 오른쪽 위 기준 시각의 항만 상태로 고정되어 있습니다.</span>}
      </div>
      {loading && <p className="muted">불러오는 중</p>}
      {!loading && !ps && <p className="notice">이 시각의 상태를 불러오지 못했습니다.</p>}
      {ps && !loading && <PortView ps={ps} onDecide={(id) => dispatch({ type: 'openLive', port, shipId: id })} />}
    </div>
  )
}

function PortView({ ps, onDecide }: { ps: PortState; onDecide: (id: string) => void }) {
  const pre = ps.inbound.filter((i) => i.source === 'pre').length
  const decidable = ps.inbound.filter((i) => i.targetKey)
  return (
    <>
      <div className="summary-strip num">
        <div>
          <strong>{ps.berths.length}</strong>
          <span className="small muted">척 접안 중 (예측 대상 선석 {ps.singleBerths.length}곳)</span>
        </div>
        <div>
          <strong>{ps.anchorage.length}</strong>
          <span className="small muted">척 정박지 대기</span>
        </div>
        <div>
          <strong>{ps.inbound.length}</strong>
          <span className="small muted">척 5일 안 입항 예정{ps.live ? ` (사전 신고 ${pre})` : ''}</span>
        </div>
        {ps.live && ps.port === '울산' && (
          <div>
            <strong>{ps.shiftedByPosition}</strong>
            <span className="small muted">척 위치로 선석 이동 확인</span>
          </div>
        )}
        <div className="small muted">
          {ps.live ? `기준 ${fmtDT(ps.at)} · 수집 반영 ${fmtDT(ps.updatedAt)}` : `과거 시각 ${fmtDT(ps.at)} (이력 재구성)`}
        </div>
      </div>

      <section className="panel">
        <h3>선석 점유</h3>
        <BerthBoard ps={ps} />
      </section>

      <div className="two-col">
        <section className="panel">
          <h3>입항 예정</h3>
          <p className="small muted">예측 대상 선석으로 신고된 배는 바로 권고를 볼 수 있습니다 ({decidable.length}척).</p>
          <div className="table-scroll">
            <table className="data-table small num">
              <thead>
                <tr>
                  <th>도착 예정</th>
                  <th>선박</th>
                  <th>선종</th>
                  <th>총톤수</th>
                  <th>신고 계선시설</th>
                  <th>출처</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ps.inbound.slice(0, 120).map((i) => (
                  <tr key={i.id}>
                    <td>{fmtDT(i.eta)}</td>
                    <td>{i.vessel}</td>
                    <td>{i.kind}</td>
                    <td>{i.gt?.toLocaleString('ko-KR') ?? '-'}</td>
                    <td>{i.facility}</td>
                    <td>{SRC[i.source] ?? i.source}</td>
                    <td>{i.targetKey && ps.live ? <button className="link" onClick={() => onDecide(i.id)}>권고 보기</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <h3>정박지 대기</h3>
          <div className="table-scroll">
            <table className="data-table small num">
              <thead>
                <tr>
                  <th>선박</th>
                  <th>정박지 도착</th>
                  <th>대기</th>
                  <th>목적 선석</th>
                </tr>
              </thead>
              <tbody>
                {ps.anchorage.map((w) => (
                  <tr key={`${w.callsign}-${w.since}-${w.vessel}`}>
                    <td>{w.vessel}</td>
                    <td>{fmtDT(w.since)}</td>
                    <td>{w.waitedH.toFixed(0)}시간</td>
                    <td>{w.targetBerth ? `${w.targetBerth} (${SRC[w.source] ?? w.source})` : <span className="muted">공개 신고에 없음</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {ps.positions.length > 0 && (
        <section className="panel">
          <h3>울산항 선박 위치</h3>
          <PortMap ps={ps} />
        </section>
      )}
    </>
  )
}

function BerthBoard({ ps }: { ps: PortState }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const at = ms(ps.at)
  const byKey = useMemo(() => {
    const m = new Map<string, BerthOcc[]>()
    ps.berths.forEach((b) => m.set(b.berthKey, [...(m.get(b.berthKey) ?? []), b]))
    return m
  }, [ps])
  const rows = ps.singleBerths
  const left = 150
  const x = scaleLinear().domain([-48, 96]).range([left, width - 8]).clamp(true)
  const rowH = 22
  const H = rows.length * rowH + 28
  return (
    <div ref={ref} className="board">
      <svg width={width} height={H} role="img" aria-label="선석별 점유와 남은 체류 예측">
        {[-48, -24, 0, 24, 48, 72, 96].map((h) => (
          <g key={h}>
            <line className={h === 0 ? 'now' : 'grid'} x1={x(h)} x2={x(h)} y1={0} y2={H - 20} />
            <text className="axis" x={x(h)} y={H - 6} textAnchor="middle">
              {h === 0 ? (ps.live ? '지금' : fmtT(at)) : `${h > 0 ? '+' : ''}${h}h`}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const occ = byKey.get(r.key) ?? []
          const y = i * rowH + 4
          return (
            <g key={r.key} transform={`translate(0,${y})`}>
              <text className="row-label" x={0} y={13}>
                {r.name}
              </text>
              {occ.length === 0 && (
                <text className="empty" x={left + 4} y={13}>
                  비어 있음
                </text>
              )}
              {occ.map((b, j) => {
                const h0 = -b.elapsedH
                const [lo, , , med, , , hi] = b.predQ
                return (
                  <g key={`${b.callsign}-${j}`}>
                    <title>{`${b.vessel} · 접안 ${fmtDT(b.since)} · 남은 체류 예측 ${med.toFixed(0)}시간 (${lo.toFixed(0)}~${hi.toFixed(0)})${b.declaredDepart ? ` · 출항 예정 신고 ${fmtDT(b.declaredDepart)}` : ''}${b.actualDepart ? ` · 실제 출항 ${fmtDT(b.actualDepart)}` : ''}`}</title>
                    <rect className="occ" x={x(h0)} width={Math.max(2, x(0) - x(h0))} y={3} height={12} rx={2} />
                    <rect className="pred-range" x={x(lo)} width={Math.max(2, x(hi) - x(lo))} y={5} height={8} rx={2} />
                    <line className="pred-med" x1={x(med)} x2={x(med)} y1={1} y2={17} />
                    {b.declaredDepart && <circle className="declared" cx={x((ms(b.declaredDepart) - at) / 3600000)} cy={9} r={3.5} />}
                    {b.actualDepart && <circle className="actual" cx={x((ms(b.actualDepart) - at) / 3600000)} cy={9} r={3.5} />}
                    <text className="occ-label" x={Math.min(x(med) + 6, width - 120)} y={13}>
                      {b.vessel}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
      <ul className="fan-legend small">
        <li><span className="k k-occ" />접안 후 경과</li>
        <li><span className="k k-band" />남은 체류 예측 10~90%</li>
        <li><span className="k k-rta" style={{ borderColor: 'var(--band)' }} />예측 중앙</li>
        <li><span className="k k-dot-decl" />출항 예정 신고</li>
        {!ps.live && <li><span className="k k-dot-act" />실제 출항</li>}
      </ul>
    </div>
  )
}

function PortMap({ ps }: { ps: PortState }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const pts = ps.positions.filter((p) => p.lat && p.lon)
  const berthed = new Set(ps.berths.map((b) => b.callsign))
  const waiting = new Set(ps.anchorage.map((w) => w.callsign))
  const lats = pts.map((p) => p.lat)
  const lons = pts.map((p) => p.lon)
  const [la0, la1] = [Math.min(...lats), Math.max(...lats)]
  const [lo0, lo1] = [Math.min(...lons), Math.max(...lons)]
  const k = Math.cos(((la0 + la1) / 2) * (Math.PI / 180))
  const H = 360
  const sx = (width - 20) / ((lo1 - lo0) * k || 1)
  const sy = (H - 20) / (la1 - la0 || 1)
  const s = Math.min(sx, sy)
  const X = (lon: number) => 10 + (lon - lo0) * k * s
  const Y = (lat: number) => H - 10 - (lat - la0) * s
  return (
    <div ref={ref} className="map">
      <svg width={width} height={H} role="img" aria-label="울산항 항내 선박 위치">
        {pts.map((p, i) => {
          const cls = berthed.has(p.callsign) ? 'berthed' : waiting.has(p.callsign) ? 'waiting' : p.sog > 1 ? 'moving' : 'other'
          return (
            <circle key={`${p.callsign}-${p.t}-${i}`} className={`ship ${cls}`} cx={X(p.lon)} cy={Y(p.lat)} r={cls === 'other' || cls === 'moving' ? 2.5 : 4}>
              <title>{`${p.name} · ${p.sog?.toFixed(1)}노트 · ${fmtDT(p.t)}`}</title>
            </circle>
          )
        })}
      </svg>
      <ul className="fan-legend small">
        <li><span className="k k-dot-ink" />예측 대상 선석에 접안</li>
        <li><span className="k k-dot-wait" />정박지 대기 (입항 신고 기준)</li>
        <li><span className="k k-dot-other" />그 밖의 선박</li>
      </ul>
    </div>
  )
}
