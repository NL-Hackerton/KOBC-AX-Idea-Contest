import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getPortState, hasServer, postDecision, replayCase, replayIndex, savedDecision, snapshotMeta } from '../api'
import BerthFanChart from '../components/BerthFanChart'
import { IconClock, IconFuel, IconGauge, IconLeaf } from '../components/Icons'
import KpiCard from '../components/KpiCard'
import PageHeader from '../components/PageHeader'
import QueuePanel from '../components/QueuePanel'
import RecommendationCard from '../components/RecommendationCard'
import RevealPanel from '../components/RevealPanel'
import Segmented from '../components/Segmented'
import { sharedWindow } from '../lib/axis'
import { fromLive, fromReplay } from '../lib/summary'
import { addHours, fmtDT, fromLocalInput, ms, toLocalInput } from '../lib/time'
import type { Action, AppState } from '../state'
import type { Condition, DecisionSummary, Inbound, LiveDecision, Policy, PortState, QueueMember, ReplayCase, Risk } from '../types'

const PORTS = ['울산', '대산', '광양', '여천']
const GROUPS = ['탱커·가스', '벌크', '일반화물', '컨테이너', '자동차운반', '기타']
const COND_OPTS: { value: Condition; label: string; hint: string }[] = [
  { value: 'public', label: '공개 데이터만', hint: '지금 선석에 붙어 있는 배만 안다' },
  { value: 'lineup', label: '대기 순번 공유', hint: '정박지에서 기다리는 앞 순번 배의 목적 선석과 순번을 안다' },
  { value: 'plan', label: '선석계획 공유', hint: '앞으로 올 배의 순서와 도착 예정까지 안다' },
]
const RISK_OPTS: { value: Risk; label: string; hint: string }[] = [
  { value: '0.1', label: '0.1', hint: '선석이 이미 비어 있을 확률이 10%인 시각에 도착. 가장 보수적' },
  { value: '0.2', label: '0.2', hint: '선석이 이미 비어 있을 확률 20%' },
  { value: '0.3', label: '0.3', hint: '선석이 이미 비어 있을 확률 30%' },
  { value: '0.5', label: '0.5', hint: '중앙값에 맞춰 도착. 절감은 크지만 늦게 도착할 위험도 크다' },
]

export default function Decision({ state, dispatch }: { state: AppState; dispatch: (a: Action) => void }) {
  return <div className="screen decision">{state.mode === 'replay' ? <Replay state={state} dispatch={dispatch} /> : <Live state={state} dispatch={dispatch} />}</div>
}

function hoursOf(tau: string, iso: string) {
  return (ms(iso) - ms(tau)) / 3600000
}

function queueWindow(tau: string, queue: QueueMember[], a0: string, rta: string, quantiles: number[], maxEnd: string) {
  const pts = [hoursOf(tau, a0), hoursOf(tau, rta), hoursOf(tau, maxEnd), ...quantiles]
  for (const m of queue) {
    const start = m.status === 'berthed' && m.elapsedH != null ? -m.elapsedH : m.arrivedAt ? hoursOf(tau, m.arrivedAt) : m.plannedAt ? hoursOf(tau, m.plannedAt) : 0
    const hi = m.predQ[m.predQ.length - 1] ?? 0
    pts.push(start, start + hi)
  }
  return sharedWindow(tau, pts)
}

