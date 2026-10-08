import { scaleLinear } from 'd3-scale'
import { useEffect, useState } from 'react'
import { getEvidence } from '../api'
import { useWidth } from '../lib/useWidth'

interface Ev {
  wait: { summary: Record<string, number | string | null>[]; hist: { edges: number[]; ports: Record<string, { n: number; share: number[] }> } }
  forecast: { metrics: Record<string, number | string>[]; split: Record<string, string> }
  backtest: { table: Record<string, number | string | null>[]; coverage80: Record<string, Record<string, number>>; cases: number; busy: number }
  validation: { positions: number; ships: number; from: string | null; to: string | null; status: string; plan: string }
  data: { source: string; period: string; ports: number; calls: number }
}

const COND_LABEL: Record<string, string> = { public: '공개 데이터만', lineup: '대기 순번 공유', plan: '선석계획 공유' }
const fmt = (v: unknown, d = 1) => (typeof v === 'number' ? (Math.abs(v) < 1e-9 ? 0 : v).toLocaleString('ko-KR', { maximumFractionDigits: d }) : v == null ? '-' : String(v))
const ts = (s: string | null) => (s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}` : '-')

export default function Evidence() {
  const [ev, setEv] = useState<Ev | null>(null)
  useEffect(() => {
    getEvidence<Ev>().then(setEv)
  }, [])
  if (!ev) return <p className="muted">근거를 불러오는 중</p>
  const main = ev.wait.summary.filter((r) => ['대산', '울산', '광양', '여천'].includes(String(r['항만'])))
  const rest = ev.wait.summary.filter((r) => !main.includes(r))
  return (
    <div className="screen evidence">
      <p className="lead">
        K-JIT의 숫자는 모두 아래 실측에서 나옵니다. {ev.data.source}의 {ev.data.period} 기록 {ev.data.calls.toLocaleString('ko-KR')}항차({ev.data.ports}개 항만)를 썼습니다.
      </p>

      <section className="panel">
        <h3>1. 정박지에서 선석을 기다린 시간</h3>
        <p className="small muted">같은 선석을 쓴 앞 배의 출항 시각으로 선석이 빈 시각을 복원해 대기 하한을 추정했습니다. 여러 척이 함께 붙는 시설은 제외했습니다.</p>
        <div className="table-scroll">
          <table className="data-table small num">
            <thead>
              <tr>
                {['항만', '화물선 항차', '정박지→선석 %', '대기 추정 항차', '대기 중앙값 h', '대기 p75 h', '대기 p90 h', '12h 이상 %'].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...main, ...rest].map((r) => (
                <tr key={String(r['항만'])} className={main.includes(r) ? '' : 'faint'}>
                  {['항만', '화물선 항차', '정박지→선석 %', '대기 추정 항차', '대기 중앙값 h', '대기 p75 h', '대기 p90 h', '12h 이상 %'].map((h) => (
                    <td key={h}>{fmt(r[h])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hist-grid">
          {Object.entries(ev.wait.hist.ports).map(([port, h]) => (
            <WaitHist key={port} port={port} n={h.n} share={h.share} edges={ev.wait.hist.edges} />
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>2. 선석에 붙어 있는 배가 언제 떠나는가</h3>
        <p className="small muted">
          학습 {ev.forecast.split.train}, 보정 {ev.forecast.split.calib}, 시험 {ev.forecast.split.test}. 시험 구간 지표입니다.
        </p>
        <table className="data-table small num">
          <thead>
            <tr>
              {Object.keys(ev.forecast.metrics[0]).map((k) => (
                <th key={k}>{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ev.forecast.metrics.map((m) => (
              <tr key={String(m['모델'])}>
                {Object.values(m).map((v, i) => (
                  <td key={i}>{fmt(v, 3)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h3>3. 도착 시각을 정했을 때의 결과</h3>
        <p className="small muted">
          시험 구간 정박지→선석 화물선 {ev.backtest.cases.toLocaleString('ko-KR')}항차. 결정 시각에 선석이 차 있던 {ev.backtest.busy}건으로 선석 가용 예측을 평가했습니다.
        </p>
        <table className="data-table small num">
          <thead>
            <tr>
              <th>정보 조건</th>
              <th>선석 가용 시각 MAE</th>
              <th>80% 구간 적중률 (보정 전 → 재보정)</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(ev.backtest.coverage80).map(([k, v]) => (
              <tr key={k}>
                <td>{COND_LABEL[k]}</td>
                <td>{v.mae_busy_h}시간</td>
                <td>
                  {v['원래'].toFixed(3)} → {v['재보정'].toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="table-scroll">
          <table className="data-table small num">
            <thead>
              <tr>
                {Object.keys(ev.backtest.table[0]).map((k) => (
                  <th key={k}>{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ev.backtest.table.map((r, i) => (
                <tr key={i}>
                  {Object.values(r).map((v, j) => (
                    <td key={j}>{fmt(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h3>4. 실제 위치로 하는 검증</h3>
        <p className="small">
          울산항만공사 항내 선박위치를 5분마다 모으고 있습니다. 지금까지 {ev.validation.positions.toLocaleString('ko-KR')}건, {ev.validation.ships.toLocaleString('ko-KR')}척 ({ts(ev.validation.from)} ~ {ts(ev.validation.to)}).
        </p>
        <p className="small muted">{ev.validation.plan}</p>
      </section>

      <section className="panel">
        <h3>한계</h3>
        <ul className="limits small">
          <li>선석 대기는 앞 배 출항 시각으로 복원한 하한 추정입니다. 이동 시간과 선석 외 사유(조석, 도선, 화물 준비)는 빠져 있습니다.</li>
          <li>직접 접안이 드문 선석은 단일 접안을 확인할 수 없어 예측 대상에서 빠졌습니다. 울산은 정박지 경유 항차의 약 절반만 추정되었습니다.</li>
          <li>선석 가용 시각의 80% 구간 적중률은 재보정 후에도 46~75%로 목표 80%에 못 미칩니다. 아주 긴 체류를 덜 잡습니다.</li>
          <li>모든 정보 조건은 이 배가 쓸 선석을 안다고 가정합니다. 대기 순번·선석계획 조건은 그 정보가 정확하다고 가정합니다.</li>
          <li>연료 계수는 총톤수 근사식과 속도 세제곱 법칙을 쓴 가정값입니다.</li>
          <li>항만 시뮬레이터는 한 배의 도착 변경이 다음 배에 주는 영향을 반영하지 않습니다.</li>
        </ul>
      </section>
    </div>
  )
}

function WaitHist({ port, n, share, edges }: { port: string; n: number; share: number[]; edges: number[] }) {
  const [ref, width] = useWidth<HTMLDivElement>(260)
  const H = 150
  const M = { l: 30, r: 6, t: 16, b: 30 }
  const y = scaleLinear().domain([0, 0.6]).range([H - M.b, M.t])
  const bw = (width - M.l - M.r) / share.length
  const barW = Math.min(24, bw - 4)
  const labels = edges.map((e, i) => (i < edges.length - 1 ? `${e}-${edges[i + 1]}` : `${e}+`))
  return (
    <div ref={ref} className="hist-cell">
      <p className="small">
        <strong>{port}</strong> <span className="muted">{n.toLocaleString('ko-KR')}항차</span>
      </p>
      <svg width={width} height={H} role="img" aria-label={`${port} 선석 대기 분포`}>
        {[0, 0.2, 0.4, 0.6].map((v) => (
          <g key={v}>
            <line className="grid-line" x1={M.l} x2={width - M.r} y1={y(v)} y2={y(v)} />
            <text className="axis-t" x={M.l - 4} y={y(v) + 4} textAnchor="end">
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}
        {share.map((s, i) => {
          const x = M.l + i * bw + (bw - barW) / 2
          const top = y(Math.min(s, 0.6))
          return (
            <g key={i}>
              <title>{`${labels[i]}시간: ${(s * 100).toFixed(1)}%`}</title>
              {s > 0 && <path d={`M${x},${y(0)} V${top + 3} q0,-3 3,-3 h${barW - 6} q3,0 3,3 V${y(0)} Z`} fill="var(--band)" />}
              <text className="axis-t" x={x + barW / 2} y={H - M.b + 14} textAnchor="middle">
                {labels[i]}
              </text>
            </g>
          )
        })}
        <line className="base-line" x1={M.l} x2={width - M.r} y1={y(0)} y2={y(0)} />
        <text className="axis-t" x={width - M.r} y={H - 2} textAnchor="end">
          대기(시간)
        </text>
      </svg>
    </div>
  )
}
