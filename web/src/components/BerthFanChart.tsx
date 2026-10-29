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
  actualFree?: string | null
  showTable?: boolean
  /** 대기열과 공유하는 시간 창 (결정 시각 기준 시간). */
  windowH?: [number, number]
  riskLabel?: string
}

const H = 240
const M = { l: 36, r: 8, t: 28, b: 28 }

export default function BerthFanChart({ tau, nominal, quantilesH, busy, a0, rta, maxDelayEnd, actualFree, showTable, windowH, riskLabel }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const t0 = ms(tau)
  const hOf = (iso: string) => (ms(iso) - t0) / 3600000
  const q = useTween(busy ? quantilesH : quantilesH.map(() => 0))
  const rtaH = useTween([hOf(rta)])[0]

  const end = useMemo(() => {
    if (windowH) return windowH[1]
    const cand = [quantilesH[quantilesH.length - 1] ?? 0, hOf(maxDelayEnd), hOf(a0), actualFree ? hOf(actualFree) : 0, 24]
    return Math.ceil((Math.max(...cand) * 1.08) / 6) * 6
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantilesH.join(','), maxDelayEnd, a0, actualFree, tau, windowH?.[0], windowH?.[1]])
  const start = windowH ? windowH[0] : 0

  const x = scaleLinear().domain([start, end]).range([M.l, Math.max(M.l + 10, width - M.r)])
  const y = scaleLinear().domain([0, 1]).range([H - M.b, M.t])

  const pts: [number, number][] = busy
    ? [[Math.min(0, q[0] ?? 0), 0], ...q.map((v, i) => [Math.max(start, v), nominal[i]] as [number, number]), [Math.max(q[q.length - 1] ?? 0, 0) + 0.01, 1]]
    : [[start, 1], [end, 1]]
  const cdf = line<[number, number]>().x((d) => x(d[0])).y((d) => y(d[1])).curve(curveMonotoneX)(pts) ?? ''
  const fill = area<[number, number]>().x((d) => x(d[0])).y0(y(0)).y1((d) => y(d[1])).curve(curveMonotoneX)(pts) ?? ''

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

  const span = end - start
  const stepH = [12, 24, 48, 72, 96, 168].find((s) => span / s <= 7) ?? 168
  const ticks: number[] = []
  const tick0 = Math.ceil(start / stepH) * stepH
  for (let h = tick0; h <= end; h += stepH) ticks.push(h)

  const [hover, setHover] = useState<number | null>(null)
  const probAt = (h: number) => {
    if (!busy) return 1
    if (h <= q[0]) return h <= 0 ? 0 : (nominal[0] * h) / Math.max(q[0], 1e-6)
    for (let i = 1; i < q.length; i++) {
      if (h <= q[i]) return nominal[i - 1] + ((nominal[i] - nominal[i - 1]) * (h - q[i - 1])) / Math.max(q[i] - q[i - 1], 1e-6)
    }
    return 1
  }

  const iq = (k: number) => (busy ? Math.max(0, q[k] ?? 0) : 0)
  const p50i = nominal.findIndex((n) => Math.abs(n - 0.5) < 1e-6)
  const p50 = iq(p50i < 0 ? 9 : p50i)

  const pill = (h: number, text: string, cls: string, y0: number) => {
    const px = x(h)
    const w = Math.max(72, text.length * 7.2 + 16)
    const left = Math.min(Math.max(px - w / 2, 4), Math.max(4, width - w - 4))
    return (
      <g className={`pill-mark ${cls}`}>
        <line x1={px} x2={px} y1={y0 + 18} y2={H - M.b} />
        <rect x={left} y={y0} width={w} height={20} rx={10} />
        <text x={left + w / 2} y={y0 + 14} textAnchor="middle">
          {text}
        </text>
      </g>
    )
  }

  return (
    <div ref={ref} className="fan">
      <svg
        width={width}
        height={H + 8}
        role="img"
        aria-label={`선석이 비는 시각의 분포. 중앙값 결정 시각 뒤 ${p50.toFixed(1)}시간`}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const h = x.invert(e.clientX - r.left)
          setHover(h >= start && h <= end ? h : null)
        }}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <g key={p}>
            <line className="grid" x1={M.l} x2={width - M.r} y1={y(p)} y2={y(p)} />
            <text className="axis" x={4} y={y(p) + 4}>
              {Math.round(p * 100)}%
            </text>
          </g>
        ))}
        {ticks.map((h) => {
          const iso = t0 + h * 3600000
          const label = stepH >= 48 ? fmtD(iso) : kstHour(iso) === 0 || h === tick0 ? `${fmtD(iso)}` : fmtT(iso)
          return (
            <text key={h} className="axis num" x={x(h)} y={H - 8} textAnchor="middle">
              {label}
            </text>
          )
        })}
        <line className="baseline" x1={M.l} x2={width - M.r} y1={y(0)} y2={y(0)} />

        <rect className="delay-range" x={x(hOf(a0))} width={Math.max(0, x(hOf(maxDelayEnd)) - x(hOf(a0)))} y={H - M.b - 10} height={8} rx={3} />
        {busy && <rect className="band-outer" x={x(iq(0))} width={Math.max(2, x(iq(18)) - x(iq(0)))} y={M.t} height={H - M.b - M.t} />}
        {busy && <rect className="band-inner" x={x(iq(3))} width={Math.max(2, x(iq(15)) - x(iq(3)))} y={M.t} height={H - M.b - M.t} />}

        <path className="cdf-fill" d={fill} />
        <path className="cdf" d={cdf} />

        <line className="mark m-a0" x1={x(hOf(a0))} x2={x(hOf(a0))} y1={M.t} y2={H - M.b} />
        {pill(p50, `중앙 ${fmtDT(t0 + p50 * 3600000)} · P50`, 'm-p50', 2)}
        {pill(rtaH, `권고 ${fmtDT(t0 + rtaH * 3600000)}${riskLabel ? ` · ${riskLabel}` : ''}`, 'm-rta', 2)}
        {actualFree && <line className="mark m-actual" x1={x(hOf(actualFree) * sweep)} x2={x(hOf(actualFree) * sweep)} y1={M.t} y2={H - M.b} />}

        {hover != null && (
          <g className="hover" transform={`translate(${x(hover)},0)`}>
            <line y1={M.t} y2={H - M.b} />
          </g>
        )}
      </svg>
      <ul className="fan-legend small">
        <li><span className="k k-band" />5–95%</li>
        <li><span className="k k-inner" />20–80%</li>
        <li><span className="k k-actual" />중앙(P50)</li>
        <li><span className="k k-a0" />도착 예정</li>
        <li><span className="k k-rta" />권고 도착{riskLabel ? `(${riskLabel})` : ''}</li>
        <li><span className="k k-range" />최저 속도로 늦출 수 있는 범위</li>
        {actualFree && <li><span className="k k-actual" />실제 선석 가용</li>}
      </ul>
      <p className="fan-readout small num" aria-live="polite">
        {hover != null
          ? `${fmtDT(t0 + hover * 3600000)}까지 선석이 빌 확률 ${Math.round(Math.min(1, Math.max(0, probAt(hover))) * 100)}%`
          : busy
            ? `선석이 비는 시각: 20~80% 구간 ${fmtDT(t0 + iq(3) * 3600000)} ~ ${fmtDT(t0 + iq(15) * 3600000)}, 중앙 ${fmtDT(t0 + p50 * 3600000)}`
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
