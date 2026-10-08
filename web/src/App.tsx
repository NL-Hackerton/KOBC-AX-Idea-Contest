import { lazy, Suspense } from 'react'
import StatusBadge from './components/StatusBadge'
import Decision from './screens/Decision'
import { SCREENS, useAppState } from './state'
import './styles/screens.css'

const Ports = lazy(() => import('./screens/Ports'))
const Simulate = lazy(() => import('./screens/Simulate'))
const Evidence = lazy(() => import('./screens/Evidence'))
const Cii = lazy(() => import('./screens/Cii'))
const Agent = lazy(() => import('./screens/Agent'))

export default function App() {
  const [state, dispatch] = useAppState({
    screen: 'decision',
    mode: 'replay',
    caseId: null,
    condition: 'plan',
    risk: '0.1',
    revealed: false,
    port: '울산',
  })
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path d="M3 17h18M6 17l2-6h8l2 6M12 11V5m0 0l4 3m-4-3L8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="brand-name">K-JIT</span>
          <span className="brand-sub small muted">적시 입항 코파일럿</span>
        </div>
        <nav aria-label="화면">
          {SCREENS.map((s) => (
            <button key={s.id} className={state.screen === s.id ? 'on' : ''} aria-current={state.screen === s.id ? 'page' : undefined} onClick={() => dispatch({ type: 'nav', screen: s.id })}>
              {s.label}
            </button>
          ))}
        </nav>
        <StatusBadge screen={state.screen} />
      </header>
      <main>
        <Suspense fallback={<p className="muted">불러오는 중</p>}>
          {state.screen === 'decision' && <Decision state={state} dispatch={dispatch} />}
          {state.screen === 'ports' && <Ports state={state} dispatch={dispatch} />}
          {state.screen === 'simulate' && <Simulate />}
          {state.screen === 'evidence' && <Evidence />}
          {state.screen === 'cii' && <Cii />}
          {state.screen === 'agent' && <Agent />}
        </Suspense>
      </main>
      <footer className="foot small muted">
        데이터: 해양수산부 선박운항정보, 울산항만공사 항내 선박위치정보 (공공데이터포털). 예측·권고는 K-JIT 엔진이 계산하며 연료 계수와 요율은 가정값입니다.
      </footer>
    </div>
  )
}
