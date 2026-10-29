import { useEffect, useMemo, useRef, useState } from 'react'
import { searchLocal, type SearchHit } from '../api'
import type { Action } from '../state'
import { IconSearch } from './Icons'

export default function SearchBox({ dispatch }: { dispatch: (a: Action) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const hits = useMemo(() => (q.trim() ? searchLocal(q) : []), [q])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function go(h: SearchHit) {
    if (h.caseId) dispatch({ type: 'openReplay', id: h.caseId })
    else dispatch({ type: 'openLive', port: h.port, shipId: h.shipId ?? null })
    setQ('')
    setOpen(false)
  }

  return (
    <div className="search" ref={box}>
      <IconSearch size={16} />
      <input
        value={q}
        placeholder="선박명, 선석, 항차 검색"
        aria-label="선박명, 선석, 항차 검색"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) {
            e.preventDefault()
            go(hits[0])
          }
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && q.trim() && (
        <ul className="search-pop" role="listbox">
          {hits.length === 0 && <li className="muted">해당하는 선박·선석이 없습니다.</li>}
          {hits.map((h) => (
            <li key={`${h.caseId ?? h.shipId}-${h.label}`}>
              <button type="button" role="option" onClick={() => go(h)}>
                <strong>{h.label}</strong>
                <span className="muted">{h.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
