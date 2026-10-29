import { useEffect, useMemo, useState } from 'react'
import { getPortState, hasServer, postDecision, replayCase, replayIndex, savedDecision, snapshotMeta } from '../api'
import BerthFanChart from '../components/BerthFanChart'
import QueuePanel from '../components/QueuePanel'
import RecommendationCard from '../components/RecommendationCard'
import RevealPanel from '../components/RevealPanel'
import Segmented from '../components/Segmented'
import { fromLive, fromReplay } from '../lib/summary'
import { addHours, fmtDT, fromLocalInput, toLocalInput } from '../lib/time'
import type { Action, AppState } from '../state'
import type { Condition, DecisionSummary, Inbound, LiveDecision, Policy, PortState, ReplayCase, Risk } from '../types'
import { PageHeader, Kpi } from '../components/ui'
import Icon from '../components/Icon'
import shipIcon from '../assets/icons/ship.svg'
import chevronIcon from '../assets/icons/chevron.svg'
import fuelIcon from '../assets/icons/decision-fuel.svg'
import cloudIcon from '../assets/icons/decision-cloud.svg'
import clockIcon from '../assets/icons/decision-clock.svg'
import gaugeIcon from '../assets/icons/decision-gauge.svg'
import '../styles/decision.css'

const PORTS = ['울산', '대산', '광양', '여천']
const GROUPS = ['탱커·가스', '벌크', '일반화물', '컨테이너', '자동차운반', '기타']
const COND_OPTS: { value: Condition; label: string; hint: string }[] = [
  { value: 'public', label: '공개 데이터만', hint: '지금 선석에 접안한 배만 반영합니다.' },
  { value: 'lineup', label: '대기 순번 공유', hint: '정박지에서 기다리는 앞 순번 배의 목적 선석과 순번을 반영합니다.' },
  { value: 'plan', label: '선석계획 공유', hint: '앞으로 올 배의 순서와 도착 예정까지 반영합니다.' },
]
const RISK_OPTS: { value: Risk; label: string; hint: string }[] = [
  { value: '0.1', label: '0.1', hint: '선석이 이미 비어 있을 확률이 10%인 시각에 도착합니다. 가장 보수적입니다.' },
  { value: '0.2', label: '0.2', hint: '선석이 이미 비어 있을 확률이 20%인 시각에 도착합니다.' },
  { value: '0.3', label: '0.3', hint: '선석이 이미 비어 있을 확률이 30%인 시각에 도착합니다.' },
  { value: '0.5', label: '0.5', hint: '중앙값에 맞춰 도착합니다. 절감은 크지만 늦게 도착할 위험도 커집니다.' },
]

