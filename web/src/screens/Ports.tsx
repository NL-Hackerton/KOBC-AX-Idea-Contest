import { scaleLinear } from 'd3-scale'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getPortState, hasServer } from '../api'
import { fmtDT, fromLocalInput, ms, toLocalInput } from '../lib/time'
import { useWidth } from '../lib/useWidth'
import { stagger, useTween } from '../lib/motion'
import { CardHead, Kpi, PageHeader } from '../components/ui'
import Segmented from '../components/Segmented'
import Icon from '../components/Icon'
import anchor from '../assets/icons/anchor.svg'
import ship from '../assets/icons/ship.svg'
import clock from '../assets/icons/ports-clock.svg'
import move from '../assets/icons/ports-move.svg'
import coast from '../assets/icons/ports-coast.svg'
import anchorage from '../assets/icons/ports-anchorage.svg'
import anchorageOutline from '../assets/icons/ports-anchorage-outline.svg'
import north from '../assets/icons/ports-north.svg'
import type { Action, AppState } from '../state'
import type { BerthOcc, PortState } from '../types'
import '../styles/ports.css'

const PORTS = ['울산', '대산', '광양', '여천']
const SRC: Record<string, string> = { history: '이력', declared: '출항 예정 신고', live: '입항 신고', 'live+position': '위치로 확인', pre: '사전 신고', final: '최종 신고' }
const berthMarkers: [string, number, number, boolean][] = [
  ['3부두 01', 582.1, 51.7, true], ['5부두 01', 587.7, 67, true], ['6부두 03', 696.3, 245.6, false],
  ['대한통운신항부두', 574.7, 381.1, true], ['석탄부두 01', 595.8, 38.3, false], ['양곡부두', 608, 152.3, false],
  ['일반부두 06', 624.6, 110.1, false], ['OTK부두', 604.4, 344.2, false], ['SK7부두', 574.4, 148.8, true], ['SK2부두 02', 584.4, 251.7, true],
]
// Calibrated to the Figma OSM map using EVER SUCCESS (35.52548833,129.37352)
// and SEASHIN (35.45664833,129.37355167); horizontal scale uses its 1 km ruler.
const project = (lat: number, lon: number) => ({ x: 577 + (lon - 129.37352) * 3045, y: 54 + (35.52548833 - lat) * 3588 })

export default function Ports({ state, dispatch }: { state: AppState; dispatch: (a: Action) => void }) {
  const port = PORTS.includes(state.port) ? state.port : '울산'
  const [at, setAt] = useState<string | null>(null)
  const queryAt = state.mode === 'replay' ? at : null
  const requestKey = `${port}:${queryAt ?? 'latest'}`
  const [result, setResult] = useState<{ key: string; ps: PortState | null } | null>(null)
  const loading = result?.key !== requestKey
  const ps = !loading ? result?.ps : null
  useEffect(() => {
    let active = true
    getPortState(port, queryAt ?? undefined).then((ps) => { if (active) setResult({ key: requestKey, ps }) }).catch(() => { if (active) setResult({ key: requestKey, ps: null }) })
    return () => { active = false }
  }, [port, queryAt, requestKey])
  return <div className="screen ports">
    <PageHeader title="항만 현황" sub={ps ? `기준 ${fmtDT(ps.at)} · 수집 반영 ${fmtDT(ps.updatedAt)}` : '항만 상태를 불러옵니다.'} right={<Segmented label="항만" hideLabel boxed value={port} options={PORTS.map(p => ({ value: p, label: p }))} onChange={p => dispatch({ type: 'port', port: p })} />} />
    {state.mode === 'replay' && hasServer() && <label className="ports-time small muted">시각 <input aria-label="과거 항만 조회 시각" type="datetime-local" value={at ? toLocalInput(at) : ''} min="2025-10-01T00:00" onChange={e => setAt(e.target.value ? fromLocalInput(e.target.value) : null)} /><button className="small-btn" onClick={() => setAt(null)} disabled={!at}>최신 저장본</button></label>}
    {loading ? <div className="ports-loading skeleton" aria-label="항만 상태 불러오는 중" /> : ps ? <PortView key={`${ps.port}-${ps.at}`} ps={ps} onDecide={id => dispatch({ type: 'openLive', port: ps.port, shipId: id })} /> : <p className="notice">이 시각의 상태를 불러오지 못했습니다. 다른 시각이나 항만을 선택해 주세요.</p>}
    {!hasServer() && <p className="ports-snapshot-note">이 배포본은 오른쪽 위 기준 시각의 항만 상태로 고정되어 있습니다.</p>}
  </div>
}

