import { lazy, Suspense, useEffect, useState } from 'react'
import { Sidebar, Topbar } from './components/Shell'
import Decision from './screens/Decision'
import { useAppState } from './state'
import './styles/screens.css'
import './styles/ui.css'

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
    liveShipId: null,
    agentTab: 'contract',
    current: null,
    handoff: null,
  })
  const [menu, setMenu] = useState(false)
  // A new screen starts at the top, like a page load.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [state.screen])
  return (
    <div className="app">
      <Sidebar state={state} dispatch={dispatch} open={menu} onClose={() => setMenu(false)} />
      <div className="main">
        <Topbar state={state} dispatch={dispatch} onMenu={() => setMenu(true)} />
        <main key={state.screen} className="content screen-enter">
          <Suspense fallback={<div className="skeleton" style={{ height: 420 }} aria-label="불러오는 중" />}>
            {state.screen === 'decision' && <Decision state={state} dispatch={dispatch} />}
            {state.screen === 'ports' && <Ports state={state} dispatch={dispatch} />}
            {state.screen === 'simulate' && <Simulate />}
            {state.screen === 'evidence' && <Evidence />}
            {state.screen === 'cii' && <Cii />}
            {state.screen === 'agent' && <Agent state={state} dispatch={dispatch} />}
          </Suspense>
        </main>
        <footer className="foot">데이터: 해양수산부 선박운항정보, 울산항만공사 항내 선박위치정보 (공공데이터포털). 예측·권고는 K-JIT 엔진이 계산하며 연료 계수와 요율은 가정값입니다.</footer>
      </div>
    </div>
  )
}