/** 지금 보고 있는 권고를 앱 상태에 남긴다 (에이전트 화면의 문안·정산 계산기가 이어받는다). */
function useCurrent(dispatch: (a: Action) => void, key: string | null, make: () => DecisionSummary | null) {
  useEffect(() => {
    const summary = key ? make() : null
    dispatch({ type: 'current', value: summary ? { key: key!.startsWith('live|') ? null : key, summary } : null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

function Controls({ state, dispatch }: { state: AppState; dispatch: (a: Action) => void }) {
  return (
    <div className="toolbar">
      <Segmented variant="accent" label="정보 조건" value={state.condition} options={COND_OPTS} onChange={(c) => dispatch({ type: 'condition', condition: c })} />
      <Segmented variant="accent" label="위험 수준" value={state.risk} options={RISK_OPTS} onChange={(r) => dispatch({ type: 'risk', risk: r })} />
    </div>
  )
}

function Replay({ state, dispatch }: { state: AppState; dispatch: (a: Action) => void }) {
  const idx = replayIndex()
  const [port, setPort] = useState<string>('전체')
  const [table, setTable] = useState(false)
  const id = state.caseId ?? idx?.featured[0] ?? null
  const c: ReplayCase | undefined = id ? replayCase(id) : undefined
  const list = useMemo(() => {
    const cs = (idx?.cases ?? []).filter((x) => x.busyAtTau && (port === '전체' || x.port === port))
    return cs.sort((a, b) => a.a0.localeCompare(b.a0))
  }, [idx, port])
  useCurrent(dispatch, c ? `${c.id}|${state.condition}|${state.risk}` : null, () => (c ? fromReplay(c, state.condition, state.risk) : null))
  if (!idx || !c) return <p className="muted">재생 사례를 불러오지 못했습니다.</p>
  const cond = c.conditions[state.condition]
  const pol = cond.policies[state.risk]
  const maxEnd = new Date(addHours(c.a0, c.maxDelayH)).toISOString()
  const summary = fromReplay(c, state.condition, state.risk)
  const exampleKey = `${c.id}|${state.condition}|${state.risk}`
  const condLabel = COND_OPTS.find((o) => o.value === state.condition)?.label ?? state.condition
  return (
    <>
      <PageHeader
        title="항차 결정"
        lede="2026-08-09 실제 항차를 결정 시각부터 다시 봅니다."
        extra={
          <label className="case-pick">
            <span className="sr-only">항차</span>
            <select value={c.id} onChange={(e) => dispatch({ type: 'openReplay', id: e.target.value })}>
              <optgroup label="대표 사례">
                {idx.featured.map((f) => {
                  const x = replayCase(f)!
                  return (
                    <option key={`f-${f}`} value={f}>
                      {x.port} · {x.vessel} → {x.berth} · {fmtDT(x.a0)} 도착 예정
                    </option>
                  )
                })}
              </optgroup>
              <optgroup label={`결정 시각에 선석이 차 있던 항차 (${list.length})`}>
                {list.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.port} · {x.vessel} → {x.berth} · {fmtDT(x.a0)}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        }
      />
      <label className="small muted port-filter">
        항만 필터{' '}
        <select value={port} onChange={(e) => setPort(e.target.value)}>
          {['전체', ...PORTS].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <CaseHeader vessel={c.vessel} callsign={c.callsign} kind={c.kind} gt={c.gt} domestic={c.domestic} port={c.port} berth={c.berth} anchorage={c.anchorage} a0={c.a0} tau={c.tau} horizonH={c.horizonH} badge="재생 항차" />
      <Controls state={state} dispatch={dispatch} />
      <DecisionStage
        tau={c.tau}
        queue={cond.queue}
        busy={c.busyAtTau}
        berth={c.berth}
        revealed={state.revealed}
        a0={c.a0}
        rta={pol.rta}
        quantiles={cond.quantilesH}
        nominal={idx.nominal}
        maxEnd={maxEnd}
        actualFree={state.revealed ? c.actualFree : null}
        table={table}
        setTable={setTable}
        vessel={c.vessel}
        risk={state.risk}
        policies={cond.policies}
        designSpeedKn={c.designSpeedKn}
        replay
        summary={summary}
        exampleKey={exampleKey}
        conditionLabel={condLabel}
        reveal={<RevealPanel revealed={state.revealed} onReveal={() => dispatch({ type: 'reveal', revealed: true })} actualFree={c.actualFree} actualWaitH={c.actualWaitH} policy={pol} busy={c.busyAtTau} />}
      />
    </>
  )
}

function CaseHeader(p: { vessel: string; callsign: string; kind: string; gt: number | null; domestic: boolean; port: string; berth: string; anchorage?: string; a0: string; tau: string; horizonH: number; badge: string }) {
  const route = p.anchorage ? `${p.port} 정박지 ${p.anchorage} → ${p.berth}` : `${p.port} → ${p.berth}`
  return (
    <header className="case-head">
      <div className="case-id">
        <span className="harbor-card-ico" aria-hidden>
          <IconShipMini />
        </span>
        <div>
          <h2>
            {p.vessel} <span className="pill">{p.badge}</span>
          </h2>
          <p className="small muted num">
            {p.callsign} · {p.kind} · 총톤수 {p.gt?.toLocaleString('ko-KR') ?? '-'} · {p.domestic ? '내항' : '외항'}
          </p>
        </div>
      </div>
      <dl className="case-facts num">
        <div>
          <dt>항로</dt>
          <dd>{route}</dd>
        </div>
        <div>
          <dt>도착 예정</dt>
          <dd>{fmtDT(p.a0)}</dd>
        </div>
        <div>
          <dt>결정 시각</dt>
          <dd>
            {fmtDT(p.tau)} <span className="muted">({p.horizonH.toFixed(0)}시간 전)</span>
          </dd>
        </div>
      </dl>
    </header>
  )
}

function IconShipMini() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M3 16l2-6h14l2 6M4 16h16l-1.2 3.2a2 2 0 0 1-1.9 1.3H7.1a2 2 0 0 1-1.9-1.3L4 16zM12 10V4" />
    </svg>
  )
}

function DecisionStage(p: {
  tau: string
  queue: QueueMember[]
  busy: boolean
  berth: string
  revealed: boolean
  a0: string
  rta: string
  quantiles: number[]
  nominal: number[]
  maxEnd: string
  actualFree?: string | null
  table: boolean
  setTable: (v: boolean) => void
  vessel: string
  risk: Risk
  policies: Record<Risk, Policy>
  designSpeedKn: number
  replay: boolean
  summary: DecisionSummary
  exampleKey: string | null
  conditionLabel: string
  loading?: boolean
  empty?: boolean
  reveal?: ReactNode
  note?: ReactNode
}) {
  const windowH = queueWindow(p.tau, p.queue, p.a0, p.rta, p.quantiles, p.maxEnd)
  const pol = p.policies[p.risk]
  const keep = !p.busy || pol.delayH < 0.05
  return (
    <>
      <div className="kpi-row">
        <KpiCard icon={<IconFuel size={16} />} label="절감 연료" value={pol.fuelT.toFixed(1)} unit="t" sub="설계 속도 대비" loading={p.loading} empty={p.empty} />
        <KpiCard icon={<IconLeaf size={16} />} label="절감 CO2" value={pol.co2T.toFixed(1)} unit="t" sub="연료 계수 가정" loading={p.loading} empty={p.empty} />
        <KpiCard icon={<IconClock size={16} />} label="늦출 시간" value={pol.delayH.toFixed(1)} unit="시간" sub={`도착 예정 ${fmtDT(p.a0)} 기준`} loading={p.loading} empty={p.empty} />
        <KpiCard icon={<IconGauge size={16} />} label="권고 속도" value={pol.speedKn.toFixed(1)} unit="노트" sub={`설계 ${p.designSpeedKn.toFixed(1)}노트`} loading={p.loading} empty={p.empty} />
      </div>
      <div className="decision-layout">
        <div className="decision-main">
          <QueuePanel
            queue={p.queue}
            busy={p.busy}
            berth={p.berth}
            revealed={p.revealed}
            tau={p.tau}
            windowH={windowH}
            current={{ vessel: p.vessel, a0: p.a0, rta: keep ? null : p.rta }}
            loading={p.loading}
          />
          <section className="panel chart" aria-label="선석이 비는 시각">
            <div className="panel-head">
              <h3>선석이 비는 시각</h3>
              <button type="button" className="link small" onClick={() => p.setTable(!p.table)}>
                {p.table ? '차트로 보기' : '표로 보기'}
              </button>
            </div>
            <p className="small muted">이 시각까지 선석이 빌 확률. 20–80% 구간 {fmtDT(p.a0)} 전후, 중앙은 분포의 P50.</p>
            <div className="chart-pad">
              <BerthFanChart
                tau={p.tau}
                nominal={p.nominal}
                quantilesH={p.quantiles}
                busy={p.busy}
                a0={p.a0}
                rta={p.rta}
                maxDelayEnd={p.maxEnd}
                actualFree={p.actualFree}
                showTable={p.table}
                windowH={windowH}
                riskLabel={`P${Math.round(Number(p.risk) * 100)}`}
              />
            </div>
          </section>
        </div>
        <div className="rec-col">
          <RecommendationCard
            policies={p.policies}
            risk={p.risk}
            a0={p.a0}
            designSpeedKn={p.designSpeedKn}
            busy={p.summary.busyAtTau}
            replay={p.replay}
            summary={p.summary}
            exampleKey={p.exampleKey}
            conditionLabel={p.conditionLabel}
            loading={p.loading}
            empty={p.empty}
          />
          {p.reveal}
          {p.note}
        </div>
      </div>
    </>
  )
}

function Live({ state, dispatch }: { state: AppState; dispatch: (a: Action) => void }) {
  const [ps, setPs] = useState<PortState | null>(null)
  const [pick, setPick] = useState<string>('')
  const [form, setForm] = useState({ vessel: '', callsign: '', group: '탱커·가스', gt: 5000, domestic: false, berth: '', eta: '' })
  const [chosen, setChosen] = useState('') // 목록에서 고른 배의 항차 정보 (배포본에서 미리 계산한 권고와 맞는지 확인)
  const [results, setResults] = useState<Record<string, LiveDecision>>({})
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [table, setTable] = useState(false)
  const port = PORTS.includes(state.port) ? state.port : '울산'

  useEffect(() => {
    setPs(null)
    getPortState(port).then((s) => {
      setPs(s)
      const want = s?.inbound.find((i) => i.id === state.liveShipId && i.targetKey)
      const hoKey = state.handoff?.port === port ? s?.singleBerths.find((b) => b.name === state.handoff!.berth)?.key : undefined
      const forHandoff = hoKey ? s?.inbound.find((i) => i.targetKey === hoKey) : undefined
      const first = want ?? forHandoff ?? s?.inbound.find((i) => i.targetKey)
      if (hoKey && !want && !forHandoff && s) {
        setPick('')
        const eta = new Date(Date.now() + 24 * 3600000)
        eta.setMinutes(0, 0, 0)
        setForm((f) => ({ ...f, vessel: '', callsign: '', berth: state.handoff!.berth, eta: eta.toISOString() }))
      } else if (first) choose(first, s!)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port, state.liveShipId])

  const berthName = (key: string | null, s: PortState) => s.singleBerths.find((b) => b.key === key)?.name ?? ''
  function choose(i: Inbound, s: PortState) {
    setPick(i.id)
    const f = { vessel: i.vessel, callsign: i.callsign, group: GROUPS.includes(i.group) ? i.group : '기타', gt: i.gt ?? 5000, domestic: i.domestic, berth: berthName(i.targetKey, s), eta: i.eta }
    setForm(f)
    setChosen(JSON.stringify(f))
  }

  const ho = state.handoff && state.handoff.port === port && state.handoff.berth === form.berth ? state.handoff : null
  const hoLineup = ho ? ho.ships.filter((x) => x.status === 'waiting' && x.time) : []
  const hoPlan = ho ? ho.ships.filter((x) => x.status === 'inbound' && x.time) : []
  const sig = `${port}|${form.berth}|${form.eta}|${form.vessel}|${form.gt}|${form.group}|${form.domestic}|${ho ? ho.ships.length : 0}`

  async function run(cond: Condition) {
    if (!form.berth || !form.eta) return
    const k = `${sig}|${cond}`
    if (!hasServer()) {
      const saved = pick && JSON.stringify(form) === chosen && !ho ? savedDecision(pick, cond) : null
      setErr(null)
      if (saved) setResults((x) => ({ ...x, [k]: saved }))
      else setErr('이 배포본에서는 입항 예정 목록의 배만 미리 계산한 권고를 볼 수 있습니다. 직접 입력하거나 고친 항차는 서버를 실행하면 계산합니다.')
      return
    }
    setBusy(true)
    setErr(null)
    const r = await postDecision({
      port,
      berth: form.berth,
      vessel: { vessel: form.vessel, callsign: form.callsign, group: form.group, gt: form.gt, domestic: form.domestic },
      eta: form.eta,
      condition: cond,
      lineup: hoLineup.map((x) => ({ vessel: x.vessel, group: form.group, gt: null, arrivedAt: x.time! })),
      plan: hoPlan.map((x) => ({ vessel: x.vessel, group: form.group, gt: null, eta: x.time! })),
    })
    setBusy(false)
    if ('error' in r) setErr(r.error)
    else setResults((x) => ({ ...x, [k]: r }))
  }

  useEffect(() => {
    if (form.berth && form.eta && !results[`${sig}|${state.condition}`]) run(state.condition)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.condition, sig])

  const d = results[`${sig}|${state.condition}`]
  useCurrent(dispatch, d ? `live|${sig}|${state.condition}|${state.risk}` : null, () => (d ? fromLive(d, state.risk, port, form.vessel, form.group, form.gt) : null))
  const inbound = ps?.inbound.filter((i) => i.targetKey) ?? []
  const condLabel = COND_OPTS.find((o) => o.value === state.condition)?.label ?? state.condition
  return (
    <>
      <PageHeader
        title="항차 결정"
        lede="지금 공개 데이터로 들어오는 배의 도착 시각을 정합니다."
        extra={
          <div className="case-picks">
            <label className="case-pick">
              <span className="sr-only">항만</span>
              <select value={port} onChange={(e) => dispatch({ type: 'openLive', port: e.target.value })}>
                {PORTS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="case-pick">
              <span className="sr-only">입항 예정 선박</span>
              <select
                value={pick}
                onChange={(e) => {
                  const i = inbound.find((x) => x.id === e.target.value)
                  if (i && ps) choose(i, ps)
                  else {
                    setPick('')
                    setForm((f) => ({ ...f, vessel: '', callsign: '' }))
                  }
                }}
              >
                <option value="">직접 입력</option>
                {inbound.map((i) => (
                  <option key={i.id} value={i.id}>
                    {port} · {i.vessel} → {berthName(i.targetKey, ps!)} · {fmtDT(i.eta)} {i.source === 'pre' ? '사전 신고' : '최종 신고'}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
      />
      {!hasServer() && (
        <p className="notice small">
          이 배포본은 {snapshotMeta.snapshotDate ? fmtDT(snapshotMeta.snapshotDate) : '저장본'} 기준 공개 데이터로 고정되어 있습니다. 입항 예정 목록의 배는 그 시각에 엔진으로 미리 계산한 권고를 보여주고, 직접 입력한 항차는 서버를 실행하면 계산합니다.
        </p>
      )}
      <details className="manual" open={pick === ''}>
        <summary className="small">항차 정보 {pick === '' ? '입력' : '고치기'}</summary>
        <div className="form-grid">
          <label>
            선박명
            <input value={form.vessel} onChange={(e) => setForm({ ...form, vessel: e.target.value })} />
          </label>
          <label>
            선종
            <select value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })}>
              {GROUPS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label>
            총톤수
            <input type="number" min={100} value={form.gt} onChange={(e) => setForm({ ...form, gt: Number(e.target.value) })} />
          </label>
          <label>
            목적 선석
            <select value={form.berth} onChange={(e) => setForm({ ...form, berth: e.target.value })}>
              <option value="">선택</option>
              {(ps?.singleBerths ?? []).map((b) => (
                <option key={b.key}>{b.name}</option>
              ))}
            </select>
          </label>
          <label>
            도착 예정 (KST)
            <input type="datetime-local" value={form.eta ? toLocalInput(form.eta) : ''} onChange={(e) => setForm({ ...form, eta: fromLocalInput(e.target.value) })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={form.domestic} onChange={(e) => setForm({ ...form, domestic: e.target.checked })} /> 내항
          </label>
          <button className="btn primary" disabled={busy || !form.berth || !form.eta} onClick={() => run(state.condition)}>
            {busy ? '계산 중' : '권고 계산'}
          </button>
        </div>
      </details>
      {state.handoff && state.handoff.port === port && (
        <p className="notice small">
          메일에서 구조화한 {state.handoff.berth} 대기 순번 {state.handoff.ships.filter((x) => x.status !== 'berthed').length}척을{' '}
          {ho ? '대기 순번·선석계획 조건에 반영했습니다. 공개 데이터의 대기 선박과 겹치는 배는 한 번만 셉니다.' : `목적 선석을 ${state.handoff.berth}으로 고르면 반영합니다.`}{' '}
          <button className="link" onClick={() => dispatch({ type: 'handoff', value: null })}>
            지우기
          </button>
        </p>
      )}
      {err && <p className="notice error">{err}</p>}
      {d && (
        <>
          <CaseHeader vessel={form.vessel || '직접 입력 선박'} callsign={form.callsign} kind={form.group} gt={form.gt} domestic={form.domestic} port={port} berth={d.berth} a0={d.a0} tau={d.tau} horizonH={d.horizonH} badge={pick ? '사전 신고' : '직접 입력'} />
          <Controls state={state} dispatch={dispatch} />
          <DecisionStage
            tau={d.tau}
            queue={d.queue}
            busy={d.busyAtTau}
            berth={d.berth}
            revealed={false}
            a0={d.a0}
            rta={d.policies[state.risk].rta}
            quantiles={d.quantilesH}
            nominal={replayIndex()?.nominal ?? []}
            maxEnd={new Date(addHours(d.a0, d.maxDelayH)).toISOString()}
            table={table}
            setTable={setTable}
            vessel={form.vessel || '직접 입력 선박'}
            risk={state.risk}
            policies={d.policies}
            designSpeedKn={d.designSpeedKn}
            replay={false}
            summary={fromLive(d, state.risk, port, form.vessel, form.group, form.gt)}
            exampleKey={null}
            conditionLabel={condLabel}
            note={
              <p className="panel small live-note">
                {fmtDT(d.tau)} 공개 데이터 기준 권고입니다. 선석 상황이 바뀌면 다시 계산하세요. 실제 결과는 항차가 끝난 뒤 이 시스템의 수집 데이터로 확인할 수 있습니다.
              </p>
            }
          />
        </>
      )}
      {!d && (busy || (form.berth && form.eta && !err)) && (
        <p className="muted small" aria-live="polite">
          권고를 계산하는 중입니다.
        </p>
      )}
    </>
  )
}
