// 데이터 계층: 서버(VITE_API_BASE)가 응답하면 실시간, 아니면 빌드에 내장한 저장본으로 전환한다.
import snapshot from './data/snapshot.json'

export type DataMode = 'live' | 'snapshot'

const BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
const TIMEOUT_MS = 4000

let mode: DataMode = BASE ? 'live' : 'snapshot'
const listeners = new Set<(m: DataMode) => void>()

export function getMode(): DataMode {
  return mode
}

export function onModeChange(fn: (m: DataMode) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function setMode(m: DataMode) {
  if (m === mode) return
  mode = m
  listeners.forEach((fn) => fn(m))
}

export const snap = snapshot as unknown as Record<string, unknown>

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE) throw new Error('no-server')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    setMode('live')
    return (await res.json()) as T
  } catch (e) {
    setMode('snapshot')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** 서버에서 읽고, 실패하면 저장본에서 꺼낸다. */
export async function read<T>(path: string, fallback: () => T): Promise<T> {
  try {
    return await request<T>(path)
  } catch {
    return fallback()
  }
}

/** 서버 계산이 필요한 요청. 서버가 없으면 null 을 돌려주고 화면이 이유를 표시한다. */
export async function compute<T>(path: string, body: unknown): Promise<T | null> {
  try {
    return await request<T>(path, { method: 'POST', body: JSON.stringify(body) })
  } catch {
    return null
  }
}

export function hasServer(): boolean {
  return !!BASE
}

// ---- 화면별 데이터 함수 ----
import type { LiveDecision, PortInfo, PortState, ReplayCase, ReplayIndex } from './types'

const S = snapshot as unknown as {
  meta: { snapshotDate: string | null }
  ports?: PortInfo[]
  states?: Record<string, PortState>
  replay?: ReplayIndex
  evidence?: unknown
  simulate_grid?: unknown
  cii_constants?: unknown
  agent_examples?: unknown
}

export const snapshotMeta = S.meta

let replayById: Map<string, ReplayCase> | null = null
function replayMap() {
  if (!replayById) replayById = new Map((S.replay?.cases ?? []).map((c) => [c.id, c]))
  return replayById
}

/** 재생 사례는 10/28 기준으로 고정된 실측 결과라 항상 내장본을 쓴다 (서버 왕복 없이 즉시 표시). */
export function replayIndex(): ReplayIndex | null {
  return S.replay ?? null
}

export function replayCase(id: string): ReplayCase | undefined {
  return replayMap().get(id)
}

export async function getPorts(): Promise<PortInfo[]> {
  const r = await read<{ ports: PortInfo[] }>('/api/ports', () => ({ ports: S.ports ?? [] }))
  return r.ports
}

export async function getPortState(port: string, at?: string): Promise<PortState | null> {
  const q = at ? `?at=${encodeURIComponent(at)}` : ''
  return read<PortState | null>(`/api/ports/${encodeURIComponent(port)}/state${q}`, () => (at ? null : S.states?.[port] ?? null))
}

export interface DecisionBody {
  port: string
  berth: string
  vessel: { vessel: string; callsign: string; group: string; gt: number | null; domestic: boolean }
  eta: string
  condition: string
  lineup?: { vessel: string; group: string; gt: number | null; arrivedAt: string }[]
  plan?: { vessel: string; group: string; gt: number | null; eta: string }[]
}

export async function postDecision(body: DecisionBody): Promise<LiveDecision | { error: string }> {
  if (!BASE) return { error: '실시간 서버가 연결되어 있지 않아 저장본만 볼 수 있습니다.' }
  try {
    const res = await fetch(`${BASE}/api/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.detail ?? `요청 실패 (${res.status})` }
    setMode('live')
    return data as LiveDecision
  } catch {
    setMode('snapshot')
    return { error: '실시간 서버에 연결할 수 없습니다. 저장본 화면을 이용해 주세요.' }
  }
}

export function snapshotPart<T>(key: 'evidence' | 'simulate_grid' | 'cii_constants' | 'agent_examples'): T | null {
  return (S[key] as T) ?? null
}

export async function getSimGrid<T>(): Promise<T | null> {
  return read<T | null>('/api/simulate/grid', () => (S.simulate_grid as T) ?? null)
}

export async function postSimulate<T>(body: unknown): Promise<T | null> {
  return compute<T>('/api/simulate', body)
}