export default function Decision({ state, dispatch }: { state: AppState; dispatch: (a: Action) => void }) {
  return (
    <div className="screen decision">
      {state.mode === 'replay' ? <Replay state={state} dispatch={dispatch} /> : <Live state={state} dispatch={dispatch} />}
    </div>
  )
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
    <div className="card decision-controls">
      <div><Segmented variant="primary" label="정보 조건" value={state.condition} options={COND_OPTS} onChange={(c) => dispatch({ type: 'condition', condition: c })} /></div>
      <div><Segmented variant="primary" label="위험 수준" value={state.risk} options={RISK_OPTS} onChange={(r) => dispatch({ type: 'risk', risk: r })} /></div>
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
  return (
    <>
      <PageHeader title="항차 결정" sub={`${c.a0.slice(0, 10)} ${c.vessel} 실제 항차를 결정 시각부터 다시 봅니다.`} right={
        <details className="voyage-picker"><summary className="btn"><Icon src={shipIcon} size={16} />{c.port} · {c.vessel} → {c.berth} · {fmtDT(c.a0)} 도착 예정<Icon src={chevronIcon} size={16} /></summary>
          <div className="voyage-popover card"><label className="field"><span>항만</span><select value={port} onChange={e => setPort(e.target.value)}>{['전체', ...PORTS].map(p => <option key={p}>{p}</option>)}</select></label>
          <div role="listbox" aria-label="재생 항차"><h3>대표 사례</h3>{idx.featured.map(f => { const x = replayCase(f)!; return <button role="option" aria-selected={c.id === f} className="voyage-option" key={f} onClick={e => { dispatch({ type: 'openReplay', id: f }); e.currentTarget.closest('details')?.removeAttribute('open') }}>{x.port} · {x.vessel} → {x.berth}<small>{fmtDT(x.a0)} 도착 예정</small></button> })}
          <h3>결정 시각에 선석이 차 있던 항차 ({list.length})</h3>{list.map(x => <button role="option" aria-selected={c.id === x.id} className="voyage-option" key={x.id} onClick={e => { dispatch({ type: 'openReplay', id: x.id }); e.currentTarget.closest('details')?.removeAttribute('open') }}>{x.port} · {x.vessel} → {x.berth}<small>{fmtDT(x.a0)}</small></button>)}</div></div>
        </details>
      } />
      <div className="decision-columns" key={c.id}><div className="decision-main case-transition">
      <CaseHeader
        vessel={c.vessel}
        callsign={c.callsign}
        kind={c.kind}
        gt={c.gt}
        domestic={c.domestic}
        port={c.port}
        berth={c.berth}
        anchorage={c.anchorage}
        a0={c.a0}
        tau={c.tau}
        horizonH={c.horizonH}
      />
      <Controls state={state} dispatch={dispatch} />
      <DecisionKpis policy={pol} a0={c.a0} designSpeed={c.designSpeedKn} />
        <QueuePanel queue={cond.queue} busy={c.busyAtTau} berth={c.berth} revealed={state.revealed} tau={c.tau} a0={c.a0} rta={pol.rta} vessel={c.vessel} quantilesH={cond.quantilesH} maxDelayH={c.maxDelayH} />
        <section className="card chart" aria-label="선석이 비는 시각">
          <div className="panel-head">
            <h3>선석이 비는 시각</h3>
            <button className="link small" onClick={() => setTable(!table)}>
              {table ? '차트로 보기' : '표로 보기'}
            </button>
          </div>
          <BerthFanChart
            tau={c.tau}
            nominal={idx.nominal}
            quantilesH={cond.quantilesH}
            busy={c.busyAtTau}
            a0={c.a0}
            rta={pol.rta}
            maxDelayEnd={maxEnd}
            actualFree={state.revealed ? c.actualFree : null}
            showTable={table}
          />
        </section>
      </div><aside className="decision-aside">
        <RecommendationCard policies={cond.policies} risk={state.risk} a0={c.a0} designSpeedKn={c.designSpeedKn} busy={summary.busyAtTau} replay summary={summary} exampleKey={exampleKey} />
        <RevealPanel revealed={state.revealed} onReveal={() => dispatch({ type: 'reveal', revealed: true })} actualFree={c.actualFree} actualWaitH={c.actualWaitH} policy={pol} busy={c.busyAtTau} />
      </aside></div>
    </>
  )
}

function DecisionKpis({ policy: p, a0, designSpeed }: { policy: Policy; a0: string; designSpeed: number }) {
  return <div className="kpi-row"><Kpi icon={fuelIcon} tone="good" label="절감 연료" value={p.fuelT} format={n => n.toFixed(1)} unit="t" sub="설계 속도 대비" /><Kpi icon={cloudIcon} tone="good" label="절감 CO2" value={p.co2T} format={n => n.toFixed(1)} unit="t" sub="연료 절감량 환산" /><Kpi icon={clockIcon} tone="wait" label="늦춤 시간" value={p.delayH} format={n => n.toFixed(1)} unit="시간" sub={`도착 예정 ${fmtDT(a0)} 기준`} /><Kpi icon={gaugeIcon} label="권고 속도" value={p.speedKn} format={n => n.toFixed(1)} unit="노트" sub={`설계 ${designSpeed.toFixed(1)}노트`} /></div>
}