function PortView({ ps, onDecide }: { ps: PortState; onDecide: (id: string) => void }) {
  const [selected, setSelected] = useState(ps.inbound.find(i => i.targetKey)?.callsign ?? ps.inbound[0]?.callsign ?? '')
  const [tab, setTab] = useState<'inbound' | 'waiting'>('inbound')
  const decidable = ps.inbound.filter(i => i.targetKey).length
  return <>
    <PortMap ps={ps} selected={selected} onSelect={setSelected} onDecide={onDecide} />
    <div className="kpi-row ports-kpis">
      <Kpi icon={anchor} label="접안 중" value={ps.berths.length} unit="척" sub={`예측 대상 선석 ${ps.singleBerths.length}곳`} />
      <Kpi icon={clock} tone="wait" label="정박지 대기" value={ps.anchorage.length} unit="척" sub="입항 신고 기준" />
      <Kpi icon={ship} label="5일 안 입항 예정" value={ps.inbound.length} unit="척" sub={`사전 신고 ${ps.inbound.filter(i => i.source === 'pre').length}`} />
      <Kpi icon={move} tone="good" label="선석 이동 확인" value={ps.shiftedByPosition} unit="척" sub={ps.port === '울산' ? '위치로 확인' : '공개 신고 기준'} />
    </div>
    <div className="ports-bottom">
      <BerthBoard ps={ps} />
      <section className="card ports-arrivals enter" style={stagger(2)}>
        <CardHead title={tab === 'inbound' ? '입항 예정 · 권고 가능' : '정박지 대기'} right={<span className="ports-count">{tab === 'inbound' ? decidable : ps.anchorage.length}척</span>} />
        <p className="small muted">{tab === 'inbound' ? '예측 대상 선석으로 신고된 배는 바로 권고를 볼 수 있습니다.' : '정박지 도착 시각과 목적 선석을 확인합니다.'}</p>
        <div className="ports-list-scroll">
          {tab === 'inbound' ? ps.inbound.map((i, n) => <div key={i.id} className={`ports-inbound-row enter${i.callsign === selected ? ' selected' : ''}`} style={stagger(Math.min(n, 7))}>
            <button className="ports-select-vessel" aria-pressed={selected === i.callsign} onClick={() => setSelected(i.callsign)}>
              <time>{fmtDT(i.eta)}</time><span><strong>{i.vessel}</strong><small>{i.facility} · {SRC[i.source] ?? i.source}</small></span>
            </button>
            {i.targetKey && ps.live && <button className="chip-soft" aria-label={`${i.vessel} 권고 보기`} onClick={() => onDecide(i.id)}>권고 보기</button>}
          </div>) : <table className="data-table small"><thead><tr><th>선박 · 정박지 도착</th><th>대기 · 목적 선석</th></tr></thead><tbody>{ps.anchorage.map(w => <tr key={`${w.callsign}-${w.since}`}><td><button className="ports-wait-select" onClick={() => setSelected(w.callsign)}>{w.vessel}</button><small>{fmtDT(w.since)}</small></td><td>{w.waitedH.toFixed(0)}시간<small>{w.targetBerth ? `${w.targetBerth} · ${SRC[w.source] ?? w.source}` : '공개 신고에 없음'}</small></td></tr>)}</tbody></table>}
          {!(tab === 'inbound' ? ps.inbound.length : ps.anchorage.length) && <p className="ports-list-empty">현재 표시할 선박이 없습니다.</p>}
        </div>
        <div className="ports-list-tabs"><button className={tab === 'inbound' ? 'active' : ''} onClick={() => setTab('inbound')}>입항 예정 {ps.inbound.length}</button><button className={tab === 'waiting' ? 'active' : ''} onClick={() => setTab('waiting')}>정박지 대기 {ps.anchorage.length}</button></div>
      </section>
    </div>
  </>
}

