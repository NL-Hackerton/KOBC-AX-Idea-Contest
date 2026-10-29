import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import activityIcon from '../assets/icons/activity.svg'
import anchorIcon from '../assets/icons/anchor.svg'
import bellIcon from '../assets/icons/bell.svg'
import checkIcon from '../assets/icons/check.svg'
import docIcon from '../assets/icons/doc.svg'
import leafIcon from '../assets/icons/leaf.svg'
import mapIcon from '../assets/icons/map.svg'
import searchIcon from '../assets/icons/search.svg'
import shipIcon from '../assets/icons/ship.svg'
import { getMode, getPortState, hasServer, onModeChange, replayIndex, snapshotMeta } from '../api'
import { fmtDT } from '../lib/time'
import type { Action, AppState, Screen } from '../state'
import type { Inbound } from '../types'
import Icon from './Icon'
import Segmented from './Segmented'

const PORTS = ['울산', '대산', '광양', '여천']

const NAV: { section: string; items: { id: Screen; label: string; icon: string }[] }[] = [
  {
    section: '운항',
    items: [
      { id: 'ports', label: '항만 현황', icon: mapIcon },
      { id: 'decision', label: '항차 결정', icon: shipIcon },
      { id: 'simulate', label: '항만 시뮬레이터', icon: activityIcon },
    ],
  },
  {
    section: '분석',
    items: [
      { id: 'evidence', label: '근거', icon: checkIcon },
      { id: 'cii', label: 'CII', icon: leafIcon },
    ],
  },
  { section: '계약', items: [{ id: 'agent', label: '계약·정산·에이전트', icon: docIcon }] },
]

const navOf = (s: Screen) => {
  for (const g of NAV) for (const it of g.items) if (it.id === s) return { section: g.section, label: it.label }
  return { section: '', label: '' }
}

const snapAt = snapshotMeta.snapshotDate

