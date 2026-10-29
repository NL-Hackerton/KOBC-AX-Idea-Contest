import { scaleLinear } from 'd3-scale'
import { useEffect, useMemo, useState } from 'react'
import { getCiiConstants } from '../api'
import { useWidth } from '../lib/useWidth'
import { CardHead, CountUp, PageHeader } from '../components/ui'
import { stagger, useTween } from '../lib/motion'
import '../styles/cii.css'

interface Seg {
  min: number
  max: number | null
  unit: 'DWT' | 'GT'
  fixedCapacity: number | null
  a: number
  c: number
  dd: number[]
}
interface Consts {
  z: Record<string, number>
  cf: Record<string, number>
  types: Record<string, Seg[]>
  sources: Record<string, string>
}

const GRADES = ['A', 'B', 'C', 'D', 'E']

function seg(c: Consts, type: string, cap: number): Seg {
  return c.types[type].find((s) => cap >= s.min && (s.max == null || cap < s.max)) ?? c.types[type][0]
}

export default function Cii() {
  const [c, setC] = useState<Consts | null>(null)
  const [f, setF] = useState({ type: '탱커', cap: 50000, dist: 55000, fuel: 5000, fuelType: 'VLSFO/LFO', waitH: 1000, anchorPerDay: 4 })
  useEffect(() => {
    getCiiConstants<Consts>().then(setC)
  }, [])

  const calc = useMemo(() => {
    if (!c) return null
    const s = seg(c, f.type, f.cap)
    const ref = s.a * Math.pow(s.fixedCapacity ?? f.cap, -s.c)
    const cf = c.cf[f.fuelType]
    const att = (fuel: number) => (fuel * cf * 1e6) / (f.cap * f.dist)
    const saved = Math.min(f.fuel, (f.waitH / 24) * f.anchorPerDay)
    const before = att(f.fuel)
    const after = att(f.fuel - saved)
    const rows = Object.entries(c.z).map(([y, z]) => {
      const req = ref * (1 - z / 100)
      const b = s.dd.map((d) => req * d)
      const g = (v: number) => GRADES[b.findIndex((x) => v < x) === -1 ? 4 : b.findIndex((x) => v < x)]
      return { year: Number(y), req, b, gBefore: g(before), gAfter: g(after) }
    })
    return { s, ref, before, after, saved, rows }
  }, [c, f])

  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) })
  const improved = calc?.rows.filter((r) => r.gBefore !== r.gAfter) ?? []
  const oneStep = improved.every((r) => GRADES.indexOf(r.gBefore) - GRADES.indexOf(r.gAfter) === 1)
  const insight = improved.length
    ? `${improved.map((r) => `${r.year}년`).join('과 ')}에 등급이 ${oneStep ? '한 단계 ' : ''}오릅니다.`
    : '대기 연료를 제거한 뒤에도 연도별 등급은 같습니다.'

  return (
    <div className="screen cii">
      <PageHeader
        title="CII 등급 계산"
        bodySub
        sub="정박지에서 기다리며 쓴 연료를 빼면 연간 CII 등급이 어떻게 바뀌는지 계산합니다. 대기 중에는 항해거리가 늘지 않으므로 대기 연료가 그대로 CII를 높입니다."
        right={<span className="badge">IMO MEPC.400(83) 감축률</span>}
      />
      {!c || !calc ? <div className="card cii-loading" role="status">CII 상수를 불러오는 중입니다.</div> : (
        <div className="cii-grid">
          <section className="card cii-form enter" style={stagger(0)}>
            <CardHead title="선박과 연간 운항" sub="예시값입니다. 바꾸면 오른쪽 등급이 바로 다시 계산됩니다." />
            <div className="cii-fields">
              <label className="field">
                <span>선종</span>
                <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                  {Object.keys(c.types).map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
              <label className="field">
                <span>용량 ({calc.s.unit})</span>
                <input type="number" min={1000} value={f.cap} onChange={num('cap')} />
              </label>
              <label className="field">
                <span>연간 항해거리 (해리)</span>
                <input type="number" min={1000} value={f.dist} onChange={num('dist')} />
              </label>
              <label className="field">
                <span>연간 연료 (톤)</span>
                <input type="number" min={1} value={f.fuel} onChange={num('fuel')} />
              </label>
              <label className="field">
                <span>연료 종류</span>
                <select value={f.fuelType} onChange={(e) => setF({ ...f, fuelType: e.target.value })}>
                  {Object.keys(c.cf).map((k) => <option key={k}>{k}</option>)}
                </select>
              </label>
              <label className="field">
                <span>연간 정박지 대기 (시간)</span>
                <input type="number" min={0} value={f.waitH} onChange={num('waitH')} />
              </label>
              <label className="field">
                <span>대기 중 일일 연료 (톤)</span>
                <input type="number" min={0} step={0.5} value={f.anchorPerDay} onChange={num('anchorPerDay')} />
              </label>
            </div>
            <div className="cii-divider" />
            <CiiResults saved={calc.saved} co2={calc.saved * c.cf[f.fuelType]} before={calc.before} after={calc.after} />
            <p className="callout" aria-live="polite">{insight}</p>
            <p className="cii-caption">
              대기를 없애면 연료 {calc.saved.toFixed(0)}톤이 줄고 항해거리는 그대로라고 단순 가정합니다. 실제로는 감속 항해 연료가 함께 바뀝니다.
            </p>
          </section>
          <section className="card cii-grades enter" style={stagger(1)}>
            <CardHead title="연도별 등급" sub="칸 색은 그해 등급 경계, 가로선은 이 배의 연간 CII입니다." />
            <CiiChart rows={calc.rows} before={calc.before} after={calc.after} />
            <div className="cii-legend" aria-label="차트 범례">
              {GRADES.map((g) => <span key={g}><i style={{ background: `var(--cii-${g.toLowerCase()})` }} />{g}</span>)}
              <span><i className="cii-key-before" />대기 포함</span>
              <span><i className="cii-key-after" />대기 제거</span>
            </div>
            <div className="cii-table-scroll" role="region" aria-label="연도별 CII 등급 표" tabIndex={0}>
              <table className="data-table cii-table num">
                <thead>
                  <tr>
                    <th scope="col">연도</th>
                    <th scope="col">감축률</th>
                    <th scope="col">필요 CII</th>
                    <th scope="col">대기 포함 ({calc.before.toFixed(2)})</th>
                    <th scope="col">대기 제거 ({calc.after.toFixed(2)})</th>
                  </tr>
                </thead>
                <tbody>
                  {calc.rows.map((r) => (
                    <tr key={r.year}>
                      <td>{r.year}</td>
                      <td>{c.z[String(r.year)]}%</td>
                      <td>{r.req.toFixed(2)}</td>
                      <td><span className="cii-grade" key={`before-${r.gBefore}`}>{r.gBefore}</span></td>
                      <td><span className="cii-grade" key={`after-${r.gAfter}`}>{r.gAfter}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="cii-caption">단위 gCO2/({calc.s.unit}·해리). 출처: {c.sources.reference}, {c.sources.rating}, {c.sources.z}, {c.sources.cf}.</p>
          </section>
        </div>
      )}
    </div>
  )
}

function CiiResults({ saved, co2, before, after }: { saved: number; co2: number; before: number; after: number }) {
  return (
    <div className="cii-results">
      <div className="cii-result">
        <span>줄어드는 연료</span>
        <strong><CountUp value={saved} format={(n) => n.toFixed(0)} /><small>톤</small></strong>
        <p>CO2 <CountUp value={co2} format={(n) => n.toFixed(0)} />톤</p>
      </div>
      <div className="cii-result">
        <span>연간 CII</span>
        <strong><CountUp value={before} format={(n) => n.toFixed(2)} /> → <CountUp value={after} format={(n) => n.toFixed(2)} /></strong>
        <p><CountUp value={before ? (1 - after / before) * 100 : 0} format={(n) => n.toFixed(1)} />% 낮아짐</p>
      </div>
    </div>
  )
}

function CiiChart({ rows, before, after }: { rows: { year: number; b: number[] }[]; before: number; after: number }) {
  const [ref, measuredWidth] = useWidth<HTMLDivElement>()
  const width = Math.max(430, measuredWidth)
  const H = 260
  const M = { l: 44, r: 42, t: 12, b: 28 }
  const values = useTween([before, after, ...rows.flatMap((r) => r.b)], 360)
  const [shownBefore, shownAfter] = values
  const bounds = values.slice(2)
  const lo = Math.min(...bounds, shownBefore, shownAfter) * 0.85
  const hi = Math.max(...bounds, shownBefore, shownAfter) * 1.12
  const y = scaleLinear().domain([lo, hi]).range([H - M.b, M.t])
  const x = scaleLinear().domain([rows[0].year - 0.5, rows[rows.length - 1].year + 0.5]).range([M.l, width - M.r])
  const cw = (width - M.l - M.r) / rows.length
  const lineLabels = [
    { label: '대기 포함', value: shownBefore, type: 'before', offset: -25 },
    { label: '대기 제거', value: shownAfter, type: 'after', offset: 5 },
  ]
  return (
    <div className="cii-chart" ref={ref}>
      <svg width={width} height={H} role="img" aria-label="연도별 CII 등급 경계와 실적">
        {y.ticks(5).map((tick) => <text key={tick} className="cii-axis" x={M.l - 8} y={y(tick) + 4} textAnchor="end">{tick}</text>)}
        {rows.map((r, index) => {
          const edges = [lo, ...bounds.slice(index * 4, index * 4 + 4), hi]
          return (
            <g key={r.year}>
              <g className="cii-column" style={stagger(index)}>
                {GRADES.map((g, i) => (
                  <rect key={g} x={x(r.year) - cw / 2 + 1} width={cw - 2} y={y(edges[i + 1])} height={Math.max(0, y(edges[i]) - y(edges[i + 1]))} fill={`var(--cii-${g.toLowerCase()})`} />
                ))}
              </g>
              <text className="cii-axis" x={x(r.year)} y={H - 7} textAnchor="middle">{r.year}</text>
            </g>
          )
        })}
        {GRADES.map((g, i) => {
          const edges = [lo, ...bounds.slice(-4), hi]
          return <text key={g} className="cii-axis" x={width - M.r + 10} y={(y(edges[i]) + y(edges[i + 1])) / 2 + 4}>{g}</text>
        })}
        {lineLabels.map(({ label, value, type, offset }) => (
          <g key={type} className={`cii-line-${type}`}>
            <line className="cii-value-line" pathLength={1} x1={M.l} x2={width - M.r} y1={y(value)} y2={y(value)} />
            <g transform={`translate(${M.l + 5},${Math.max(M.t, Math.min(H - M.b - 24, y(value) + offset))})`}>
              <rect className="cii-line-pill" width={94} height={23} rx={4} />
              <text x={6} y={16}>{label} {value.toFixed(2)}</text>
            </g>
          </g>
        ))}
      </svg>
    </div>
  )
}
