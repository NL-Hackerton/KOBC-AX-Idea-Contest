import { scaleLinear } from 'd3-scale'
import { useEffect, useMemo, useState } from 'react'
import { getCiiConstants } from '../api'
import { useWidth } from '../lib/useWidth'

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
const ZONE = ['#cde2fb', '#e6eef8', '#f0efec', '#f8e1df', '#f1c4c2']

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

  if (!c || !calc) return <p className="muted">CII 상수를 불러오는 중</p>
  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) })
  return (
    <div className="screen cii">
      <p className="lead">정박지에서 기다리며 쓴 연료를 빼면 연간 CII 등급이 어떻게 바뀌는지 계산합니다. 대기 중에는 항해거리가 늘지 않으므로 대기 연료가 그대로 CII를 높입니다.</p>
      <div className="cii-grid">
        <section className="panel">
          <h3>선박과 연간 운항 (예시값)</h3>
          <div className="form-grid">
            <label>
              선종
              <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                {Object.keys(c.types).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              용량 ({calc.s.unit})
              <input type="number" min={1000} value={f.cap} onChange={num('cap')} />
            </label>
            <label>
              연간 항해거리 (해리)
              <input type="number" min={1000} value={f.dist} onChange={num('dist')} />
            </label>
            <label>
              연간 연료 (톤)
              <input type="number" min={1} value={f.fuel} onChange={num('fuel')} />
            </label>
            <label>
              연료 종류
              <select value={f.fuelType} onChange={(e) => setF({ ...f, fuelType: e.target.value })}>
                {Object.keys(c.cf).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              연간 정박지 대기 (시간)
              <input type="number" min={0} value={f.waitH} onChange={num('waitH')} />
            </label>
            <label>
              대기 중 일일 연료 (톤)
              <input type="number" min={0} step={0.5} value={f.anchorPerDay} onChange={num('anchorPerDay')} />
            </label>
          </div>
          <p className="small muted">
            대기를 없애면 연료 {calc.saved.toFixed(0)}톤이 줄고 항해거리는 그대로라고 단순 가정합니다. 실제로는 감속 항해 연료가 함께 바뀝니다.
          </p>
        </section>
        <section className="panel">
          <h3>연도별 등급</h3>
          <CiiChart rows={calc.rows} before={calc.before} after={calc.after} />
          <table className="data-table small num">
            <thead>
              <tr>
                <th>연도</th>
                <th>감축률</th>
                <th>필요 CII</th>
                <th>대기 포함</th>
                <th>대기 제거</th>
              </tr>
            </thead>
            <tbody>
              {calc.rows.map((r) => (
                <tr key={r.year}>
                  <td>{r.year}</td>
                  <td>{c.z[String(r.year)]}%</td>
                  <td>{r.req.toFixed(2)}</td>
                  <td>
                    <strong>{r.gBefore}</strong> ({calc.before.toFixed(2)})
                  </td>
                  <td>
                    <strong>{r.gAfter}</strong> ({calc.after.toFixed(2)})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">단위 gCO2/({calc.s.unit}·해리). 출처: {c.sources.reference}, {c.sources.rating}, {c.sources.z}, {c.sources.cf}.</p>
        </section>
      </div>
    </div>
  )
}

function CiiChart({ rows, before, after }: { rows: { year: number; b: number[] }[]; before: number; after: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const H = 240
  const M = { l: 44, r: 70, t: 12, b: 28 }
  const all = rows.flatMap((r) => r.b)
  const lo = Math.min(...all, before, after) * 0.85
  const hi = Math.max(...all, before, after) * 1.12
  const y = scaleLinear().domain([lo, hi]).range([H - M.b, M.t])
  const x = scaleLinear().domain([rows[0].year - 0.5, rows[rows.length - 1].year + 0.5]).range([M.l, width - M.r])
  const cw = x(1) - x(0)
  return (
    <div ref={ref}>
      <svg width={width} height={H} role="img" aria-label="연도별 CII 등급 경계와 실적">
        {rows.map((r) => {
          const edges = [lo, ...r.b, hi]
          return (
            <g key={r.year}>
              {GRADES.map((g, i) => (
                <rect key={g} x={x(r.year) - cw / 2 + 1} width={cw - 2} y={y(edges[i + 1])} height={y(edges[i]) - y(edges[i + 1])} fill={ZONE[i]} />
              ))}
              <text className="axis-t" x={x(r.year)} y={H - 8} textAnchor="middle">
                {r.year}
              </text>
            </g>
          )
        })}
        {GRADES.map((g, i) => {
          const last = rows[rows.length - 1]
          const edges = [lo, ...last.b, hi]
          return (
            <text key={g} className="axis-t" x={width - M.r + 6} y={(y(edges[i]) + y(edges[i + 1])) / 2 + 4}>
              {g}
            </text>
          )
        })}
        <line className="cii-before" x1={M.l} x2={width - M.r} y1={y(before)} y2={y(before)} />
        <line className="cii-after" x1={M.l} x2={width - M.r} y1={y(after)} y2={y(after)} />
        <text className="axis-t" x={M.l + 4} y={y(before) - 4}>
          대기 포함 {before.toFixed(2)}
        </text>
        <text className="axis-t" x={M.l + 4} y={y(after) + 12}>
          대기 제거 {after.toFixed(2)}
        </text>
      </svg>
    </div>
  )
}
