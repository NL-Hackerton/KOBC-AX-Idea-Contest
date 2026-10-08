import { scaleLinear } from 'd3-scale'
import { useEffect, useState } from 'react'
import { getSimGrid, hasServer, postSimulate } from '../api'
import Segmented from '../components/Segmented'
import { useWidth } from '../lib/useWidth'
import type { Condition } from '../types'

interface SimResult {
  periodKey?: string
  port: string
  condition: Condition
  risk: number
  participation: number
  outOfSample: boolean
  cases: number
  participants: number
  waitNowH: number
  residualWaitH: number
  delayH: number
  fuelT: number
  co2T: number
  upperFuelT: number
  upperCo2T: number
  shareOfUpper: number
  extraIdleH: number
  lateOver2h: number
  berths: number
  utilBefore: number
  utilAfter: number
  delayHist: { edges: number[]; counts: number[] }
  byBerth?: { berth: string; cases: number; wait_h: number; resid_h: number; delay_h: number; fuel_t: number; idle_h: number }[]
}

interface Grid {
  periods: Record<string, [string, string]>
  participation: number[]
  rows: SimResult[]
}

const PORTS = ['전체', '울산', '대산', '광양', '여천']
const COND: { value: Condition; label: string; color: string }[] = [
  { value: 'public', label: '공개 데이터만', color: '#86b6ef' },
  { value: 'lineup', label: '대기 순번 공유', color: '#3987e5' },
  { value: 'plan', label: '선석계획 공유', color: '#1c5cab' },
]
const RISKS = [0.1, 0.2, 0.3, 0.5]

