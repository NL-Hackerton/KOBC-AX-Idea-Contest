import { useEffect, useMemo, useState } from 'react'
import { getPortState, hasServer, postDecision, replayCase, replayIndex } from '../api'
import BerthFanChart from '../components/BerthFanChart'
import QueuePanel from '../components/QueuePanel'
import RecommendationCard from '../components/RecommendationCard'
import RevealPanel from '../components/RevealPanel'
import Segmented from '../components/Segmented'
import { addHours, fmtDT, fromLocalInput, toLocalInput } from '../lib/time'
import type { Action, AppState } from '../state'
import type { Condition, Inbound, LiveDecision, PortState, ReplayCase, Risk } from '../types'

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
  return (
    <div className="screen decision">
      <div className="toolbar">
        <Segmented
          label="모드"
          value={state.mode}
          options={[
            { value: 'replay', label: '재생', hint: '2026-08~09 실제 항차를 결정 시각부터 다시 본다' },
            { value: 'live', label: '실시간', hint: '지금 공개 데이터로 들어오는 배의 도착을 정한다' },
          ]}
          onChange={(m) => dispatch({ type: 'mode', mode: m })}
        />
      </div>
      {state.mode === 'replay' ? <Replay state={state} dispatch={dispatch} /> : <Live state={state} dispatch={dispatch} />}
    </div>
  )
}

