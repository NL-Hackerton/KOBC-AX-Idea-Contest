import { scaleLinear } from 'd3-scale'
import { useEffect, useMemo, useState } from 'react'
import { getPortState, hasServer } from '../api'
import HarborMap from '../components/HarborMap'
import { IconAnchor, IconClock, IconPin, IconShip } from '../components/Icons'
import KpiCard from '../components/KpiCard'
import PageHeader from '../components/PageHeader'
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
  const [selected, setSelected] = useState<string | null>(null)
  const [pickTime, setPickTime] = useState(false)

  useEffect(() => {
    setLoading(true)
    getPortState(port, at ?? undefined).then((s) => {
      setPs(s)
      setSelected(s?.inbound.find((i) => i.targetKey)?.id ?? s?.inbound[0]?.id ?? null)
      setLoading(false)
    })
  }, [port, at])

  const decidable = ps?.inbound.filter((i) => i.targetKey).length ?? 0
  return (
    <div className="screen ports">
      <PageHeader
        title="항만 현황"
        lede={ps ? `기준 ${fmtDT(ps.at)} · 수집 반영 ${fmtDT(ps.updatedAt)}` : '항만 상태를 불러오는 중'}
        extra={
          <div className="page-extra">
            {hasServer() && (pickTime || at ? (
              <label className="at-pick">
                시각
                <input type="datetime-local" value={at ? toLocalInput(at) : ''} min="2025-10-01T00:00" onChange={(e) => setAt(e.target.value ? fromLocalInput(e.target.value) : null)} />
                <button type="button" className="btn" onClick={() => { setAt(null); setPickTime(false) }}>
                  지금
                </button>
              </label>
            ) : (
              <button type="button" className="btn" onClick={() => setPickTime(true)}>시각</button>
            ))}
          <div className="seg port-tabs" role="tablist" aria-label="항만">
            {PORTS.map((p) => (
              <button key={p} type="button" role="tab" aria-selected={p === port} className={p === port ? 'on' : ''} onClick={() => dispatch({ type: 'port', port: p })}>
                {p}
              </button>
            ))}
          </div>
          </div>
        }
      />

      <section className="panel map-panel" aria-label="항만 해도">
        {loading && <div className="skel skel-map" />}
        {!loading && !ps && <p className="notice">이 시각의 상태를 불러오지 못했습니다.</p>}
        {ps && !loading && ps.positions.length > 0 && (
          <HarborMap ps={ps} selectedId={selected} onSelect={setSelected} onDecide={(id) => dispatch({ type: 'openLive', port, shipId: id })} />
        )}
        {ps && !loading && ps.positions.length === 0 && (
          <div className="map-empty">
            <p>이 항만은 저장본에 선박 위치가 없습니다.</p>
            <p className="small muted">TODO: 위치 수집은 울산항만공사 항내 선박위치만 연결되어 있습니다. 대산·광양·여천 점은 데이터가 생기면 같은 해도에 올립니다.</p>
          </div>
        )}
      </section>

      <div className="kpi-row">
        <KpiCard icon={<IconAnchor size={16} />} label="접안 중" value={ps ? ps.berths.length : '—'} unit="척" sub={ps ? `예측 대상 선석 ${ps.singleBerths.length}곳` : ''} loading={loading} />
        <KpiCard icon={<IconClock size={16} />} label="정박지 대기" value={ps ? ps.anchorage.length : '—'} unit="척" sub="입항 신고 기준" loading={loading} />
        <KpiCard
          icon={<IconShip size={16} />}
          label="5일 안 입항 예정"
          value={ps ? ps.inbound.length : '—'}
          unit="척"
          sub={ps ? `사전 신고 ${ps.inbound.filter((i) => i.source === 'pre').length}` : ''}
          loading={loading}
        />
        <KpiCard
          icon={<IconPin size={16} />}
          label="선석 이동 확인"
          value={ps && ps.port === '울산' ? ps.shiftedByPosition : '—'}
          unit={ps && ps.port === '울산' ? '척' : undefined}
          sub={ps && ps.port === '울산' ? '위치로 확인' : '위치 데이터 없음'}
          empty={!ps || ps.port !== '울산'}
          loading={loading}
        />
      </div>

      {ps && !loading && (
        <>
          <div className="ports-split">
            <section className="panel">
              <header className="panel-head">
                <h3>선석 점유</h3>
                <span className="small muted">기준 {fmtDT(ps.at)}</span>
              </header>
              <p className="small muted">선석별 점유와 남은 체류 예측</p>
              <BerthBoard ps={ps} />
            </section>
            <section className="panel inbound-panel">
              <header className="panel-head">
                <h3>입항 예정</h3>
                <span className="count-pill num">{decidable}척</span>
              </header>
              <p className="small muted">예측 대상 선석으로 신고된 배는 바로 권고를 볼 수 있습니다.</p>
              <ul className="inbound-list">
                {ps.inbound.slice(0, 120).map((i) => (
                  <li key={i.id} className={i.id === selected ? 'on' : ''}>
                    <button type="button" className="inbound-main" onClick={() => setSelected(i.id)}>
                      <span className="num inbound-time">{fmtDT(i.eta)}</span>
                      <strong>{i.vessel}</strong>
                      <span className="muted">
                        {i.facility} · {SRC[i.source] ?? i.source}
                        {i.gt ? ` · ${i.gt.toLocaleString('ko-KR')}톤` : ''}
                      </span>
                    </button>
                    {i.targetKey ? (
                      <button type="button" className="link-pill" onClick={() => dispatch({ type: 'openLive', port, shipId: i.id })}>
                        권고 보기
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <details className="panel anchorage-fold">
            <summary>
              정박지 대기 {ps.anchorage.length}척
            </summary>
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
          </details>
        </>
      )}
    </div>
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
  const rows = [...ps.singleBerths].sort((a, b) => ((byKey.get(a.key)?.length ?? 0) > 0 ? 0 : 1) - ((byKey.get(b.key)?.length ?? 0) > 0 ? 0 : 1))
  const left = 132
  const x = scaleLinear().domain([-48, 72]).range([left, Math.max(left + 40, width - 8)]).clamp(true)
  const rowH = 28
  const H = rows.length * rowH + 28
  return (
    <div ref={ref} className="board">
      <svg width={Math.max(width, 640)} height={H} role="img" aria-label="선석별 점유와 남은 체류 예측">
        {[-48, -24, 0, 24, 48, 72].map((h) => (
          <g key={h}>
            <line className={h === 0 ? 'now' : 'grid'} x1={x(h)} x2={x(h)} y1={0} y2={H - 22} />
            <text className="axis" x={x(h)} y={H - 6} textAnchor="middle">
              {h === 0 ? '지금' : `${h > 0 ? '+' : ''}${h}h`}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const occ = byKey.get(r.key) ?? []
          const y = i * rowH + 2
          return (
            <g key={r.key} transform={`translate(0,${y})`}>
              <text className="row-label" x={0} y={16}>
                {r.name}
              </text>
              {occ.length === 0 && (
                <text className="empty" x={left + 6} y={16}>
                  비어 있음
                </text>
              )}
              {occ.map((b, j) => {
                const h0 = -b.elapsedH
                const [lo, , , med, , , hi] = b.predQ
                return (
                  <g key={`${b.callsign}-${j}`}>
                    <title>{`${b.vessel} · 접안 ${fmtDT(b.since)} · 남은 체류 예측 ${med.toFixed(0)}시간 (${lo.toFixed(0)}~${hi.toFixed(0)})${b.declaredDepart ? ` · 출항 예정 신고 ${fmtDT(b.declaredDepart)}` : ''}${b.actualDepart ? ` · 실제 출항 ${fmtDT(b.actualDepart)}` : ''}`}</title>
                    <rect className="occ" x={x(h0)} width={Math.max(2, x(0) - x(h0))} y={6} height={10} rx={3} />
                    <rect className="pred-range" x={x(lo)} width={Math.max(2, x(hi) - x(lo))} y={6} height={10} rx={3} />
                    <line className="pred-med" x1={x(med)} x2={x(med)} y1={3} y2={19} />
                    {b.declaredDepart && <circle className="declared" cx={x((ms(b.declaredDepart) - at) / 3600000)} cy={11} r={3.5} />}
                    {b.actualDepart && <circle className="actual" cx={x((ms(b.actualDepart) - at) / 3600000)} cy={11} r={3.5} />}
                    <text className="occ-label" x={Math.min(x(med) + 8, width - 8)} y={16}>
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
        <li><span className="k k-band" />남은 체류 예측 10–90%</li>
        <li><span className="k k-rta" />예측 중앙</li>
        <li><span className="k k-dot-decl" />출항 예정 신고</li>
        {!ps.live && <li><span className="k k-dot-act" />실제 출항</li>}
      </ul>
      <p className="small faint">{ps.live ? `기준 ${fmtDT(ps.at)}` : `과거 시각 ${fmtT(at)} (이력 재구성)`}</p>
    </div>
  )
}
