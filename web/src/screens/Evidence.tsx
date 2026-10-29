import { scaleLinear } from 'd3-scale'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { getEvidence } from '../api'
import { CardHead, CountUp, PageHeader } from '../components/ui'
import publicDot from '../assets/icons/evidence-public.svg'
import lineupDot from '../assets/icons/evidence-lineup.svg'
import planDot from '../assets/icons/evidence-plan.svg'
import bullet from '../assets/icons/evidence-bullet.svg'
import collectingDot from '../assets/icons/evidence-collecting.svg'
import '../styles/evidence.css'

interface Ev {
  wait: { summary: Record<string, number | string | null>[]; hist: { edges: number[]; ports: Record<string, { n: number; share: number[] }> } }
  forecast: { metrics: Record<string, number | string>[]; split: Record<string, string> }
  backtest: { table: Record<string, number | string | null>[]; coverage80: Record<string, Record<string, number>>; cases: number; busy: number }
  validation: { positions: number; ships: number; from: string | null; to: string | null; status: string; plan: string }
  data: { source: string; period: string; ports: number; calls: number }
}

const COND_LABEL: Record<string, string> = { public: '공개 데이터만', lineup: '대기 순번 공유', plan: '선석계획 공유' }
const COND_DOT: Record<string, string> = { public: publicDot, lineup: lineupDot, plan: planDot }
const WAIT_COLUMNS = ['항만', '화물선 항차', '정박지→선석 %', '대기 추정 항차', '대기 중앙값 h', '대기 p75 h', '대기 p90 h', '12h 이상 %']
const LIMITS = [
  '선석 대기는 앞 배 출항 시각으로 복원한 하한 추정입니다. 이동 시간과 선석 외 사유(조석, 도선, 화물 준비)는 빠져 있습니다.',
  '직접 접안이 드문 선석은 단일 접안을 확인할 수 없어 예측 대상에서 빠졌습니다. 울산은 정박지 경유 항차의 약 절반만 추정되었습니다.',
  '선석 가용 시각의 80% 구간 적중률은 재보정 후에도 46~75%로 목표 80%에 못 미칩니다. 아주 긴 체류를 덜 잡습니다.',
  '모든 정보 조건은 이 배가 쓸 선석을 안다고 가정합니다. 대기 순번·선석계획 조건은 그 정보가 정확하다고 가정합니다.',
  '연료 계수는 총톤수 근사식과 속도 세제곱 법칙을 쓴 가정값입니다.',
  '항만 시뮬레이터는 한 배의 도착 변경이 다음 배에 주는 영향을 반영하지 않습니다.',
]
const fmt = (v: unknown, d = 1) => (typeof v === 'number' ? (Math.abs(v) < 1e-9 ? 0 : v).toLocaleString('ko-KR', { maximumFractionDigits: d }) : v == null ? '-' : String(v))
const ts = (s: string | null) => (s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}` : '-')
const VisibleContext = createContext(false)

function RevealCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null)
  // Without motion (or without IntersectionObserver) the card is simply shown.
  const [visible, setVisible] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window))
  useEffect(() => {
    if (visible) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true)
        observer.disconnect()
      }
    }, { threshold: 0.06 })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [visible])
  return <VisibleContext.Provider value={visible}><section ref={ref} className={`card evidence-reveal ${visible ? 'is-visible' : ''} ${className}`}>{children}</section></VisibleContext.Provider>
}

function StatNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const visible = useContext(VisibleContext)
  return <CountUp value={visible ? value : 0} format={(n) => n.toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} />
}

function Dot({ src, className = '' }: { src: string; className?: string }) {
  return <span aria-hidden="true" className={`evidence-dot ${className}`} style={{ maskImage: `url(${src})`, WebkitMaskImage: `url(${src})` }} />
}

export default function Evidence() {
  const [ev, setEv] = useState<Ev | null>(null)
  useEffect(() => { getEvidence<Ev>().then(setEv) }, [])
  if (!ev) return <div className="screen evidence"><PageHeader title="근거" /><p className="muted" role="status">근거를 불러오는 중입니다.</p></div>
  const main = ev.wait.summary.filter((r) => ['대산', '울산', '광양', '여천'].includes(String(r['항만'])))
  const rest = ev.wait.summary.filter((r) => !main.includes(r))
  const baseline = ev.forecast.metrics.find((m) => String(m['모델']).includes('기준선'))
  const cqr = ev.forecast.metrics.find((m) => String(m['모델']).includes('CQR'))
  const gbm = ev.forecast.metrics.find((m) => m['모델'] === '분위수 GBM')
  return (
    <div className="screen evidence">
      <PageHeader title="근거" bodySub sub={<>K-JIT의 숫자는 모두 아래 실측에서 나옵니다. {ev.data.source}의 {ev.data.period} 기록 {fmt(ev.data.calls, 0)}항차({ev.data.ports}개 항만)를 썼습니다.</>} right={<span className="badge">시험 구간 {ev.forecast.split.test}</span>} />
      <RevealCard className="evidence-wait">
        <CardHead title="1. 정박지에서 선석을 기다린 시간" sub="같은 선석을 쓴 앞 배의 출항 시각으로 선석이 빈 시각을 복원해 대기 하한을 추정했습니다. 여러 척이 함께 붙는 시설은 제외했습니다." />
        <div className="evidence-table-scroll" role="region" aria-label="항만별 선석 대기 시간" tabIndex={0}>
          <table className="data-table evidence-wait-table"><thead><tr>{WAIT_COLUMNS.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>{[...main, ...rest].map((r) => <tr key={String(r['항만'])} className={main.includes(r) ? '' : 'evidence-faint'}>{WAIT_COLUMNS.map((h) => <td key={h}>{fmt(r[h])}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <div className="evidence-hist-grid">{Object.entries(ev.wait.hist.ports).map(([port, h]) => <WaitHist key={port} port={port} n={h.n} share={h.share} edges={ev.wait.hist.edges} />)}</div>
      </RevealCard>
      <div className="evidence-pair">
        <RevealCard>
          <CardHead title="2. 선석에 붙어 있는 배가 언제 떠나는가" sub={`학습 ${ev.forecast.split.train}, 보정 ${ev.forecast.split.calib}, 시험 ${ev.forecast.split.test}. 시험 구간 지표입니다.`} />
          <div className="evidence-table-scroll" role="region" aria-label="출항 예측 모델 성능" tabIndex={0}>
            <table className="data-table evidence-model-table"><thead><tr>{Object.keys(ev.forecast.metrics[0] ?? {}).map((k) => <th key={k} scope="col">{k}</th>)}</tr></thead><tbody>{ev.forecast.metrics.map((m) => <tr key={String(m['모델'])}>{Object.values(m).map((v, i) => <td key={i}>{fmt(v, 3)}</td>)}</tr>)}</tbody></table>
          </div>
          <div className="evidence-stats">
            <div className="evidence-stat"><span>MAE 개선</span><strong>{baseline && gbm ? <><StatNumber value={Number(baseline['MAE(중앙값) h'])} decimals={2} /> → <StatNumber value={Number(gbm['MAE(중앙값) h'])} decimals={2} /><small>시간</small></> : '-'}</strong></div>
            <div className="evidence-stat"><span>80% 구간 적중률 (CQR)</span><strong>{cqr ? <><StatNumber value={Number(cqr['80% 구간 적중률']) * 100} decimals={1} />%</> : '-'}</strong></div>
          </div>
        </RevealCard>
        <RevealCard className="evidence-coverage">
          <CardHead title="선석 가용 시각 예측 (정보 조건별)" sub={`결정 시각에 선석이 차 있던 ${fmt(ev.backtest.busy, 0)}건으로 평가했습니다. 막대는 재보정 후 80% 구간 적중률, 세로선은 목표 80%입니다.`} />
          {Object.entries(ev.backtest.coverage80).map(([key, v]) => <div className={`evidence-condition evidence-condition-${key}`} key={key}>
            <div className="evidence-condition-head"><Dot src={COND_DOT[key] ?? publicDot} /><strong>{COND_LABEL[key] ?? key}</strong><span>MAE {fmt(v.mae_busy_h)}시간</span></div>
            <div className="evidence-condition-result"><div className="evidence-progress" role="meter" aria-label={`${COND_LABEL[key] ?? key} 재보정 후 구간 적중률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v['재보정'] * 100}><span style={{ width: `${v['재보정'] * 100}%` }} /><i title="목표 80%" /></div><span>{v['원래'].toFixed(3)} → {v['재보정'].toFixed(3)}</span></div>
          </div>)}
        </RevealCard>
      </div>
      <RevealCard>
        <CardHead title="3. 도착 시각을 정했을 때의 결과" sub={`시험 구간 정박지→선석 화물선 ${fmt(ev.backtest.cases, 0)}항차. 강조한 행이 항차 결정 화면의 기본 설정(선석계획 공유, 위험 수준 0.1)입니다.`} />
        <div className="evidence-table-scroll" role="region" aria-label="도착 시각 정책별 결과" tabIndex={0}>
          <table className="data-table evidence-backtest-table"><thead><tr>{Object.keys(ev.backtest.table[0] ?? {}).map((k) => <th key={k} scope="col">{k}</th>)}</tr></thead><tbody>{ev.backtest.table.map((r, i) => <tr key={i} className={r['정보'] === '선석계획 공유' && r['정책'] === '위험 수준 0.1' ? 'evidence-best' : ''}>{Object.values(r).map((v, j) => <td key={j}>{fmt(v)}</td>)}</tr>)}</tbody></table>
        </div>
      </RevealCard>
      <div className="evidence-pair">
        <RevealCard className="evidence-limits"><CardHead title="한계" /><ul>{LIMITS.map((text) => <li key={text}><Dot src={bullet} className="evidence-bullet" /><span>{text}</span></li>)}</ul></RevealCard>
        <RevealCard className="evidence-validation">
          <CardHead title="4. 실제 위치로 하는 검증" right={<span className="evidence-status"><Dot src={collectingDot} />{ev.validation.status === 'collecting' ? '수집 중' : ev.validation.status}</span>} />
          <p>울산항만공사 항내 선박위치를 5분마다 모으고 있습니다.</p>
          <div className="evidence-stats"><div className="evidence-stat"><span>위치 기록</span><strong><StatNumber value={ev.validation.positions} />건</strong></div><div className="evidence-stat"><span>선박</span><strong><StatNumber value={ev.validation.ships} />척</strong></div></div>
          <p className="evidence-caption">{ts(ev.validation.from)} ~ {ts(ev.validation.to)}</p>
          <p className="evidence-caption">{ev.validation.plan.replace('비교한다', '비교합니다')}</p>
        </RevealCard>
      </div>
    </div>
  )
}

