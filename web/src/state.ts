import { useEffect, useReducer } from 'react'
import type { Condition, Risk } from './types'

export type Screen = 'ports' | 'decision' | 'simulate' | 'evidence' | 'cii' | 'agent'

export interface AppState {
  screen: Screen
  mode: 'replay' | 'live'
  caseId: string | null
  condition: Condition
  risk: Risk
  revealed: boolean
  port: string
  liveShipId: string | null
}

export type Action =
  | { type: 'nav'; screen: Screen }
  | { type: 'openReplay'; id: string }
  | { type: 'openLive'; port?: string; shipId?: string | null }
  | { type: 'mode'; mode: 'replay' | 'live' }
  | { type: 'condition'; condition: Condition }
  | { type: 'risk'; risk: Risk }
  | { type: 'reveal'; revealed: boolean }
  | { type: 'port'; port: string }
  | { type: 'hash'; state: Partial<AppState> }

export const SCREENS: { id: Screen; label: string }[] = [
  { id: 'ports', label: '항만 현황' },
  { id: 'decision', label: '항차 결정' },
  { id: 'simulate', label: '항만 시뮬레이터' },
  { id: 'evidence', label: '근거' },
  { id: 'cii', label: 'CII' },
  { id: 'agent', label: '계약·정산·에이전트' },
]

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'nav':
      return { ...s, screen: a.screen }
    case 'openReplay':
      return { ...s, screen: 'decision', mode: 'replay', caseId: a.id, revealed: false }
    case 'openLive':
      return { ...s, screen: 'decision', mode: 'live', port: a.port ?? s.port, liveShipId: a.shipId ?? null }
    case 'mode':
      return { ...s, mode: a.mode }
    case 'condition':
      return { ...s, condition: a.condition }
    case 'risk':
      return { ...s, risk: a.risk }
    case 'reveal':
      return { ...s, revealed: a.revealed }
    case 'port':
      return { ...s, port: a.port }
    case 'hash':
      return { ...s, ...a.state }
  }
}

function parseHash(): Partial<AppState> {
  const parts = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean)
  const [screen, ...rest] = parts
  if (screen === 'decision') {
    if (rest[0] === 'replay') return { screen: 'decision', mode: 'replay', ...(rest[1] ? { caseId: rest[1] } : {}) }
    if (rest[0] === 'live') return { screen: 'decision', mode: 'live', ...(rest[1] ? { port: rest[1] } : {}) }
    return { screen: 'decision' }
  }
  if (screen === 'ports') return { screen: 'ports', ...(rest[0] ? { port: rest[0] } : {}) }
  if (screen && SCREENS.some((x) => x.id === screen)) return { screen: screen as Screen }
  return {}
}

function toHash(s: AppState): string {
  if (s.screen === 'decision') return s.mode === 'replay' ? `#decision/replay${s.caseId ? `/${s.caseId}` : ''}` : `#decision/live/${s.port}`
  if (s.screen === 'ports') return `#ports/${s.port}`
  return `#${s.screen}`
}

export function useAppState(initial: AppState) {
  const [state, dispatch] = useReducer(reducer, initial, (i) => ({ ...i, ...parseHash() }))
  useEffect(() => {
    const h = toHash(state)
    if (decodeURIComponent(location.hash) !== h) history.replaceState(null, '', h)
  }, [state])
  useEffect(() => {
    const on = () => dispatch({ type: 'hash', state: parseHash() })
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return [state, dispatch] as const
}