/** 2026-10-08 22:24 (KST) */
function fmtFull(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

export function Sidebar({ state, dispatch, open, onClose }: { state: AppState; dispatch: (a: Action) => void; open: boolean; onClose: () => void }) {
  const replayScreens = state.screen === 'ports' || state.screen === 'decision'
  return (
    <>
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="주 메뉴">
        <div className="brand">
          <span className="brand-logo">
            <Icon src={anchorIcon} size={20} />
          </span>
          <span className="brand-text">
            <span className="brand-name">K-JIT</span>
            <span className="brand-sub">적시 입항 코파일럿</span>
          </span>
        </div>
        <nav aria-label="화면">
          {NAV.map((g) => (
            <div key={g.section} className="nav-group">
              <p className="nav-section">{g.section}</p>
              {g.items.map((it) => {
                const on = state.screen === it.id
                return (
                  <button
                    key={it.id}
                    type="button"
                    className={`nav-item${on ? ' on' : ''}`}
                    aria-current={on ? 'page' : undefined}
                    onClick={() => {
                      dispatch({ type: 'nav', screen: it.id })
                      onClose()
                    }}
                  >
                    <Icon src={it.icon} size={18} />
                    <span>{it.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-grow" />
        <div className="data-card">
          <p className="data-card-k">공개 데이터</p>
          <p className="data-card-v">{snapAt ? `${fmtDT(snapAt)} 기준` : '저장본'}</p>
          <p className="data-card-s">
            {replayScreens ? '재생 사례는 2026-08~09' : '1년 기록 129,831항차'}
            <br />
            {replayScreens ? '해수부 입출항 신고 실데이터' : '9개 항만 · 해수부 선박운항정보'}
          </p>
        </div>
      </aside>
      <div className={`scrim${open ? ' open' : ''}`} onClick={onClose} aria-hidden />
    </>
  )
}

function useDataMode() {
  const [mode, setMode] = useState(getMode())
  useEffect(() => onModeChange(setMode), [])
  return mode
}

function StatusPill({ state }: { state: AppState }) {
  const dataMode = useDataMode()
  const at = snapAt ? fmtDT(snapAt) : ''
  let tone: 'good' | 'wait' = 'good'
  let label: string
  if (dataMode === 'live') {
    label = '실시간 · 서버 연결'
  } else if (hasServer()) {
    tone = 'wait'
    label = `저장본 · ${at} 기준 (서버 연결 없음)`
  } else if (state.screen === 'decision' && state.mode === 'replay') {
    tone = 'wait'
    // The voyage is named by its declared arrival day, as in the page caption.
    const a0 = state.current?.summary.a0
    label = a0 ? `재생 · ${fmtFull(a0).slice(0, 10)} 실제 항차` : '재생 · 실제 항차'
  } else if (state.screen === 'ports' && state.mode === 'replay') {
    tone = 'wait'
    label = `저장본 · ${snapAt ? fmtFull(snapAt) : ''} 공개 데이터`
  } else if (state.screen === 'ports' || state.screen === 'decision') {
    label = `실시간 · 공개 데이터 ${at} 기준`
  } else {
    label = `공개 데이터 · ${at} 기준`
  }
  return (
    <div className={`status-pill tone-${tone}`} role="status">
      <span className="status-dot" aria-hidden />
      <span key={label} className="status-text">
        {label}
      </span>
    </div>
  )
}

interface Hit {
  key: string
  kind: '재생 항차' | '입항 예정' | '접안 중' | '선석'
  title: string
  sub: string
  go: () => void
}

/** Lazily indexes replay cases and the saved port states of the four predicted ports. */
function useSearchIndex(enabled: boolean) {
  const [inbound, setInbound] = useState<{ port: string; ships: Inbound[]; berthed: { vessel: string; berth: string }[]; berths: string[] }[] | null>(null)
  useEffect(() => {
    if (!enabled || inbound) return
    let alive = true
    Promise.all(PORTS.map((p) => getPortState(p).then((ps) => ({ port: p, ps })))).then((rs) => {
      if (!alive) return
      setInbound(
        rs
          .filter((r) => r.ps)
          .map(({ port, ps }) => ({
            port,
            ships: ps!.inbound,
            berthed: ps!.berths.map((b) => ({ vessel: b.vessel, berth: b.berth })),
            berths: ps!.singleBerths.map((b) => b.name),
          })),
      )
    })
    return () => {
      alive = false
    }
  }, [enabled, inbound])
  return inbound
}

function SearchBox({ dispatch }: { dispatch: (a: Action) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [touched, setTouched] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const ports = useSearchIndex(touched)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [])

  const hits = useMemo<Hit[]>(() => {
    const term = q.trim().toLowerCase()
    if (!term) return []
    const has = (...s: (string | null | undefined)[]) => s.some((x) => x && x.toLowerCase().includes(term))
    const out: Hit[] = []
    for (const c of replayIndex()?.cases ?? []) {
      if (has(c.vessel, c.berth, c.callsign))
        out.push({ key: `r-${c.id}`, kind: '재생 항차', title: c.vessel, sub: `${c.port} · ${c.berth} · ${fmtDT(c.a0)} 도착 예정`, go: () => dispatch({ type: 'openReplay', id: c.id }) })
    }
    for (const p of ports ?? []) {
      for (const s of p.ships)
        if (has(s.vessel, s.facility, s.callsign))
          out.push({ key: `i-${p.port}-${s.id}`, kind: '입항 예정', title: s.vessel, sub: `${p.port} · ${s.facility} · ${fmtDT(s.eta)}`, go: () => dispatch({ type: 'openLive', port: p.port, shipId: s.id }) })
      for (const b of p.berthed)
        if (has(b.vessel))
          out.push({ key: `b-${p.port}-${b.vessel}-${b.berth}`, kind: '접안 중', title: b.vessel, sub: `${p.port} · ${b.berth}`, go: () => (dispatch({ type: 'port', port: p.port }), dispatch({ type: 'nav', screen: 'ports' })) })
      for (const name of p.berths)
        if (has(name))
          out.push({ key: `s-${p.port}-${name}`, kind: '선석', title: name, sub: `${p.port} 항만 현황`, go: () => (dispatch({ type: 'port', port: p.port }), dispatch({ type: 'nav', screen: 'ports' })) })
    }
    return out.slice(0, 12)
  }, [q, ports, dispatch])

  const pick = (h: Hit) => {
    h.go()
    setOpen(false)
    setQ('')
    input.current?.blur()
  }

  return (
    <div className="search" ref={box}>
      <label className="search-field">
        <Icon src={searchIcon} size={16} />
        <input
          ref={input}
          type="search"
          value={q}
          placeholder="선박명, 선석, 항차 검색"
          aria-label="선박명, 선석, 항차 검색"
          role="combobox"
          aria-expanded={open && !!q}
          aria-controls="search-results"
          onFocus={() => {
            setTouched(true)
            setOpen(true)
          }}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, hits.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter' && hits[active]) {
              pick(hits[active])
            } else if (e.key === 'Escape') {
              setOpen(false)
              input.current?.blur()
            }
          }}
        />
        <kbd className="search-kbd" aria-hidden>
          /
        </kbd>
      </label>
      {open && q.trim() && (
        <ul id="search-results" className="popover search-results" role="listbox">
          {hits.length === 0 && <li className="search-empty">{ports ? `"${q.trim()}"와 맞는 선박·선석이 없습니다.` : '찾는 중'}</li>}
          {hits.map((h, i) => (
            <li key={h.key} role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseEnter={() => setActive(i)} onMouseDown={(e) => (e.preventDefault(), pick(h))}>
              <span className="hit-kind">{h.kind}</span>
              <span className="hit-text">
                <span className="hit-title">{h.title}</span>
                <span className="hit-sub">{h.sub}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 알림: ships declared to a predicted berth, i.e. ones a recommendation can be opened for right now. */
function Bell({ dispatch }: { dispatch: (a: Action) => void }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<{ port: string; ship: Inbound }[] | null>(null)
  const [seen, setSeen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    Promise.all(PORTS.map((p) => getPortState(p).then((ps) => (ps ? ps.inbound.filter((i) => i.targetKey).map((ship) => ({ port: p, ship })) : [])))).then((rs) => {
      if (alive) setItems(rs.flat().sort((a, b) => a.ship.eta.localeCompare(b.ship.eta)))
    })
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  const n = items?.length ?? 0
  return (
    <div className="bell" ref={box}>
      <button
        type="button"
        className="icon-btn"
        aria-label={`알림${n && !seen ? `, 권고 가능 ${n}척` : ''}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o)
          setSeen(true)
        }}
      >
        <Icon src={bellIcon} size={18} />
        {n > 0 && !seen && <span className="bell-dot" aria-hidden />}
      </button>
      {open && (
        <div className="popover bell-pop" role="dialog" aria-label="알림">
          <div className="bell-head">
            <strong>권고를 볼 수 있는 입항 예정</strong>
            <span className="small muted">{n}척</span>
          </div>
          <ul>
            {(items ?? []).slice(0, 6).map(({ port, ship }) => (
              <li key={`${port}-${ship.id}`}>
                <button
                  type="button"
                  onClick={() => {
                    dispatch({ type: 'openLive', port, shipId: ship.id })
                    setOpen(false)
                  }}
                >
                  <span className="small muted num">{fmtDT(ship.eta)}</span>
                  <span className="bell-ship">
                    <span>{ship.vessel}</span>
                    <span className="small muted">
                      {port} · {ship.facility}
                    </span>
                  </span>
                  <span className="chip-soft">권고 보기</span>
                </button>
              </li>
            ))}
            {items && n === 0 && <li className="small muted">지금 권고를 볼 수 있는 배가 없습니다.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

type Theme = 'light' | 'dark'

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'))
  const flip = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    const root = document.documentElement
    root.classList.add('theme-anim')
    root.dataset.theme = next
    window.setTimeout(() => root.classList.remove('theme-anim'), 360)
    try {
      localStorage.setItem('kjit-theme', next)
    } catch {
      /* private mode: theme still applies for this visit */
    }
    setTheme(next)
  }
  return (
    <button type="button" className="icon-btn theme-btn" onClick={flip} aria-label={theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로'} title={theme === 'dark' ? '밝은 화면' : '어두운 화면'}>
      <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden className={`theme-glyph ${theme}`}>
        <g className="sun" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="9" cy="9" r="3.2" />
          <path d="M9 1.8v1.6M9 14.6v1.6M1.8 9h1.6M14.6 9h1.6M3.9 3.9l1.1 1.1M13 13l1.1 1.1M3.9 14.1 5 13M13 5l1.1-1.1" />
        </g>
        <path className="moon" d="M15 10.6A6.2 6.2 0 0 1 7.4 3a6.2 6.2 0 1 0 7.6 7.6Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

export function Topbar({ state, dispatch, onMenu }: { state: AppState; dispatch: (a: Action) => void; onMenu: () => void }) {
  const { section, label } = navOf(state.screen)
  const tail = state.screen === 'ports' ? state.port : state.screen === 'decision' ? state.current?.summary.vessel : null
  const crumbs: ReactNode[] = [section, label, tail].filter(Boolean)
  const showMode = state.screen === 'ports' || state.screen === 'decision'
  return (
    <header className="topbar">
      <button type="button" className="icon-btn menu-btn" onClick={onMenu} aria-label="메뉴 열기">
        <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden>
          <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <ol className="crumbs" aria-label="현재 위치">
        {crumbs.map((c, i) => (
          <li key={`${i}-${String(c)}`} className={i === crumbs.length - 1 ? 'here' : ''} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
            {c}
          </li>
        ))}
      </ol>
      <div className="topbar-grow" />
      <StatusPill state={state} />
      {showMode && (
        <Segmented
          label="모드"
          hideLabel
          variant="plain"
          value={state.mode}
          options={[
            { value: 'replay', label: '재생' },
            { value: 'live', label: '실시간' },
          ]}
          onChange={(m) => dispatch({ type: 'mode', mode: m })}
        />
      )}
      <SearchBox dispatch={dispatch} />
      <ThemeToggle />
      <Bell dispatch={dispatch} />
    </header>
  )
}
