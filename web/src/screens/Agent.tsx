import { useEffect, useMemo, useRef, useState } from 'react'
import { agentExamples, hasServer, postAgent, read } from '../api'
import AgentNote from '../components/AgentNote'
import GenBadge from '../components/GenBadge'
import Segmented from '../components/Segmented'
import { fmtDT } from '../lib/time'
import type { Action, AgentTab, AppState } from '../state'
import type { AgentMeta, ChatResult, ContractResult, LineupResult, LineupShip, ToolCall } from '../types'

const TABS: { value: AgentTab; label: string; hint: string }[] = [
  { value: 'contract', label: '조항 추출', hint: '용선계약에서 JIT 도착, 신속 항해 의무, 가상 도착, 체선료 조항을 찾는다' },
  { value: 'lineup', label: '메일 구조화', hint: '대리점 대기 순번 메일을 표로 만들어 항차 결정에 넣는다' },
  { value: 'settle', label: '정산 계산기', hint: '감속으로 아낀 연료비와 체선료 변화를 선주·용선자별로 나눈다' },
  { value: 'draft', label: '지시문·요청서', hint: '지금 고른 권고로 선장 지시문과 용선자 요청서를 만든다' },
  { value: 'chat', label: '질의응답', hint: '엔진 도구를 불러 항만 상태·권고·시뮬레이션을 묻고 답한다' },
]

interface Status {
  live: boolean
  model: string
  spentTodayUsd: number
  capUsd: number
}

export default function Agent({ state, dispatch }: { state: AppState; dispatch: (a: Action) => void }) {
  const [st, setSt] = useState<Status | null>(null)
  useEffect(() => {
    read<Status | null>('/api/agent/status', () => null).then(setSt)
  }, [])
  return (
    <div className="screen agent">
      <div className="toolbar">
        <Segmented label="기능" value={state.agentTab} options={TABS} onChange={(t) => dispatch({ type: 'agentTab', tab: t })} />
        <p className="small muted agent-status">
          {!st
            ? '배포본: 예시 계약·메일의 분석 결과와 정산 계산기를 쓸 수 있습니다. 직접 붙여 넣은 문서 분석과 질의응답은 서버를 실행하면 동작합니다.'
            : st.live
              ? `LLM 켜짐 (${st.model}), 오늘 사용 $${st.spentTodayUsd.toFixed(2)} / 상한 $${st.capUsd.toFixed(0)}. 상한을 넘으면 규칙·템플릿으로 바뀝니다.`
              : 'LLM 꺼짐. 같은 화면이 규칙·템플릿과 엔진 도구로 동작합니다.'}
        </p>
      </div>
      {state.agentTab === 'contract' && <ContractTab />}
      {state.agentTab === 'lineup' && <LineupTab dispatch={dispatch} />}
      {state.agentTab === 'settle' && <SettleTab state={state} />}
      {state.agentTab === 'draft' && <DraftTab state={state} dispatch={dispatch} />}
      {state.agentTab === 'chat' && <ChatTab />}
    </div>
  )
}

type Res<T> = { data: T & AgentMeta; offline: boolean } | { error: string } | null

/** 서버 결과를 받고, 서버가 없으면 같은 본문의 저장 예시를 쓴다. */
async function runWithExample<T>(kind: 'contract' | 'lineup', body: { text: string; port?: string | null }, saved: (T & AgentMeta) | undefined): Promise<Res<T>> {
  const r = await postAgent<T & AgentMeta>(kind, body)
  if (!('error' in r)) return { data: r, offline: false }
  if (r.error === 'no-server') {
    return saved ? { data: saved, offline: true } : { error: '배포본에서는 기본 예시의 분석 결과만 볼 수 있습니다. 직접 붙여 넣은 본문은 서버를 실행하면 분석합니다.' }
  }
  return { error: r.error }
}

// ---------------------------------------------------------------- 조항 추출

