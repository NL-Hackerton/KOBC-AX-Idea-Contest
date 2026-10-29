import { lazy, Suspense, useEffect } from 'react'
import { snapshotMeta } from './api'
import { IconAnchor, IconCii, IconDoc, IconFile, IconPort, IconShip, IconSim } from './components/Icons'
import SearchBox from './components/SearchBox'
import StatusBadge from './components/StatusBadge'
import Decision from './screens/Decision'
import { useAppState, type Screen } from './state'
import { fmtDT } from './lib/time'
import './styles/screens.css'

const Ports = lazy(() => import('./screens/Ports'))
const Simulate = lazy(() => import('./screens/Simulate'))
const Evidence = lazy(() => import('./screens/Evidence'))
const Cii = lazy(() => import('./screens/Cii'))
const Agent = lazy(() => import('./screens/Agent'))

const NAV: { group: string; items: { id: Screen; label: string; icon: typeof IconPort }[] }[] = [
  {
    group: '운항',
    items: [
      { id: 'ports', label: '항만 현황', icon: IconPort },
      { id: 'decision', label: '항차 결정', icon: IconShip },
      { id: 'simulate', label: '항만 시뮬레이터', icon: IconSim },
    ],
  },
  {
    group: '분석',
    items: [
      { id: 'evidence', label: '근거', icon: IconDoc },
      { id: 'cii', label: 'CII', icon: IconCii },
    ],
  },
  {
    group: '계약',
    items: [{ id: 'agent', label: '계약·정산·에이전트', icon: IconFile }],
  },
]

const CRUMB: Record<Screen, string[]> = {
  ports: ['운항', '항만 현황'],
  decision: ['운항', '항차 결정'],
  simulate: ['운항', '항만 시뮬레이터'],
  evidence: ['분석', '근거'],
  cii: ['분석', 'CII'],
  agent: ['계약', '계약·정산·에이전트'],
}

export default function App() {
  const [state, dispatch] = useAppState({
    screen: 'decision',
    mode: 'replay',
    caseId: null,
    condition: 'plan',
    risk: '0.1',
    revealed: false,
    port: '울산',
    liveShipId: null,
    agentTab: 'contract',
    current: null,
    handoff: null,
  })
  const theme = state.mode === 'live' ? 'dark' : 'light'
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const crumb = [...CRUMB[state.screen]]
  if (state.screen === 'ports' || (state.screen === 'decision' && state.mode === 'live')) crumb.push(state.port)
  else if (state.screen === 'decision' && state.current?.summary.vessel) crumb.push(state.current.summary.vessel)

  return (
    <div className="shell" data-theme={theme}>
      <aside className="sidebar">
        <div className="brand">
          <span className="logo" aria-hidden>
            <IconAnchor size={18} />
          </span>
          <span>
            <span className="brand-name">K-JIT</span>
            <span className="brand-sub">적시 입항 코파일럿</span>
          </span>
        </div>
        <nav aria-label="화면">
          {NAV.map((g) => (
            <div key={g.group} className="nav-group">
              <p className="nav-label">{g.group}</p>
              {g.items.map((s) => {
                const Icon = s.icon
                const on = state.screen === s.id
                return (
                  <button key={s.id} type="button" className={on ? 'on' : ''} aria-current={on ? 'page' : undefined} onClick={() => dispatch({ type: 'nav', screen: s.id })}>
                    <Icon size={16} />
                    {s.label}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <p className="side-kicker">공개 데이터</p>
          <p className="side-when num">{snapshotMeta.snapshotDate ? fmtDT(snapshotMeta.snapshotDate) : '-'} 기준</p>
          <p className="side-note">재생 사례는 2026-08-09 해수부 입출항 신고 실데이터</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="top">
          <p className="crumb">
            {crumb.map((c, i) => (
              <span key={c}>
                {i > 0 && <span className="crumb-sep">/</span>}
                <span className={i === crumb.length - 1 ? 'crumb-now' : ''}>{c}</span>
              </span>
            ))}
          </p>
          <div className="top-tools">
            <StatusBadge replay={state.mode === 'replay'} />
            <div className="seg mode-toggle" role="group" aria-label="재생 또는 실시간. 재생은 밝은 테마, 실시간은 어두운 테마">
              <button type="button" className={state.mode === 'replay' ? 'on' : ''} aria-pressed={state.mode === 'replay'} onClick={() => dispatch({ type: 'mode', mode: 'replay' })}>
                재생
              </button>
              <button type="button" className={state.mode === 'live' ? 'on' : ''} aria-pressed={state.mode === 'live'} onClick={() => dispatch({ type: 'mode', mode: 'live' })}>
                실시간
              </button>
            </div>
            <SearchBox dispatch={dispatch} />
          </div>
        </header>
        <main>
          <Suspense fallback={<p className="muted">불러오는 중</p>}>
            {state.screen === 'decision' && <Decision state={state} dispatch={dispatch} />}
            {state.screen === 'ports' && <Ports state={state} dispatch={dispatch} />}
            {state.screen === 'simulate' && <Simulate />}
            {state.screen === 'evidence' && <Evidence />}
            {state.screen === 'cii' && <Cii />}
            {state.screen === 'agent' && <Agent state={state} dispatch={dispatch} />}
          </Suspense>
          <footer className="foot small muted">
            데이터: 해양수산부 선박운항정보, 울산항만공사 항내 선박위치정보 (공공데이터포털). 예측·권고는 K-JIT 엔진이 계산하며 연료 계수와 요율은 가정값입니다.
          </footer>
        </main>
      </div>
    </div>
  )
}
