import { scaleLinear } from 'd3-scale'
import { area, curveMonotoneX, line } from 'd3-shape'
import { useEffect, useMemo, useState } from 'react'
import { fmtD, fmtDT, fmtT, kstHour, ms } from '../lib/time'
import { useTween } from '../lib/motion'
import { useWidth } from '../lib/useWidth'

interface Props {
  tau: string
  nominal: number[] // 0.05 … 0.95
  quantilesH: number[] // 결정 시각 기준 시간
  busy: boolean
  a0: string
  rta: string
  maxDelayEnd: string
  actualFree?: string | null // 공개 후에만
  showTable?: boolean
}

const H = 230
const M = { l: 44, r: 16, t: 14, b: 30 }
const BAND_H = 26

export default function BerthFanChart({ tau, nominal, quantilesH, busy, a0, rta, maxDelayEnd, actualFree, showTable }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const t0 = ms(tau)
  const hOf = (iso: string) => (ms(iso) - t0) / 3600000
  const q = useTween(busy ? quantilesH : quantilesH.map(() => 0))
  const rtaH = useTween([hOf(rta)])[0]

  const end = useMemo(() => {
    const cand = [quantilesH[quantilesH.length - 1] ?? 0, hOf(maxDelayEnd), hOf(a0), actualFree ? hOf(actualFree) : 0, 24]
    return Math.ceil((Math.max(...cand) * 1.08) / 6) * 6
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantilesH.join(','), maxDelayEnd, a0, actualFree, tau])

  const x = scaleLinear().domain([0, end]).range([M.l, width - M.r])
  const y = scaleLinear().domain([0, 1]).range([H - M.b, M.t])

  // 누적분포: (q_k, a_k). 앞뒤를 0·1 로 닫는다.
  const pts: [number, number][] = busy
    ? [[0, 0], ...q.map((v, i) => [Math.max(0, v), nominal[i]] as [number, number]), [Math.max(q[q.length - 1], 0) * 1.0001 + 0.01, 1]]
    : [[0, 1], [end, 1]]
  const cdf = line<[number, number]>().x((d) => x(d[0])).y((d) => y(d[1])).curve(curveMonotoneX)(pts) ?? ''
  const fill = area<[number, number]>().x((d) => x(d[0])).y0(y(0)).y1((d) => y(d[1])).curve(curveMonotoneX)([...pts, [end, 1]]) ?? ''

  // 실제 가용 시각 공개 연출: 결정 시각에서 실제 시각까지 수직선이 쓸려 간다
  const [sweep, setSweep] = useState(1)
  useEffect(() => {
    if (!actualFree) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return setSweep(1)
    let raf = 0
    const s = performance.now()
    const step = (n: number) => {
      const k = Math.min(1, (n - s) / 600)
      setSweep(1 - Math.pow(1 - k, 3))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    setSweep(0)
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [actualFree])

  const ticks: number[] = []
  const stepH = end <= 48 ? 6 : end <= 120 ? 12 : 24
  for (let h = 0; h <= end; h += stepH) ticks.push(h)

  const [hover, setHover] = useState<number | null>(null)
  const probAt = (h: number) => {
    if (!busy) return 1
    if (h <= q[0]) return h <= 0 ? 0 : (nominal[0] * h) / Math.max(q[0], 1e-6)
    for (let i = 1; i < q.length; i++) {
      if (h <= q[i]) return nominal[i - 1] + ((nominal[i] - nominal[i - 1]) * (h - q[i - 1])) / Math.max(q[i] - q[i - 1], 1e-6)
    }
    return 1
  }

  const mark = (h: number, cls: string, label: string, top = M.t) => (
    <g className={`mark ${cls}`} transform={`translate(${x(h)},0)`}>
      <line y1={top} y2={H - M.b + BAND_H + 8} />
      <text y={top - 2} textAnchor={x(h) > width - 120 ? 'end' : 'start'} dx={x(h) > width - 120 ? -4 : 4}>
        {label}
      </text>
    </g>
  )

  const iq = (k: number) => (busy ? Math.max(0, q[k]) : 0)
  const totalH = H + BAND_H + 18

  return (
    <div ref={ref} className="fan">
      <svg
        width={width}
        height={totalH}
        role="img"
        aria-label={`선석이 비는 시각의 분포. 중앙값 결정 시각 뒤 ${iq(9).toFixed(1)}시간`}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const h = x.invert(e.clientX - r.left)
          setHover(h >= 0 && h <= end ? h : null)
        }}
        onPointerLeave={() => setHover(null)}
      >
        {/* 격자와 축 */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <g key={p}>
            <line className="grid" x1={M.l} x2={width - M.r} y1={y(p)} y2={y(p)} />
            <text className="axis" x={M.l - 6} y={y(p) + 4} textAnchor="end">
              {Math.round(p * 100)}%
            </text>
          </g>
        ))}
        {ticks.map((h) => {
          const iso = t0 + h * 3600000
          const label = kstHour(iso) < stepH || h === 0 ? `${fmtD(iso)} ${fmtT(iso)}` : fmtT(iso)
          return (
            <text key={h} className="axis num" x={x(h)} y={H - M.b + BAND_H + 24} textAnchor="middle">
              {label}
            </text>
          )
        })}
        <line className="baseline" x1={M.l} x2={width - M.r} y1={y(0)} y2={y(0)} />

        {/* 최대 지연 한계까지의 범위 */}
        <rect className="delay-range" x={x(hOf(a0))} width={Math.max(0, x(hOf(maxDelayEnd)) - x(hOf(a0)))} y={M.t} height={H - M.b - M.t} />

        {/* 누적분포 */}
        <path className="cdf-fill" d={fill} />
        <path className="cdf" d={cdf} />

        {/* 구간 띠 */}
        <g transform={`translate(0,${H - M.b + 6})`}>
          <rect className="band-outer" x={x(iq(0))} width={Math.max(2, x(iq(18)) - x(iq(0)))} height={BAND_H - 8} rx={3} />
          <rect className="band-inner" x={x(iq(3))} width={Math.max(2, x(iq(15)) - x(iq(3)))} height={BAND_H - 8} rx={3} />
          <line className="band-mid" x1={x(iq(9))} x2={x(iq(9))} y1={-2} y2={BAND_H - 6} />
        </g>

        {mark(hOf(a0), 'm-a0', '', M.t)}
        {mark(hOf(maxDelayEnd), 'm-max', '', M.t)}
        {mark(rtaH, 'm-rta', `권고 도착 ${fmtDT(t0 + rtaH * 3600000)}`, M.t + 12)}
        {actualFree && mark(hOf(actualFree) * sweep, 'm-actual', `실제 선석 가용 ${fmtDT(actualFree)}`, M.t + 34)}

        {hover != null && (
          <g className="hover" transform={`translate(${x(hover)},0)`}>
            <line y1={M.t} y2={H - M.b} />
          </g>
        )}
      </svg>
      <ul className="fan-legend small">
        <li><span className="k k-cdf" />이 시각까지 선석이 빌 확률</li>
        <li><span className="k k-band" />20~80%와 5~95% 구간</li>
        <li><span className="k k-a0" />도착 예정 {fmtDT(a0)}</li>
        <li><span className="k k-range" />최저 속도로 늦출 수 있는 범위</li>
        <li><span className="k k-rta" />권고 도착</li>
        {actualFree && <li><span className="k k-actual" />실제 선석 가용</li>}
      </ul>
      <p className="fan-readout small num" aria-live="polite">
        {hover != null
          ? `${fmtDT(t0 + hover * 3600000)}까지 선석이 빌 확률 ${Math.round(Math.min(1, Math.max(0, probAt(hover))) * 100)}%`
          : busy
            ? `선석이 비는 시각: 20~80% 구간 ${fmtDT(t0 + iq(3) * 3600000)} ~ ${fmtDT(t0 + iq(15) * 3600000)}, 중앙 ${fmtDT(t0 + iq(9) * 3600000)}`
            : '결정 시각에 선석이 이미 비어 있습니다.'}
      </p>
      {showTable && (
        <table className="data-table small num">
          <thead>
            <tr>
              <th>확률</th>
              {nominal.filter((_, i) => i % 3 === 0 || i === nominal.length - 1).map((a) => (
                <th key={a}>{Math.round(a * 100)}%</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>이 시각까지 빔</th>
              {nominal.map((a, i) => ({ a, i })).filter(({ i }) => i % 3 === 0 || i === nominal.length - 1).map(({ a, i }) => (
                <td key={a}>{fmtDT(t0 + (busy ? quantilesH[i] : 0) * 3600000)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}