function ContractTab() {
  const ex = agentExamples()
  const [pick, setPick] = useState(ex?.contracts[0]?.id ?? '')
  const [text, setText] = useState(ex?.contracts[0]?.text ?? '')
  const [res, setRes] = useState<Res<ContractResult>>(null)
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState<number | null>(null)
  const marks = useRef<(HTMLElement | null)[]>([])

  function choose(id: string) {
    setPick(id)
    const c = ex?.contracts.find((x) => x.id === id)
    setText(c?.text ?? '')
    setRes(null)
  }
  async function run() {
    setBusy(true)
    const saved = ex?.contracts.find((x) => x.text === text)?.result
    setRes(await runWithExample<ContractResult>('contract', { text }, saved))
    setBusy(false)
    setFocus(null)
  }
  const ok = res && !('error' in res) ? res : null
  const pieces = useMemo(() => {
    if (!ok) return null
    const out: { t: string; i: number | null }[] = []
    let at = 0
    ok.data.clauses.forEach((c, i) => {
      if (c.start > at) out.push({ t: text.slice(at, c.start), i: null })
      out.push({ t: text.slice(c.start, c.end), i })
      at = c.end
    })
    out.push({ t: text.slice(at), i: null })
    return out
  }, [ok, text])

  return (
    <div className="agent-grid">
      <section className="panel">
        <h3>용선계약 본문</h3>
        <label className="small muted stack">
          예시 계약 (합성 문안)
          <select value={pick} onChange={(e) => choose(e.target.value)}>
            {ex?.contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
            <option value="">직접 붙여 넣기</option>
          </select>
        </label>
        {pieces ? (
          <div className="doc" aria-label="조항을 표시한 본문">
            {pieces.map((p, k) =>
              p.i == null ? (
                <span key={k}>{p.t}</span>
              ) : (
                <mark key={k} ref={(el) => void (marks.current[p.i!] = el)} className={focus === p.i ? 'on' : ''}>
                  {p.t}
                </mark>
              ),
            )}
          </div>
        ) : (
          <textarea className="doc-input" rows={18} value={text} onChange={(e) => (setText(e.target.value), setPick(''))} placeholder="용선계약 조항을 붙여 넣으세요" />
        )}
        <div className="note-actions">
          {pieces ? (
            <button className="btn" onClick={() => setRes(null)}>
              본문 고치기
            </button>
          ) : (
            <button className="btn primary" disabled={busy || !text.trim()} onClick={run}>
              {busy ? '찾는 중' : '조항 찾기'}
            </button>
          )}
        </div>
      </section>
      <section className="panel">
        <h3>찾은 조항</h3>
        {!res && <p className="muted">본문을 넣고 조항 찾기를 누르면 감속 결정과 관련된 조항을 근거 구간과 함께 보여줍니다.</p>}
        {res && 'error' in res && <p className="notice small">{res.error}</p>}
        {ok && (
          <>
            <GenBadge meta={ok.data} offline={ok.offline} />
            <p className="assess">{ok.data.assessment}</p>
            {ok.data.clauses.length === 0 && <p className="muted">관련 조항을 찾지 못했습니다.</p>}
            <ol className="clause-list">
              {ok.data.clauses.map((c, i) => (
                <li key={i} className={focus === i ? 'on' : ''}>
                  <button
                    className="clause-head"
                    onClick={() => {
                      setFocus(i)
                      marks.current[i]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
                    }}
                  >
                    <span className="chip">{c.label}</span>
                    <span className="small muted clip">{c.quote.split('\n')[0]}</span>
                  </button>
                  <p className="small">{c.note}</p>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- 메일 구조화

const STATUS_KO: Record<LineupShip['status'], string> = { berthed: '접안 중', waiting: '정박지 대기', inbound: '도착 예정' }

function LineupTab({ dispatch }: { dispatch: (a: Action) => void }) {
  const ex = agentExamples()
  const [pick, setPick] = useState(ex?.mails[0]?.id ?? '')
  const [text, setText] = useState(ex?.mails[0]?.text ?? '')
  const [port, setPort] = useState<string>(ex?.mails[0]?.port ?? '')
  const [res, setRes] = useState<Res<LineupResult>>(null)
  const [busy, setBusy] = useState(false)

  function choose(id: string) {
    setPick(id)
    const m = ex?.mails.find((x) => x.id === id)
    setText(m?.text ?? '')
    setPort(m?.port ?? '')
    setRes(null)
  }
  async function run() {
    setBusy(true)
    const saved = ex?.mails.find((x) => x.text === text)?.result
    setRes(await runWithExample<LineupResult>('lineup', { text, port: port || null }, saved))
    setBusy(false)
  }
  const ok = res && !('error' in res) ? res : null
  const groups = useMemo(() => {
    const g = new Map<string, LineupShip[]>()
    for (const s of ok?.data.ships ?? []) {
      const k = s.berth ?? '선석 미상'
      g.set(k, [...(g.get(k) ?? []), s])
    }
    return [...g.entries()]
  }, [ok])

  return (
    <div className="agent-grid">
      <section className="panel">
        <h3>대리점 메일</h3>
        <div className="form-row">
          <label className="small muted stack grow">
            예시 메일 (합성 문안)
            <select value={pick} onChange={(e) => choose(e.target.value)}>
              {ex?.mails.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
              <option value="">직접 붙여 넣기</option>
            </select>
          </label>
          <label className="small muted stack">
            항만
            <select value={port} onChange={(e) => setPort(e.target.value)}>
              <option value="">메일에서 찾기</option>
              {['울산', '대산', '광양', '여천'].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        </div>
        <textarea className="doc-input" rows={18} value={text} onChange={(e) => (setText(e.target.value), setPick(''))} placeholder="대기 순번(line-up) 메일 본문을 붙여 넣으세요" />
        <div className="note-actions">
          <button className="btn primary" disabled={busy || !text.trim()} onClick={run}>
            {busy ? '정리하는 중' : '순번 정리'}
          </button>
        </div>
      </section>
      <section className="panel">
        <h3>구조화한 대기 순번</h3>
        {!res && <p className="muted">메일을 넣고 순번 정리를 누르면 선석별로 선박·상태·시각을 표로 만듭니다. 예측 대상 선석이면 항차 결정의 대기 순번 조건에 바로 넣을 수 있습니다.</p>}
        {res && 'error' in res && <p className="notice small">{res.error}</p>}
        {ok && (
          <>
            <GenBadge meta={ok.data} offline={ok.offline} />
            {ok.data.ships.length === 0 && <p className="muted">선박 줄을 찾지 못했습니다. 선박명 앞에 MT/MV를 붙이거나 '대기 1번: 선박명' 형식이면 잘 읽습니다.</p>}
            {groups.map(([berth, ships]) => {
              const key = ships[0].berthKey
              const n = ships.filter((s) => s.status !== 'berthed').length
              return (
                <div key={berth} className="lineup-group">
                  <div className="panel-head">
                    <h4>
                      {ok.data.port ? `${ok.data.port} ` : ''}
                      {berth}
                    </h4>
                    {key && ok.data.port ? (
                      <button className="btn small-btn" disabled={n === 0} onClick={() => dispatch({ type: 'handoff', value: { port: ok.data.port!, berth, ships } })}>
                        항차 결정에 넣기
                      </button>
                    ) : (
                      <span className="small muted">예측 대상 선석이 아님</span>
                    )}
                  </div>
                  <table className="data-table small num">
                    <thead>
                      <tr>
                        <th>순번</th>
                        <th>선박</th>
                        <th>상태</th>
                        <th>시각</th>
                        <th>화물</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ships.map((s, i) => (
                        <tr key={`${s.vessel}-${i}`}>
                          <td>{s.order}</td>
                          <td className="left">{s.vessel}</td>
                          <td className="left">{STATUS_KO[s.status]}</td>
                          <td>{s.time ? fmtDT(s.time) : '-'}</td>
                          <td className="left">{s.cargo ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- 정산 계산기

function SettleTab({ state }: { state: AppState }) {
  const cur = state.current?.summary
  const [f, setF] = useState({ rate: 25000, cut: 25, price: 620, delayH: cur?.policy.delayH ?? 10, fuelT: cur?.policy.fuelT ?? 15, payer: 'owner' as 'owner' | 'charterer', onDem: true })
  const num = (k: 'rate' | 'cut' | 'price' | 'delayH' | 'fuelT') => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Math.max(0, Number(e.target.value)) })
  const fuelUsd = f.fuelT * f.price
  const demShift = f.onDem ? (f.rate * (f.cut / 100) * f.delayH) / 24 : 0
  const owner = (f.payer === 'owner' ? fuelUsd : 0) - demShift
  const charterer = (f.payer === 'charterer' ? fuelUsd : 0) + demShift
  const breakEven = f.onDem && f.delayH > 0 && f.rate > 0 ? (fuelUsd * 24) / (f.rate * f.delayH) : null
  const usd = (v: number) => `${v < 0 ? '−' : v > 0 ? '+' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`
  return (
    <div className="agent-grid">
      <section className="panel">
        <h3>입력</h3>
        {cur && (
          <p className="small muted">
            늦춤·절감 연료 기본값은 항차 결정 화면의 현재 권고({cur.vessel || '직접 입력 선박'}, {cur.berth}, 위험 수준 {cur.risk})에서 가져왔습니다.
          </p>
        )}
        <div className="form-grid">
          <label>
            체선료율 (USD/일, 예시)
            <input type="number" min={0} step={500} value={f.rate} onChange={num('rate')} />
          </label>
          <label>
            늘어난 항해시간의 체선료 감액 (%)
            <input type="number" min={0} max={100} value={f.cut} onChange={num('cut')} />
          </label>
          <label>
            연료 단가 (USD/t, 예시)
            <input type="number" min={0} step={10} value={f.price} onChange={num('price')} />
          </label>
          <label>
            늦춤 (시간)
            <input type="number" min={0} step={0.1} value={f.delayH} onChange={num('delayH')} />
          </label>
          <label>
            절감 연료 (t)
            <input type="number" min={0} step={0.1} value={f.fuelT} onChange={num('fuelT')} />
          </label>
          <label>
            연료비 부담
            <select value={f.payer} onChange={(e) => setF({ ...f, payer: e.target.value as 'owner' | 'charterer' })}>
              <option value="owner">선주 (항해용선)</option>
              <option value="charterer">용선자 (정기용선)</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={f.onDem} onChange={(e) => setF({ ...f, onDem: e.target.checked })} /> 늦춘 시간이 체선 시간에 해당
          </label>
        </div>
        <p className="small muted">
          계산: 연료비 절감 = 절감 연료 × 연료 단가. 체선 중이면 대기했을 시간만큼 늘어난 항해시간에 감액 요율이 붙어, 용선자가 내는 체선료가 체선료율 × 감액 × 늦춤 / 24만큼 줄고 그만큼 선주 수입이 줍니다. 정박기간 안이면 대기와 항해가 같은 정박기간을 쓰므로 체선료 변화가 없습니다.
        </p>
      </section>
      <section className="panel">
        <h3>선주·용선자별 변화 (항차 1회)</h3>
        <table className="data-table num settle">
          <thead>
            <tr>
              <th>항목</th>
              <th>선주</th>
              <th>용선자</th>
              <th>합계</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>연료비 절감</td>
              <td>{usd(f.payer === 'owner' ? fuelUsd : 0)}</td>
              <td>{usd(f.payer === 'charterer' ? fuelUsd : 0)}</td>
              <td>{usd(fuelUsd)}</td>
            </tr>
            <tr>
              <td>체선료</td>
              <td>{usd(-demShift)}</td>
              <td>{usd(demShift)}</td>
              <td>{usd(0)}</td>
            </tr>
            <tr className="total">
              <td>합계</td>
              <td>{usd(owner)}</td>
              <td>{usd(charterer)}</td>
              <td>{usd(fuelUsd)}</td>
            </tr>
          </tbody>
        </table>
        <p className="assess">
          {f.payer === 'owner'
            ? owner >= 0
              ? `선주도 ${usd(owner)} 이득입니다. 체선료 감소보다 연료비 절감이 큽니다.`
              : `선주는 $${Math.abs(Math.round(owner)).toLocaleString('en-US')} 손해입니다. 감액을 줄이거나 절감분을 나누는 합의(가상 도착)가 있어야 선주가 감속에 동의할 이유가 생깁니다.`
            : `연료비를 내는 용선자가 ${usd(charterer)} 이득입니다. 선주는 체선료 감액만큼 ${usd(owner)} 변합니다.`}
        </p>
        {breakEven != null && f.payer === 'owner' && (
          <p className="small muted">선주가 손해 보지 않는 최대 감액: {Math.min(100, breakEven * 100).toFixed(0)}%. 체선료는 둘 사이를 옮겨 갈 뿐이라 합계는 연료비 절감과 같습니다.</p>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- 지시문·요청서

function DraftTab({ state, dispatch }: { state: AppState; dispatch: (a: Action) => void }) {
  const cur = state.current
  if (!cur)
    return (
      <section className="panel">
        <p className="muted">항차 결정 화면에서 권고를 고르면 그 권고로 선장 지시문과 용선자 요청서를 만듭니다.</p>
        <button className="btn" onClick={() => dispatch({ type: 'nav', screen: 'decision' })}>
          항차 결정으로 가기
        </button>
      </section>
    )
  const s = cur.summary
  const p = s.policy
  return (
    <section className="panel draft-panel">
      <h3>현재 권고</h3>
      <p className="num">
        {s.vessel || '직접 입력 선박'}, {s.port} {s.berth}. {p.delayH < 0.05 ? `원래 일정 ${fmtDT(s.a0)} 유지` : `권고 도착 ${fmtDT(p.rta)} (${p.delayH.toFixed(1)}시간 늦춤, ${p.speedKn.toFixed(1)}노트)`}, 위험 수준 {s.risk}
      </p>
      {p.delayH < 0.05 && <p className="small muted">늦춤이 없는 권고라 지시문·요청서 대신 설명만 만듭니다.</p>}
      <AgentNote summary={s} exampleKey={cur.key} showDrafts={p.delayH >= 0.05} />
    </section>
  )
}

// ---------------------------------------------------------------- 질의응답

interface Turn {
  role: 'user' | 'assistant'
  content: string
  meta?: AgentMeta
  tools?: ToolCall[]
  error?: boolean
}

const TOOL_KO: Record<string, string> = {
  get_port_state: '항만 상태 조회',
  list_berths: '선석 목록',
  recommend_arrival: '도착 권고 계산',
  simulate_policy: '항만 시뮬레이션',
  wait_statistics: '대기 통계',
}

function ChatTab() {
  const ex = agentExamples()
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [turns])

  async function ask(text: string) {
    const t = text.trim()
    if (!t || busy) return
    const next: Turn[] = [...turns, { role: 'user', content: t }]
    setTurns(next)
    setQ('')
    setBusy(true)
    const r = await postAgent<ChatResult>('chat', { messages: next.filter((x) => !x.error).map(({ role, content }) => ({ role, content })) })
    setBusy(false)
    if ('error' in r)
      setTurns([...next, { role: 'assistant', content: r.error === 'no-server' ? '질의응답은 서버의 엔진을 불러 답합니다. 이 배포본에는 서버가 연결되어 있지 않습니다.' : r.error, error: true }])
    else setTurns([...next, { role: 'assistant', content: r.answer, meta: r, tools: r.tools }])
  }

  return (
    <section className="panel chat">
      {turns.length === 0 && (
        <div className="chat-empty">
          <p className="muted">항만·선석·도착 예정을 함께 물어보면 엔진으로 계산해 답합니다. 답변의 수치는 모두 엔진 도구 결과에서 옵니다.</p>
          <div className="chips">
            {(ex?.questions ?? []).map((x) => (
              <button key={x} className="btn" onClick={() => ask(x)} disabled={!hasServer()}>
                {x}
              </button>
            ))}
          </div>
          {!hasServer() && <p className="small muted">질의응답은 서버를 실행한 환경에서 쓸 수 있습니다. 시연 영상에 실제 동작이 있습니다.</p>}
        </div>
      )}
      <div className="chat-log" aria-live="polite">
        {turns.map((t, i) => (
          <div key={i} className={`turn ${t.role}${t.error ? ' err' : ''}`}>
            <p>{t.content}</p>
            {t.meta && <GenBadge meta={t.meta} />}
            {!!t.tools?.length && (
              <details className="small tools">
                <summary>엔진 도구 호출 {t.tools.length}회</summary>
                <ul>
                  {t.tools.map((c, k) => (
                    <li key={k}>
                      <strong>{TOOL_KO[c.name] ?? c.name}</strong> {c.ok ? '' : '(실패) '}
                      <code>{JSON.stringify(c.input)}</code>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
        {busy && <p className="small muted">엔진을 부르는 중</p>}
        <div ref={end} />
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          ask(q)
        }}
      >
        <textarea
          rows={2}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              ask(q)
            }
          }}
          placeholder="예: 내일 오후 2시에 울산 SK7부두에 들어가는 탱커인데 언제 도착하면 돼?"
          aria-label="질문"
        />
        <button className="btn primary" disabled={busy || !q.trim()}>
          묻기
        </button>
      </form>
    </section>
  )
}