function BerthBoard({ ps }: { ps: PortState }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [all, setAll] = useState(false)
  const at = ms(ps.at)
  const byKey = useMemo(() => {
    const map = new Map<string, BerthOcc[]>()
    ps.berths.forEach(b => map.set(b.berthKey, [...(map.get(b.berthKey) ?? []), b]))
    return map
  }, [ps])
  const relevant = new Set([...ps.inbound.map(i => i.targetKey), ...ps.anchorage.map(i => i.targetKey)].filter((key): key is string => Boolean(key) && !byKey.has(key!)).slice(0, 2))
  const berths = ps.singleBerths.filter(r => all || byKey.has(r.key))
  const emptyBerths = ps.singleBerths.filter(r => !byKey.has(r.key) && (all || relevant.has(r.key)))
  const rows = [...berths, ...(!all ? emptyBerths : [])].flatMap<{ r: PortState['singleBerths'][number]; b: BerthOcc | null; first: boolean }>(r => (byKey.get(r.key) ?? []).length ? (byKey.get(r.key) ?? []).map((b, i) => ({ r, b, first: i === 0 })) : [{ r, b: null, first: true }])
  const W = Math.max(676, width)
  const x = scaleLinear().domain([-48, 96]).range([184, W - 12]).clamp(true)
  const H = Math.max(180, rows.length * 22 + 30)
  const [progress] = useTween([1], 800, [0])
  return <section className="card ports-board-card enter" style={stagger(1)}>
    <CardHead title="선석 점유" sub="선석별 점유와 남은 체류 예측" right={<span className="small muted">기준 {fmtDT(ps.at)}</span>} />
    <div ref={ref} className="ports-board-scroll"><svg width={W} height={H} role="img" aria-label="선석별 점유와 남은 체류 예측">
      {[-48, -24, 0, 24, 48, 72, 96].map(h => <g key={h}><line className={h === 0 ? 'ports-now' : 'ports-grid'} x1={x(h)} x2={x(h)} y1={0} y2={H - 28} /><text className={`ports-axis${h === 0 ? ' current' : ''}`} x={x(h)} y={H - 7} textAnchor="middle">{h === 0 ? '지금' : `${h > 0 ? '+' : ''}${h}h`}</text></g>)}
      {rows.map(({ r, b, first }, n) => <g key={`${r.key}-${n}`} transform={`translate(0,${n * 22 + 2})`}>
        {first && <text className="ports-row-label" x={0} y={14}>{r.name}</text>}
        {!b ? <text className="ports-axis" x={188} y={14}>비어 있음</text> : (() => {
          const [lo, , , med, , , hi] = b.predQ
          const labelX = Math.min(x(hi) + 6, W - Math.min(155, b.vessel.length * 6.8 + 8))
          return <g><title>{`${b.vessel} · 접안 ${fmtDT(b.since)} · 남은 체류 예측 ${med.toFixed(0)}시간 (${lo.toFixed(0)}~${hi.toFixed(0)})${b.declaredDepart ? ` · 출항 예정 신고 ${fmtDT(b.declaredDepart)}` : ''}${b.actualDepart ? ` · 실제 출항 ${fmtDT(b.actualDepart)}` : ''}`}</title>
            <rect className="ports-occ" x={x(0) - (x(0) - x(-b.elapsedH)) * progress} width={Math.max(1, (x(0) - x(-b.elapsedH)) * progress)} y={4} height={12} rx={2} />
            <rect className="ports-pred" x={x(lo * progress)} width={Math.max(1, x(hi * progress) - x(lo * progress))} y={6} height={8} rx={2} />
            <line className="ports-median" x1={x(med * progress)} x2={x(med * progress)} y1={1} y2={19} />
            {b.declaredDepart && <circle className="ports-declared" cx={x((ms(b.declaredDepart) - at) / 3600000)} cy={10} r={4} />}
            {b.actualDepart && <circle className="ports-actual" cx={x((ms(b.actualDepart) - at) / 3600000)} cy={10} r={4} />}
            <rect className="ports-label-bg" x={labelX - 3} y={0} width={Math.min(155, b.vessel.length * 6.8 + 8)} height={21} rx={3} /><text className="ports-vessel-label" x={labelX} y={14}>{b.vessel}</text>
          </g>
        })()}
      </g>)}
    </svg></div>
    <div className="ports-board-legend"><span><i className="occupied" />접안 후 경과</span><span><i className="remaining" />남은 체류 예측 10~90%</span><span><i className="median" />예측 중앙</span><span><i className="declared" />출항 예정 신고</span>{!ps.live && <span><i className="actual" />실제 출항</span>}</div>
    <button className="ports-all-berths" onClick={() => setAll(!all)} aria-expanded={all}>{all ? '관련 선석만 보기' : `전체 선석 ${ps.singleBerths.length}곳 보기`}</button>
  </section>
}