function CaseHeader(p: { vessel: string; callsign: string; kind: string; gt: number | null; domestic: boolean; port: string; berth: string; anchorage?: string; a0: string; tau: string; horizonH: number; live?: boolean }) {
  return <header className="card vessel-card"><span className="vessel-icon"><Icon src={shipIcon} size={24} /></span><div className="vessel-identity"><div><h2>{p.vessel}</h2><span className={`badge plain${p.live ? ' warn' : ''}`}>{p.live ? '사전 신고' : '재생 항차'}</span></div><p>{p.callsign || '호출부호 미입력'} · {p.kind} · 총톤수 {p.gt?.toLocaleString('ko-KR') ?? '-'} · {p.domestic ? '내항' : '외항'}</p></div><dl className="vessel-facts"><div><dt>항로</dt><dd>{p.anchorage ? `${p.port} 정박지·${p.anchorage}` : p.port} → {p.berth}</dd></div><div><dt>도착 예정</dt><dd>{fmtDT(p.a0)}</dd></div><div><dt>결정 시각</dt><dd>{fmtDT(p.tau)}</dd></div></dl></header>
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
  return (
    <>
      <PageHeader title="항차 결정" sub="지금 공개 데이터로 들어오는 배의 도착 시각을 정합니다." right={<details className="voyage-picker"><summary className="btn"><Icon src={shipIcon} size={16} />{port} · {form.vessel || '직접 입력'} → {form.berth || '선석 선택'}{form.eta ? ` · ${fmtDT(form.eta)} 도착 예정` : ''}<Icon src={chevronIcon} size={16} /></summary><div className="voyage-popover card"><label className="field"><span>항만</span><select value={port} onChange={e => dispatch({ type: 'openLive', port: e.target.value })}>{PORTS.map(p => <option key={p}>{p}</option>)}</select></label><div role="listbox" aria-label="입항 예정 선박"><h3>입항 예정 선박 ({inbound.length}척)</h3><button role="option" aria-selected={!pick} className="voyage-option" onClick={e => { setPick(''); setForm(f => ({ ...f, vessel: '', callsign: '' })); e.currentTarget.closest('details')?.removeAttribute('open') }}>직접 입력</button>{inbound.map(i => <button key={i.id} role="option" aria-selected={pick === i.id} className="voyage-option" onClick={e => { if (ps) choose(i, ps); e.currentTarget.closest('details')?.removeAttribute('open') }}>{i.vessel} → {berthName(i.targetKey, ps!)}<small>{fmtDT(i.eta)} · {i.source === 'pre' ? '사전 신고' : '최종 신고'}</small></button>)}</div></div></details>} />
      {!hasServer() && (
        <p className="notice small">
          이 배포본은 {snapshotMeta.snapshotDate ? fmtDT(snapshotMeta.snapshotDate) : '저장본'} 기준 공개 데이터로 고정되어 있습니다.
        </p>
      )}
      <details className={`manual${pick ? ' manual-compact' : ' card'}`} open={pick === ''}>
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
        <div className="decision-columns" key={pick || sig}><div className="decision-main case-transition">
          <CaseHeader live vessel={form.vessel || '직접 입력 선박'} callsign={form.callsign} kind={form.group} gt={form.gt} domestic={form.domestic} port={port} berth={d.berth} a0={d.a0} tau={d.tau} horizonH={d.horizonH} />
          <Controls state={state} dispatch={dispatch} />
          <DecisionKpis policy={d.policies[state.risk]} a0={d.a0} designSpeed={d.designSpeedKn} />
            <QueuePanel queue={d.queue} busy={d.busyAtTau} berth={d.berth} revealed={false} tau={d.tau} a0={d.a0} rta={d.policies[state.risk].rta} vessel={form.vessel} quantilesH={d.quantilesH} maxDelayH={d.maxDelayH} />
            <section className="card chart" aria-label="선석이 비는 시각">
              <div className="panel-head">
                <h3>선석이 비는 시각</h3>
                <button className="link small" onClick={() => setTable(!table)}>
                  {table ? '차트로 보기' : '표로 보기'}
                </button>
              </div>
              <BerthFanChart
                tau={d.tau}
                nominal={replayIndex()?.nominal ?? []}
                quantilesH={d.quantilesH}
                busy={d.busyAtTau}
                a0={d.a0}
                rta={d.policies[state.risk].rta}
                maxDelayEnd={new Date(addHours(d.a0, d.maxDelayH)).toISOString()}
                showTable={table}
              />
            </section>
          </div><aside className="decision-aside">
            <RecommendationCard policies={d.policies} risk={state.risk} a0={d.a0} designSpeedKn={d.designSpeedKn} busy={d.busyAtTau} replay={false} summary={fromLive(d, state.risk, port, form.vessel, form.group, form.gt)} exampleKey={null} />
            <section className="card"><h3>다시 계산 안내</h3><p className="small muted">{fmtDT(d.tau)} 공개 데이터 기준 권고입니다. 선석 상황이 바뀌면 다시 계산하세요.</p></section>
          </aside></div>
      )}
    </>
  )
}