export default function Simulate() {
  const [grid, setGrid] = useState<Grid | null>(null)
  const [port, setPort] = useState('전체')
  const [period, setPeriod] = useState<'test' | 'year'>('test')
  const [cond, setCond] = useState<Condition>('plan')
  const [risk, setRisk] = useState(0.1)
  const [part, setPart] = useState(100)
  const [custom, setCustom] = useState<SimResult | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    getSimGrid<Grid>().then(setGrid)
  }, [])

  const find = (c: Condition, r: number, p: number) =>
    grid?.rows.find((x) => x.periodKey === period && x.port === port && x.condition === c && x.risk === r && Math.abs(x.participation - p) < 1e-9)

  const onGrid = [25, 50, 100].includes(part)
  useEffect(() => {
    setCustom(null)
    if (onGrid || !grid || !hasServer()) return
    const [start, end] = grid.periods[period]
    setPending(true)
    const t = setTimeout(() => {
      postSimulate<SimResult>({ port, start, end, condition: cond, risk, participation: part / 100 }).then((r) => {
        setCustom(r)
        setPending(false)
      })
    }, 250)
    return () => clearTimeout(t)
  }, [port, period, cond, risk, part, onGrid, grid])

  const res = onGrid ? find(cond, risk, part / 100) : custom
  const full = find(cond, risk, 1)
  if (!grid) return <p className="muted">시뮬레이터 결과를 불러오는 중</p>
  const [ps, pe] = grid.periods[period]

  return (
    <div className="screen simulate">
      <p className="lead">
        지난 기록 전체에 K-JIT 권고를 적용하면 무엇이 달라지는지 계산합니다. 정박지를 거쳐 선석에 들어간 화물선 항차마다, 결정 시각에 알 수 있었던 정보만으로 도착 시각을 정합니다.
      </p>
      <div className="toolbar">
        <Segmented label="항만" value={port} options={PORTS.map((p) => ({ value: p, label: p, hint: p === '전체' ? '9개 항만 기록 전체 (예측 대상 선석)' : undefined }))} onChange={setPort} />
        <Segmented
          label="기간"
          value={period}
          options={[
            { value: 'test', label: '2026-08~09', hint: '모델 학습·보정에 쓰지 않은 표본 밖 기간' },
            { value: 'year', label: '1년', hint: '2025-10~2026-09. 2026-07 이전은 학습·보정 기간이라 낙관적일 수 있음' },
          ]}
          onChange={setPeriod}
        />
      </div>
      <div className="toolbar">
        <Segmented label="정보 조건" value={cond} options={COND.map((c) => ({ value: c.value, label: c.label }))} onChange={setCond} />
        <Segmented label="위험 수준" value={String(risk)} options={RISKS.map((r) => ({ value: String(r), label: String(r) }))} onChange={(v) => setRisk(Number(v))} />
        <label className="seg-wrap">
          <span className="seg-label small muted">참여율 {part}%</span>
          <input type="range" min={5} max={100} step={5} value={part} onChange={(e) => setPart(Number(e.target.value))} aria-label="참여율" />
          <span className="small muted">{onGrid ? '미리 계산한 값' : hasServer() ? (pending ? '서버에서 계산 중' : '서버 계산') : '25·50·100%만 저장본에 있음'}</span>
        </label>
      </div>

      {res ? (
        <>
          <div className="stat-row num">
            <Stat label="절감 연료" value={`${res.fuelT.toLocaleString('ko-KR')} t`} sub={`CO2 ${res.co2T.toLocaleString('ko-KR')} t`} />
            <Stat label="완전 정보 상한 대비" value={`${res.shareOfUpper.toFixed(0)}%`} sub={`상한 연료 ${res.upperFuelT.toLocaleString('ko-KR')} t`} />
            <Stat label="정박지 대기" value={`${Math.round(res.waitNowH).toLocaleString('ko-KR')} → ${Math.round(res.residualWaitH).toLocaleString('ko-KR')}시간`} sub={`감속으로 바꾼 시간 ${Math.round(res.delayH).toLocaleString('ko-KR')}시간`} />
            <Stat label="늦게 도착해 생긴 선석 유휴" value={`${res.extraIdleH.toFixed(0)}시간`} sub={`2시간 넘게 늦은 항차 ${res.lateOver2h}건`} />
            <Stat label="선석 이용률" value={`${res.utilBefore.toFixed(1)}% → ${res.utilAfter.toFixed(1)}%`} sub={`단일 접안 선석 ${res.berths}곳`} />
          </div>
          <p className="small muted">
            {ps}~{pe} 정박지→선석 화물선 {res.cases.toLocaleString('ko-KR')}항차 중 {res.participants.toLocaleString('ko-KR')}항차 참여. {res.outOfSample ? '표본 밖 기간입니다.' : '학습·보정 기간이 섞여 있어 표본 밖 기간보다 낙관적일 수 있습니다.'} 한 배가 늦게 와서 다음 배가 당겨지는 상호작용은 반영하지 않았습니다.
          </p>
          <section className="panel">
            <h3>정보 조건과 위험 수준에 따른 절감 (참여율 {part === 100 || !onGrid ? 100 : part}%)</h3>
            <LadderChart rows={COND.flatMap((c) => RISKS.map((r) => ({ c, r, x: find(c.value, r, onGrid ? part / 100 : 1) })))} sel={{ cond, risk }} />
          </section>
          <div className="two-col">
            <section className="panel">
              <h3>참여 항차의 늦춤 시간 분포</h3>
              <Hist h={res.delayHist} />
            </section>
            <section className="panel">
              <h3>선석별 결과 (절감 상위 15, 참여율 100%)</h3>
              <div className="table-scroll">
                <table className="data-table small num">
                  <thead>
                    <tr>
                      <th>선석</th>
                      <th>항차</th>
                      <th>대기</th>
                      <th>남은 대기</th>
                      <th>연료</th>
                      <th>추가 유휴</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(res.byBerth ?? full?.byBerth ?? []).map((b) => (
                      <tr key={b.berth}>
                        <td>{b.berth}</td>
                        <td>{b.cases}</td>
                        <td>{Math.round(b.wait_h)}h</td>
                        <td>{Math.round(b.resid_h)}h</td>
                        <td>{b.fuel_t.toFixed(1)} t</td>
                        <td>{b.idle_h.toFixed(1)}h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      ) : (
        <p className="muted">{pending ? '계산 중' : '이 조합의 결과가 없습니다.'}</p>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <p className="small muted">{label}</p>
      <p className="stat-v">{value}</p>
      {sub && <p className="small muted">{sub}</p>}
    </div>
  )
}

function LadderChart({ rows, sel }: { rows: { c: (typeof COND)[number]; r: number; x?: SimResult }[]; sel: { cond: Condition; risk: number } }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const H = 240
  const M = { l: 44, r: 10, t: 22, b: 40 }
  const y = scaleLinear().domain([0, 100]).range([H - M.b, M.t])
  const groupW = (width - M.l - M.r) / RISKS.length
  const barW = Math.min(24, (groupW - 24) / 3)
  const [tip, setTip] = useState<string | null>(null)
  return (
    <div ref={ref}>
      <svg width={width} height={H} role="img" aria-label="정보 조건과 위험 수준별 완전 정보 상한 대비 절감">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line className="grid-line" x1={M.l} x2={width - M.r} y1={y(v)} y2={y(v)} />
            <text className="axis-t" x={M.l - 6} y={y(v) + 4} textAnchor="end">
              {v}%
            </text>
          </g>
        ))}
        {RISKS.map((r, gi) => {
          const gx = M.l + gi * groupW + (groupW - barW * 3 - 4) / 2
          return (
            <g key={r}>
              <text className="axis-t" x={M.l + gi * groupW + groupW / 2} y={H - M.b + 18} textAnchor="middle">
                위험 수준 {r}
              </text>
              {COND.map((c, ci) => {
                const row = rows.find((x) => x.c.value === c.value && x.r === r)?.x
                if (!row) return null
                const v = row.shareOfUpper
                const bx = gx + ci * (barW + 2)
                const top = y(v)
                const on = sel.cond === c.value && sel.risk === r
                const h = y(0) - top
                return (
                  <g
                    key={c.value}
                    tabIndex={0}
                    onPointerEnter={() => setTip(`${c.label}, 위험 수준 ${r}: 상한 대비 ${v.toFixed(0)}%, 연료 ${row.fuelT.toLocaleString('ko-KR')} t, 추가 유휴 ${row.extraIdleH.toFixed(0)}시간`)}
                    onFocus={() => setTip(`${c.label}, 위험 수준 ${r}: 상한 대비 ${v.toFixed(0)}%, 연료 ${row.fuelT.toLocaleString('ko-KR')} t, 추가 유휴 ${row.extraIdleH.toFixed(0)}시간`)}
                    onPointerLeave={() => setTip(null)}
                  >
                    <rect x={bx - 2} y={M.t} width={barW + 4} height={H - M.b - M.t} fill="transparent" />
                    <path d={`M${bx},${y(0)} V${top + 4} q0,-4 4,-4 h${barW - 8} q4,0 4,4 V${y(0)} Z`} fill={c.color} opacity={on ? 1 : 0.85} stroke={on ? 'var(--ink)' : 'none'} strokeWidth={on ? 1.5 : 0} />
                    {h > 0 && (
                      <text className="bar-v" x={bx + barW / 2} y={top - 4} textAnchor="middle">
                        {v.toFixed(0)}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}
        <line className="base-line" x1={M.l} x2={width - M.r} y1={y(0)} y2={y(0)} />
      </svg>
      <ul className="fan-legend small">
        {COND.map((c) => (
          <li key={c.value}>
            <span className="k" style={{ background: c.color, borderRadius: 2 }} />
            {c.label}
          </li>
        ))}
        <li className="muted">막대 위 숫자: 완전 정보 상한 대비 절감 %</li>
      </ul>
      <p className="small muted fan-readout" aria-live="polite">{tip ?? '막대에 마우스를 올리면 연료와 추가 선석 유휴를 볼 수 있습니다.'}</p>
    </div>
  )
}

function Hist({ h }: { h: { edges: number[]; counts: number[] } }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const H = 180
  const M = { l: 36, r: 8, t: 16, b: 34 }
  const max = Math.max(1, ...h.counts)
  const y = scaleLinear().domain([0, max]).nice().range([H - M.b, M.t])
  const labels = h.edges.map((e, i) => (i < h.edges.length - 1 ? `${e}~${h.edges[i + 1]}` : `${e}+`))
  const bw = (width - M.l - M.r) / h.counts.length
  const barW = Math.min(24, bw - 6)
  return (
    <div ref={ref}>
      <svg width={width} height={H} role="img" aria-label="늦춤 시간 분포">
        {y.ticks(4).map((v) => (
          <g key={v}>
            <line className="grid-line" x1={M.l} x2={width - M.r} y1={y(v)} y2={y(v)} />
            <text className="axis-t" x={M.l - 6} y={y(v) + 4} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {h.counts.map((c, i) => {
          const x = M.l + i * bw + (bw - barW) / 2
          const top = y(c)
          return (
            <g key={i}>
              {c > 0 && <path d={`M${x},${y(0)} V${top + 4} q0,-4 4,-4 h${barW - 8} q4,0 4,4 V${y(0)} Z`} fill="var(--rta)" opacity={0.85} />}
              <text className="bar-v" x={x + barW / 2} y={top - 4} textAnchor="middle">
                {c}
              </text>
              <text className="axis-t" x={x + barW / 2} y={H - M.b + 16} textAnchor="middle">
                {labels[i]}
              </text>
            </g>
          )
        })}
        <line className="base-line" x1={M.l} x2={width - M.r} y1={y(0)} y2={y(0)} />
        <text className="axis-t" x={width - M.r} y={H - 4} textAnchor="end">
          늦춤(시간)
        </text>
      </svg>
    </div>
  )
}