function WaitHist({ port, n, share, edges }: { port: string; n: number; share: number[]; edges: number[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(237)
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, Math.floor(entry.contentRect.width))))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  const H = 150
  const M = { l: 30, r: 6, t: 16, b: 30 }
  const y = scaleLinear().domain([0, 0.6]).range([H - M.b, M.t])
  const bw = (width - M.l - M.r) / share.length
  const barW = Math.max(1, Math.min(24, bw - 4))
  const labels = share.map((_, i) => i < edges.length - 1 ? `~${edges[i + 1]}` : `${edges[i]}+`)
  return <div className="evidence-hist"><p><strong>{port}</strong><span>{fmt(n, 0)}항차</span></p><div ref={ref} className="evidence-hist-chart"><svg width={width} height={H} role="img" aria-label={`${port} 선석 대기 분포`}>
    {[0, 0.2, 0.4, 0.6].map((v) => <g key={v}><line className="evidence-grid-line" x1={M.l} x2={width - M.r} y1={y(v)} y2={y(v)} /><text className="evidence-axis" x={M.l - 4} y={y(v) + 4} textAnchor="end">{Math.round(v * 100)}%</text></g>)}
    {share.map((s, i) => { const x = M.l + i * bw + (bw - barW) / 2; const top = y(Math.min(s, 0.6)); return <g key={i}><title>{`${labels[i]}시간: ${(s * 100).toFixed(1)}%`}</title><rect className="evidence-hist-bar" x={x} y={top} width={barW} height={y(0) - top} rx={Math.min(3, barW / 2)} style={{ transitionDelay: `${i * 45}ms` }} /><text className="evidence-axis" x={x + barW / 2} y={H - M.b + 20} textAnchor="middle">{labels[i]}</text></g> })}
  </svg></div><span className="evidence-caption">대기 시간(h)별 항차 비율</span></div>
}