function PortMap({ ps, selected, onSelect, onDecide }: { ps: PortState; selected: string; onSelect: (id: string) => void; onDecide: (id: string) => void }) {
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const [zoom, panX, panY] = useTween([view.zoom, view.x, view.y], dragging ? 0 : 200)
  const inbound = ps.inbound.find(i => i.callsign === selected)
  const berth = ps.berths.find(i => i.callsign === selected)
  const waiting = ps.anchorage.find(i => i.callsign === selected)
  const position = ps.positions.find(i => i.callsign === selected)
  const name = inbound?.vessel ?? berth?.vessel ?? waiting?.vessel ?? position?.name
  const berthed = new Set(ps.berths.map(b => b.callsign))
  const waits = new Set(ps.anchorage.map(w => w.callsign))
  const zoomBy = (step: number) => setView(v => ({ ...v, zoom: Math.min(4, Math.max(0.75, v.zoom * step)) }))
  const reset = () => setView({ zoom: 1, x: 0, y: 0 })
  const available = ps.port === '울산' && ps.positions.length > 0
  const target = berthMarkers.find(b => b[0] === inbound?.facility)
  const rawFocus = position ? project(position.lat, position.lon) : null
  const outside = rawFocus && (rawFocus.x < 20 || rawFocus.x > 1110 || rawFocus.y < 20 || rawFocus.y > 400)
  const focus = rawFocus ? (outside ? { x: 930, y: 250 } : rawFocus) : null
  const callouts = useMemo(() => {
    const positioned = new Map(ps.positions.map(p => [p.callsign, { ...p, ...project(p.lat, p.lon) }]))
    const visible = (callsign: string) => {
      const p = positioned.get(callsign)
      return callsign !== selected && p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 12 && p.x <= 1124 && p.y >= 12 && p.y <= 408
    }
    const candidates = [
      ...ps.anchorage.filter(w => visible(w.callsign)).sort((a, b) => b.waitedH - a.waitedH).slice(0, 2).map(w => ({ callsign: w.callsign, vessel: w.vessel, detail: `${w.anchorage ?? '정박지'} · 대기 ${w.waitedH.toFixed(0)}시간` })),
      ...ps.berths.filter(b => visible(b.callsign)).sort((a, b) => ms(b.since) - ms(a.since)).slice(0, 1).map(b => ({ callsign: b.callsign, vessel: b.vessel, detail: `${b.berth} · 접안` })),
    ]
    const reserved = [{ x: 0, y: 0, width: 340, height: 305 }, { x: 0, y: 330, width: 450, height: 90 }]
    if (focus) reserved.push({ x: focus.x - 14, y: focus.y - 14, width: 220, height: 85 })
    const berthObstacles = berthMarkers.flatMap(([label, x, y, left]) => [
      { x: left ? x - label.length * 7.7 - 17 : x + 10, y: y - 13, width: label.length * 7.7 + 12, height: 22 },
      { x: x - 5, y: y - 5, width: 10, height: 10 },
    ])
    reserved.push(...berthObstacles)
    if (focus) {
      const points = target ? [{ x: target[1], y: target[2] }, { x: target[1] + 45, y: target[2] - 45 }, focus] : [{ x: focus.x - 80, y: focus.y + 25 }, focus]
      points.slice(1).forEach((end, i) => {
        const start = points[i]
        reserved.push({ x: Math.min(start.x, end.x) - 5, y: Math.min(start.y, end.y) - 5, width: Math.abs(end.x - start.x) + 10, height: Math.abs(end.y - start.y) + 10 })
      })
    }
    // Slab intersection rejects leader lines that cut through labels or another card.
    const lineCrosses = (ax: number, ay: number, bx: number, by: number, box: typeof reserved[number]) => {
      let near = 0
      let far = 1
      for (const [start, delta, min, max] of [[ax, bx - ax, box.x - 3, box.x + box.width + 3], [ay, by - ay, box.y - 3, box.y + box.height + 3]]) {
        if (Math.abs(delta) < .001) { if (start < min || start > max) return false; continue }
        const t0 = (min - start) / delta
        const t1 = (max - start) / delta
        near = Math.max(near, Math.min(t0, t1))
        far = Math.min(far, Math.max(t0, t1))
        if (near > far) return false
      }
      return true
    }
    const placed: { callsign: string; vessel: string; detail: string; x: number; y: number; width: number; px: number; py: number }[] = []
    for (const candidate of candidates) {
      const p = positioned.get(candidate.callsign)!
      const width = Math.min(245, Math.max(145, candidate.vessel.length * 7 + 20, candidate.detail.length * 6 + 20))
      const height = 54
      const offsets = [[-width - 24, -20], [24, -20], [-width - 24, -height - 20], [24, -height - 20], [-width / 2, 28], [-width / 2, -height - 28]]
      const slots = offsets.map(([dx, dy]) => ({ x: Math.max(12, Math.min(1124 - width, p.x + dx)), y: Math.max(12, Math.min(408 - height, p.y + dy)), width, height }))
      // Search nearby free space first; grid candidates let dense berth clusters flip sides.
      for (let y = 12; y <= 354; y += 18) {
        for (let x = 352; x <= 1124 - width; x += 18) slots.push({ x, y, width, height })
      }
      slots.sort((a, b) => Math.hypot(p.x - Math.max(a.x, Math.min(a.x + width, p.x)), p.y - Math.max(a.y, Math.min(a.y + height, p.y))) - Math.hypot(p.x - Math.max(b.x, Math.min(b.x + width, p.x)), p.y - Math.max(b.y, Math.min(b.y + height, p.y))))
      const slot = slots.find(box => {
        if (reserved.some(r => box.x < r.x + r.width + 8 && box.x + box.width + 8 > r.x && box.y < r.y + r.height + 8 && box.y + box.height + 8 > r.y)) return false
        const endX = Math.max(box.x, Math.min(box.x + box.width, p.x))
        const endY = Math.max(box.y, Math.min(box.y + box.height, p.y))
        return !reserved.some(r => lineCrosses(p.x, p.y, endX, endY, r))
      })
      if (!slot) continue
      reserved.push(slot)
      placed.push({ ...candidate, ...slot, px: p.x, py: p.y })
    }
    return placed
    // `focus` is a fresh object every render; its coordinates are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ps, selected, focus?.x, focus?.y, target])
  useEffect(() => {
    const node = mapRef.current
    if (!node || !available) return
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12) }
    node.addEventListener('wheel', wheel, { passive: false })
    return () => node.removeEventListener('wheel', wheel)
  }, [available])
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setView({ zoom: 1, x: 0, y: 0 }) }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [])
  return <section ref={mapRef} className={`ports-map enter${available ? '' : ' unavailable'}`} aria-label={`${ps.port}항 선박 지도`} tabIndex={0} onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'Escape') reset(); if (e.key === '+' || e.key === '=') zoomBy(1.2); if (e.key === '-') zoomBy(1 / 1.2); if (e.key.startsWith('Arrow')) { e.preventDefault(); setView(v => ({ ...v, x: v.x + (e.key === 'ArrowLeft' ? 40 : e.key === 'ArrowRight' ? -40 : 0), y: v.y + (e.key === 'ArrowUp' ? 40 : e.key === 'ArrowDown' ? -40 : 0) })) } }}>
    {available ? <>
      <svg className="ports-map-svg" viewBox="0 0 1136 420" preserveAspectRatio="xMidYMid slice" aria-label="울산항 OSM 해안선과 AIS 선박 위치"
        onPointerDown={e => { if ((e.target as Element).closest('[data-vessel]')) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y }; setDragging(true) }}
        onPointerMove={e => { const d = drag.current; if (d) { const box = e.currentTarget.getBoundingClientRect(); const scale = 1 / Math.max(box.width / 1136, box.height / 420); setView(v => ({ ...v, x: d.ox + (e.clientX - d.x) * scale, y: d.oy + (e.clientY - d.y) * scale })) } }}
        onPointerUp={() => { drag.current = null; setDragging(false) }}
        onPointerCancel={() => { drag.current = null; setDragging(false) }}>
        <defs><mask id="ports-coast-mask"><image href={coast} x="0" y="0" width="828.6" height="421" /></mask><mask id="ports-anchor-mask"><image href={anchorage} x="691.7" y="258" width="196.3" height="167.5" /></mask></defs>
        <g transform={`translate(${568 + panX} ${210 + panY}) scale(${zoom}) translate(-568 -210)`}>
          <rect x="0" y="0" width="829" height="421" fill="var(--map-land)" mask="url(#ports-coast-mask)" />
          <rect x="691" y="258" width="198" height="168" className="ports-anchorage-fill" mask="url(#ports-anchor-mask)" /><image href={anchorageOutline} x="691.4" y="257.7" width="196.8" height="168" opacity="0.9" /><text className="ports-anchorage-label" x="750" y="400">정박지 E1·E2</text>
          {ps.positions.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)).map((p, n) => { const point = project(p.lat, p.lon); const cls = berthed.has(p.callsign) ? 'berthed' : waits.has(p.callsign) ? 'waiting' : p.sog > 1 ? 'moving' : 'other'; return <g key={`${p.callsign}-${n}`} data-vessel="true" className={`ports-dot ${cls}${selected === p.callsign ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`${p.name} 선택 · ${cls === 'berthed' ? '접안' : cls === 'waiting' ? '정박지 대기' : cls === 'moving' ? '이동 중' : '그 밖의 선박'}`} aria-pressed={selected === p.callsign} onClick={() => onSelect(p.callsign)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.callsign) } }}><title>{`${p.name} · ${p.sog.toFixed(1)}노트 · ${fmtDT(p.t)}`}</title><circle className="ports-dot-hit" cx={point.x} cy={point.y} r="10" /><circle className="ports-dot-mark" cx={point.x} cy={point.y} r={cls === 'berthed' || cls === 'waiting' ? 4.2 : 2.5} style={stagger(n % 8)} /></g> })}
          {berthMarkers.map(([label, x, y, left]) => <g key={label} className="ports-berth-marker"><rect x={x - 5} y={y - 5} width="10" height="10" rx="1" /><rect className="ports-map-label-bg" x={left ? x - label.length * 7.7 - 17 : x + 10} y={y - 13} width={label.length * 7.7 + 12} height="22" rx="3" /><text x={left ? x - 12 : x + 16} y={y + 2} textAnchor={left ? 'end' : 'start'}>{label}</text></g>)}
          {callouts.map(c => <g key={c.callsign} className="ports-map-callout"><path d={`M${c.px},${c.py} L${Math.max(c.x, Math.min(c.x + c.width, c.px))},${Math.max(c.y, Math.min(c.y + 54, c.py))}`} /><rect x={c.x} y={c.y} width={c.width} height="54" rx="8" /><text x={c.x + 10} y={c.y + 22}>{c.vessel}</text><text className="detail" x={c.x + 10} y={c.y + 42}>{c.detail}</text></g>)}
          {focus && <g className="ports-focus-marker"><path d={target ? `M${target[1]},${target[2]} L${target[1] + 45},${target[2] - 45} L${focus.x},${focus.y}` : `M${focus.x - 80},${focus.y + 25} L${focus.x},${focus.y}`} /><circle cx={focus.x} cy={focus.y} r="12" className="halo" /><circle cx={focus.x} cy={focus.y} r="7" /><rect x={focus.x + 18} y={focus.y + 12} width="184" height="56" rx="8" /><text x={focus.x + 28} y={focus.y + 34}>{name}</text><text className="detail" x={focus.x + 28} y={focus.y + 53}>{outside ? '항외 접근 중 · 지도 범위 밖' : inbound ? `${inbound.facility} · 입항 예정` : '선택한 선박'}</text></g>}
        </g>
      </svg>
      <div className="ports-zoom"><button aria-label="지도 확대" onClick={() => zoomBy(1.25)}>+</button><button aria-label="지도 축소" onClick={() => zoomBy(0.8)}>−</button></div>
      <button className="ports-north" aria-label="지도 초기화 · 북쪽 방향" title="Esc 키로 지도를 초기화합니다." onClick={reset}><Icon src={north} size={20} /><span>N</span></button>
      <div className="ports-scale"><span>{zoom === 1 ? '1 km' : `${(1 / zoom).toFixed(1)} km`}</span><i /></div>
      <div className="ports-map-legend"><span><i className="berthed" />예측 대상 선석에 접안</span><span><i className="waiting" />정박지 대기 (입항 신고 기준)</span><span><i className="moving" />이동 중</span><span><i className="other" />그 밖의 선박</span><span><i className="berth" />선석</span><span><i className="area" />정박지 구역 (근사)</span></div>
    </> : <div className="ports-map-empty"><Icon src={anchor} size={32} /><strong>{ps.port}항 지도 준비 중입니다.</strong><p>현재 제공되는 해안선과 선박 위치는 울산항 기준입니다.<br />아래 선석 점유와 입항 신고에서 항만 현황을 확인할 수 있습니다.</p></div>}
    {available && name && <div className="ports-focus-card" key={selected}><div className="ports-focus-title"><strong>{name}</strong>{inbound && <span className="chip-soft">{SRC[inbound.source] ?? inbound.source}</span>}</div><dl><div><dt>선종</dt><dd>{inbound?.group ?? berth?.group ?? waiting?.group ?? '공개 정보 없음'}</dd></div><div><dt>총톤수</dt><dd>{(inbound?.gt ?? berth?.gt ?? waiting?.gt)?.toLocaleString('ko-KR') ?? '공개 정보 없음'}</dd></div><div><dt>{inbound ? '도착 예정' : waiting ? '정박지 도착' : '위치 수집'}</dt><dd>{fmtDT(inbound?.eta ?? waiting?.since ?? position?.t ?? ps.at)}</dd></div><div><dt>목적 선석</dt><dd>{inbound?.facility ?? berth?.berth ?? waiting?.targetBerth ?? '공개 신고에 없음'}</dd></div></dl>{inbound?.targetKey && ps.live ? <button className="btn primary block" onClick={() => onDecide(inbound.id)}>권고 보기 <span aria-hidden>→</span></button> : <p className="ports-focus-hint">{position ? `AIS ${position.sog.toFixed(1)}노트 · ${fmtDT(position.t)}` : '현재 공개된 위치 정보가 없습니다.'}</p>}</div>}
  </section>
}