function Controls({ state, dispatch }: { state: AppState; dispatch: (a: Action) => void }) {
  return (
    <div className="toolbar">
      <Segmented label="정보 조건" value={state.condition} options={COND_OPTS} onChange={(c) => dispatch({ type: 'condition', condition: c })} />
      <Segmented label="위험 수준" value={state.risk} options={RISK_OPTS} onChange={(r) => dispatch({ type: 'risk', risk: r })} />
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
  if (!idx || !c) return <p className="muted">재생 사례를 불러오지 못했습니다.</p>
  const cond = c.conditions[state.condition]
  const pol = cond.policies[state.risk]
  const maxEnd = new Date(addHours(c.a0, c.maxDelayH)).toISOString()
  return (
    <>
      <div className="toolbar picker">
        <label className="small muted">
          항만{' '}
          <select value={port} onChange={(e) => setPort(e.target.value)}>
            {['전체', ...PORTS].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="small muted grow">
          항차{' '}
          <select value={c.id} onChange={(e) => dispatch({ type: 'openReplay', id: e.target.value })}>
            <optgroup label="대표 사례">
              {idx.featured.map((f) => {
                const x = replayCase(f)!
                return (
                  <option key={`f-${f}`} value={f}>
                    {x.port} {x.vessel} → {x.berth} ({fmtDT(x.a0)})
                  </option>
                )
              })}
            </optgroup>
            <optgroup label={`결정 시각에 선석이 차 있던 항차 (${list.length})`}>
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.port} {fmtDT(x.a0)} {x.vessel} → {x.berth}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>
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
      <div className="decision-grid">
        <QueuePanel queue={cond.queue} busy={c.busyAtTau} berth={c.berth} revealed={state.revealed} />
        <section className="panel chart" aria-label="선석이 비는 시각">
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
        <RecommendationCard policies={cond.policies} risk={state.risk} a0={c.a0} designSpeedKn={c.designSpeedKn} busy={c.busyAtTau} vessel={c.vessel} berth={c.berth} replay />
      </div>
      <RevealPanel revealed={state.revealed} onReveal={() => dispatch({ type: 'reveal', revealed: true })} actualFree={c.actualFree} actualWaitH={c.actualWaitH} policy={pol} busy={c.busyAtTau} />
    </>
  )
}

function CaseHeader(p: { vessel: string; callsign: string; kind: string; gt: number | null; domestic: boolean; port: string; berth: string; anchorage?: string; a0: string; tau: string; horizonH: number }) {
  return (
    <header className="case-head">
      <h2>
        {p.vessel} <span className="muted small">{p.callsign}</span>
      </h2>
      <p className="small muted num">
        {p.kind}, 총톤수 {p.gt?.toLocaleString('ko-KR') ?? '-'}, {p.domestic ? '내항' : '외항'}
        {'  '}|{'  '}
        {p.port} → <strong className="ink">{p.berth}</strong>
        {p.anchorage ? ` (정박지 ${p.anchorage})` : ''}
      </p>
      <p className="small num">
        도착 예정 <strong>{fmtDT(p.a0)}</strong>, 결정 시각 {fmtDT(p.tau)} ({p.horizonH.toFixed(0)}시간 전)
      </p>
    </header>
  )
}

function Live({ state, dispatch }: { state: AppState; dispatch: (a: Action) => void }) {
  const [ps, setPs] = useState<PortState | null>(null)
  const [pick, setPick] = useState<string>('')
  const [form, setForm] = useState({ vessel: '', callsign: '', group: '탱커·가스', gt: 5000, domestic: false, berth: '', eta: '' })
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
      const first = want ?? s?.inbound.find((i) => i.targetKey)
      if (first) choose(first, s!)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port, state.liveShipId])

  const berthName = (key: string | null, s: PortState) => s.singleBerths.find((b) => b.key === key)?.name ?? ''
  function choose(i: Inbound, s: PortState) {
    setPick(i.id)
    setForm({ vessel: i.vessel, callsign: i.callsign, group: GROUPS.includes(i.group) ? i.group : '기타', gt: i.gt ?? 5000, domestic: i.domestic, berth: berthName(i.targetKey, s), eta: i.eta })
  }

  const sig = `${port}|${form.berth}|${form.eta}|${form.vessel}|${form.gt}|${form.group}|${form.domestic}`

  async function run(cond: Condition) {
    if (!form.berth || !form.eta) return
    const k = `${sig}|${cond}`
    setBusy(true)
    setErr(null)
    const r = await postDecision({
      port,
      berth: form.berth,
      vessel: { vessel: form.vessel, callsign: form.callsign, group: form.group, gt: form.gt, domestic: form.domestic },
      eta: form.eta,
      condition: cond,
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
  const inbound = ps?.inbound.filter((i) => i.targetKey) ?? []
  return (
    <>
      <div className="toolbar picker">
        <label className="small muted">
          항만{' '}
          <select value={port} onChange={(e) => dispatch({ type: 'openLive', port: e.target.value })}>
            {PORTS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="small muted grow">
          입항 예정 선박 (예측 대상 선석으로 신고된 배 {inbound.length}척){' '}
          <select value={pick} onChange={(e) => ps && choose(inbound.find((i) => i.id === e.target.value)!, ps)}>
            <option value="">직접 입력</option>
            {inbound.map((i) => (
              <option key={i.id} value={i.id}>
                {fmtDT(i.eta)} {i.vessel} → {berthName(i.targetKey, ps!)} ({i.source === 'pre' ? '사전 신고' : '최종 신고'})
              </option>
            ))}
          </select>
        </label>
      </div>
      {!hasServer() && <p className="notice">실시간 서버에 연결되어 있지 않습니다. 저장된 항만 상태로 선박 목록은 보이지만, 권고 계산은 재생 모드에서 확인해 주세요.</p>}
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
      {err && <p className="notice error">{err}</p>}
      {d && (
        <>
          <CaseHeader vessel={form.vessel || '직접 입력 선박'} callsign={form.callsign} kind={form.group} gt={form.gt} domestic={form.domestic} port={port} berth={d.berth} a0={d.a0} tau={d.tau} horizonH={d.horizonH} />
          <Controls state={state} dispatch={dispatch} />
          <div className="decision-grid">
            <QueuePanel queue={d.queue} busy={d.busyAtTau} berth={d.berth} revealed={false} />
            <section className="panel chart" aria-label="선석이 비는 시각">
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
            <RecommendationCard policies={d.policies} risk={state.risk} a0={d.a0} designSpeedKn={d.designSpeedKn} busy={d.busyAtTau} vessel={form.vessel} berth={d.berth} replay={false} />
          </div>
          <p className="small muted live-note">
            {fmtDT(d.tau)} 공개 데이터 기준 권고입니다. 선석 상황이 바뀌면 다시 계산하세요. 실제 결과는 항차가 끝난 뒤 이 시스템의 수집 데이터로 확인할 수 있습니다.
          </p>
        </>
      )}
    </>
  )
}
