import { scaleLinear } from 'd3-scale'
import { useEffect, useState } from 'react'
import { getSimGrid, hasServer, postSimulate } from '../api'
import Segmented from '../components/Segmented'
import { useWidth } from '../lib/useWidth'
import type { Condition } from '../types'
import { CardHead, CountUp, Kpi, PageHeader } from '../components/ui'
import { stagger, useTween } from '../lib/motion'
import '../styles/simulate.css'

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
  { value: 'public', label: '공개 데이터만', color: 'var(--sim-public)' },
  { value: 'lineup', label: '대기 순번 공유', color: 'var(--sim-lineup)' },
  { value: 'plan', label: '선석계획 공유', color: 'var(--sim-plan)' },
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

  const onGrid = (grid?.participation ?? [0.25, 0.5, 1]).some((p) => Math.abs(p * 100 - part) < 1e-9)
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

  const periodLabel = (key: string) => {
    const [start, end] = grid.periods[key]
    return start.slice(0, 4) === end.slice(0, 4) ? `${start.slice(0, 7)}~${end.slice(5, 7)}` : `${start.slice(0, 7)}~${end.slice(0, 7)}`
  }
  const chartPart = onGrid ? part : 100
  const berthRows = res?.byBerth ?? full?.byBerth ?? []
  const withinHour = res?.delayHist.counts[0] ?? 0
  return (
    <div className="screen simulate">
      <PageHeader title="항만 시뮬레이터" bodySub
        sub="지난 기록 전체에 K-JIT 권고를 적용하면 무엇이 달라지는지 계산합니다. 정박지를 거쳐 선석에 들어간 화물선 항차마다, 결정 시각에 알 수 있었던 정보만으로 도착 시각을 정합니다."
        right={<span className="badge">{period === 'test' ? '표본 밖' : '전체 기간'} · {periodLabel(period)}</span>} />
      <section className="card sim-controls enter" style={stagger(0)} aria-label="시뮬레이션 조건">
        <Segmented label="항만" value={port} options={PORTS.map((p) => ({ value: p, label: p, hint: p === '전체' ? '9개 항만 기록 전체 (예측 대상 선석)' : `${p}의 예측 대상 선석` }))} onChange={setPort} />
        <Segmented label="기간" value={period} options={[
          { value: 'test', label: periodLabel('test'), hint: '모델 학습·보정에 쓰지 않은 표본 밖 기간' },
          { value: 'year', label: '1년', hint: `${periodLabel('year')}. 학습·보정 기간을 포함합니다.` },
        ]} onChange={setPeriod} />
        <div className="sim-condition">
          <Segmented label="정보 조건" value={cond} options={COND.map((c) => ({ value: c.value, label: c.label }))} onChange={setCond} />
        </div>
        <Segmented label="위험 수준" value={String(risk)} options={RISKS.map((r) => ({ value: String(r), label: String(r) }))} onChange={(v) => setRisk(Number(v))} variant="primary" />
        <label className="seg-wrap sim-participation">
          <span className="seg-label small muted">참여율 <output>{part}%</output></span>
          <input type="range" min={hasServer() ? 5 : 25} max={100} step={hasServer() ? 5 : 25} value={part} onChange={(e) => setPart(Number(e.target.value))} aria-label="참여율" style={{ backgroundSize: `${(part - (hasServer() ? 5 : 25)) / (100 - (hasServer() ? 5 : 25)) * 100}% 100%` }} />
          <span className="small muted">{!hasServer() ? '배포본은 25% 단위로 미리 계산' : onGrid ? '미리 계산한 값' : pending ? '서버에서 계산 중입니다.' : '서버 계산'}</span>
        </label>
      </section>
      {res ? (
        <>
          <div className="sim-kpis">
            <Kpi label="절감 연료" value={res.fuelT} format={decimal} unit="t" sub={`CO2 ${decimal(res.co2T)} t`} />
            <Kpi label="완전 정보 상한 대비" value={res.shareOfUpper} format={(v) => `${Math.round(v)}%`} sub={`상한 연료 ${decimal(res.upperFuelT)} t`} />
            <Kpi label="정박지 대기" text={<><CountUp value={res.waitNowH} format={integer} /> → <CountUp value={res.residualWaitH} format={integer} /></>} unit="시간" sub={`감속으로 바꾼 시간 ${integer(res.delayH)}시간`} />
            <Kpi label="늦게 도착해 생긴 선석 유휴" value={res.extraIdleH} format={integer} unit="시간" sub={`2시간 넘게 늦은 항차 ${res.lateOver2h}건`} />
            <Kpi label="선석 이용률" text={<><CountUp value={res.utilBefore} format={(v) => `${v.toFixed(1)}%`} /> → <CountUp value={res.utilAfter} format={(v) => `${v.toFixed(1)}%`} /></>} sub={`단일 접안 선석 ${res.berths}곳`} />
          </div>
          <p className="small muted sim-note">
            {ps.slice(0, 7)}~{pe.slice(0, 7)} 정박지→선석 화물선 {integer(res.cases)}항차 중 {integer(res.participants)}항차 참여. {res.outOfSample ? '표본 밖 기간입니다.' : '학습·보정 기간이 섞여 있어 표본 밖 기간보다 낙관적일 수 있습니다.'} 한 배가 늦게 와서 다음 배가 당겨지는 상호작용은 반영하지 않았습니다.
          </p>
          <section className="card sim-ladder enter" style={stagger(2)}>
            <CardHead title={`정보 조건과 위험 수준에 따른 절감 (참여율 ${chartPart}%)`} right={<span className="small muted">완전 정보 상한 대비 절감 %</span>} />
            <LadderChart rows={COND.flatMap((c) => RISKS.map((r) => ({ c, r, x: find(c.value, r, chartPart / 100) })))} sel={{ cond, risk }} />
          </section>
          <div className="sim-bottom">
            <section className="card sim-hist enter" style={stagger(3)}>
              <CardHead title="참여 항차의 늦춤 시간 분포" />
              <Hist h={res.delayHist} />
              <div className="sim-hist-stats">
                <div><span>늦춤 합계</span><strong><CountUp value={res.delayH} format={integer} />시간</strong></div>
                <div><span>항차당 평균</span><strong><CountUp value={res.participants ? res.delayH / res.participants : 0} format={(v) => v.toFixed(1)} />시간</strong></div>
                <div><span>1시간 안쪽</span><strong><CountUp value={res.participants ? withinHour / res.participants * 100 : 0} format={integer} />%</strong></div>
              </div>
              <p className="small muted">{integer(res.participants)}항차 중 {integer(withinHour)}항차는 1시간 안쪽으로 늦춥니다.</p>
            </section>
            <section className="card sim-berths enter" style={stagger(4)}>
              <CardHead title={`선석별 결과 (절감 상위 15, 참여율 ${res.byBerth ? part : 100}%)`} />
              <div className="sim-table-scroll" tabIndex={0} role="region" aria-label="선석별 시뮬레이션 결과">
                <table className="data-table num">
                  <thead><tr><th>선석</th><th>항차</th><th>대기</th><th>남은 대기</th><th>연료</th><th>추가 유휴</th></tr></thead>
                  <tbody>{berthRows.slice(0, 15).map((b) => (
                    <tr key={b.berth}><td>{b.berth}</td><td>{b.cases}</td><td>{Math.round(b.wait_h)}h</td><td>{Math.round(b.resid_h)}h</td><td>{b.fuel_t.toFixed(1)} t</td><td>{b.idle_h.toFixed(1)}h</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      ) : <p className="notice" role="status">{pending ? '계산 중입니다.' : '이 조합의 결과가 없습니다.'}</p>}
    </div>
  )
}

const integer = (n: number) => Math.round(n).toLocaleString('ko-KR')
const decimal = (n: number) => n.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function LadderChart({ rows, sel }: { rows: { c: (typeof COND)[number]; r: number; x?: SimResult }[]; sel: { cond: Condition; risk: number } }) {
  const [ref, measuredWidth] = useWidth<HTMLDivElement>()
  const width = Math.max(560, measuredWidth)
  const H = 280
  const M = { l: 48, r: 0, t: 28, b: 36 }
  const y = scaleLinear().domain([0, 100]).range([H - M.b, M.t])
  const groupW = (width - M.l - M.r) / RISKS.length
  const barW = Math.min(32, (groupW - 28) / 3)
  const values = useTween(rows.map((row) => row.x?.shareOfUpper ?? 0), 520)
  const [tip, setTip] = useState<string | null>(null)
  return (
    <div className="sim-chart">
      <div ref={ref} className="sim-chart-scroll">
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
          const gx = M.l + gi * groupW + (groupW - barW * 3 - 12) / 2
          return (
            <g key={r}>
              <text className="axis-t" x={M.l + gi * groupW + groupW / 2} y={H - M.b + 18} textAnchor="middle">
                위험 수준 {r}
              </text>
              {COND.map((c, ci) => {
                const row = rows.find((x) => x.c.value === c.value && x.r === r)?.x
                if (!row) return null
                const v = values[ci * RISKS.length + gi]
                const bx = gx + ci * (barW + 6)
                const top = y(v)
                const on = sel.cond === c.value && sel.risk === r
                const h = y(0) - top
                return (
                  <g
                    key={c.value}
                    tabIndex={0}
                    className={`sim-bar${on ? ' selected' : ''}`}
                    aria-label={`${c.label}, 위험 수준 ${r}, 절감 ${row.shareOfUpper.toFixed(0)}%`}
                    onPointerEnter={() => setTip(`${c.label}, 위험 수준 ${r}: 상한 대비 ${v.toFixed(0)}%, 연료 ${row.fuelT.toLocaleString('ko-KR')} t, 추가 유휴 ${row.extraIdleH.toFixed(0)}시간`)}
                    onFocus={() => setTip(`${c.label}, 위험 수준 ${r}: 상한 대비 ${v.toFixed(0)}%, 연료 ${row.fuelT.toLocaleString('ko-KR')} t, 추가 유휴 ${row.extraIdleH.toFixed(0)}시간`)}
                    onPointerLeave={() => setTip(null)}
                    onBlur={() => setTip(null)}
                  >
                    <rect x={bx - 2} y={M.t} width={barW + 4} height={H - M.b - M.t} fill="transparent" />
                    <rect className="sim-bar-fill" style={stagger(gi * 3 + ci)} x={bx} y={top} width={barW} height={Math.max(0, h)} rx={3} fill={c.color} stroke={on ? 'var(--ink)' : 'none'} strokeWidth={on ? 1.5 : 0} />
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
      </div>
      {tip && <div className="sim-chart-tooltip" role="tooltip">{tip}</div>}
      <ul className="sim-legend small">
        {COND.map((c) => (
          <li key={c.value}>
            <span className="k" style={{ background: c.color, borderRadius: 2 }} />
            {c.label}
          </li>
        ))}
        <li className="muted">막대 위 숫자: 완전 정보 상한 대비 절감 %</li>
      </ul>
      <p className="small muted sim-readout" aria-live="polite">{tip ?? '막대에 마우스를 올리면 연료와 추가 선석 유휴를 볼 수 있습니다.'}</p>
    </div>
  )
}

function Hist({ h }: { h: { edges: number[]; counts: number[] } }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const H = 260
  const M = { l: 40, r: 0, t: 24, b: 40 }
  const max = Math.max(1, ...h.counts)
  const y = scaleLinear().domain([0, max]).nice(5).range([H - M.b, M.t])
  const labels = h.edges.map((e, i) => (i < h.edges.length - 1 ? `${e}–${h.edges[i + 1]}` : `${e}+`))
  const bw = Math.max(0, width - M.l - M.r) / h.counts.length
  const barW = Math.max(1, Math.min(24, bw - 6))
  const counts = useTween(h.counts, 520)
  return (
    <div ref={ref}>
      <svg width={width} height={H} role="img" aria-label="늦춤 시간 분포">
        {y.ticks(5).map((v) => (
          <g key={v}>
            <line className="grid-line" x1={M.l} x2={width - M.r} y1={y(v)} y2={y(v)} />
            <text className="axis-t" x={M.l - 6} y={y(v) + 4} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {h.counts.map((c, i) => {
          const x = M.l + i * bw + (bw - barW) / 2
          const top = y(counts[i])
          return (
            <g key={i} className="sim-bar" tabIndex={0} aria-label={`${labels[i]}시간: ${c}항차`}>
              <title>{labels[i]}시간: {c}항차</title>
              {c > 0 && <rect className="sim-bar-fill" style={stagger(i)} x={x} y={top} width={barW} height={Math.max(0, y(0) - top)} rx={3} fill="var(--rta)" />}
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
        <text className="axis-t" x={width - M.r} y={13} textAnchor="end">
          늦춤(시간)
        </text>
      </svg>
    </div>
  )
}
