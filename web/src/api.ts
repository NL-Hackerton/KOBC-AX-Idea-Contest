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
