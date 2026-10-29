import { useMemo, useState } from 'react'
import { fmtDT } from '../lib/time'
import type { Inbound, PortState } from '../types'
import { IconMinus, IconPlus, IconShip } from './Icons'

const SRC: Record<string, string> = {
  history: '이력',
  declared: '출항 예정 신고',
  live: '입항 신고',
  'live+position': '위치로 확인',
  pre: '사전 신고',
  final: '최종 신고',
}

const W = 960
const H = 520

function norm(s: string) {
  return s.trim().toUpperCase().replace(/\s+/g, ' ')
}

interface Dot {
  key: string
  name: string
  x: number
  y: number
  cls: 'berthed' | 'waiting' | 'other' | 'moving'
  title: string
  sub: string
  inboundId?: string
}

export default function HarborMap({
  ps,
  selectedId,
  onSelect,
  onDecide,
}: {
  ps: PortState
  selectedId: string | null
  onSelect: (id: string) => void
  onDecide: (id: string) => void
}) {
  const [zoom, setZoom] = useState(1)
  const inbound = ps.inbound.find((i) => i.id === selectedId) ?? ps.inbound.find((i) => i.targetKey) ?? ps.inbound[0] ?? null

  const geo = useMemo(() => project(ps, inbound), [ps, inbound])

  return (
    <div className="harbor">
      <svg viewBox={`0 0 ${W} ${H}`} className="harbor-svg" role="img" aria-label={`${ps.port} 시연용 해도. 점은 공개 선박 위치`}>
        <defs>
          <pattern id="harbor-dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1.2" cy="1.2" r="1.05" className="harbor-grid" />
          </pattern>
          <filter id="harbor-shadow" x="-20%" y="-20%" width="140%" height="160%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodOpacity="0.18" />
          </filter>
        </defs>
        <rect width={W} height={H} className="harbor-water" />
        <rect width={W} height={H} fill="url(#harbor-dots)" />
        <g transform={`translate(${W / 2} ${H / 2}) scale(${zoom}) translate(${-W / 2} ${-H / 2})`}>
          {/* 시연용 해안선. 실제 해도 타일이 아니라 자리표시이며, 점만 공개 위치다. */}
          <path
            className="harbor-land"
            d="M0 250C90 210 150 280 240 255C320 232 350 170 450 198C530 222 560 300 660 286C760 272 830 340 960 310L960 520L0 520Z"
          />
          <path className="harbor-land" d="M20 210C80 160 160 188 170 250C120 272 60 250 20 210Z" />
          <path className="harbor-shore" d="M0 250C90 210 150 280 240 255C320 232 350 170 450 198C530 222 560 300 660 286C760 272 830 340 960 310" />
          {geo.route && (
            <path className="harbor-route" d={geo.route} fill="none" />
          )}
          {geo.dots.map((d) => (
            <g key={d.key} className={`harbor-ship ${d.cls}${d.inboundId && d.inboundId === inbound?.id ? ' is-selected' : ''}`}>
              <circle
                cx={d.x}
                cy={d.y}
                r={d.inboundId && d.inboundId === inbound?.id ? 7 : d.cls === 'other' ? 3.2 : 4.4}
                tabIndex={d.inboundId ? 0 : undefined}
                role={d.inboundId ? 'button' : undefined}
                aria-label={d.inboundId ? `${d.name} 선택` : undefined}
                onClick={() => d.inboundId && onSelect(d.inboundId)}
                onKeyDown={(e) => {
                  if (d.inboundId && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    onSelect(d.inboundId)
                  }
                }}
              >
                <title>{d.title}</title>
              </circle>
            </g>
          ))}
          {geo.labels.map((d) => (
            <g key={`l-${d.key}`} className="harbor-label" transform={`translate(${d.x + 8} ${d.y - 28})`} filter="url(#harbor-shadow)">
              <rect width={labelW(d.name)} height={d.sub ? 36 : 22} rx="8" />
              <text x="8" y="15">
                {d.name}
              </text>
              {d.sub && (
                <text className="harbor-label-sub" x="8" y="29">
                  {d.sub}
                </text>
              )}
            </g>
          ))}
        </g>
      </svg>

      {inbound && (
        <article className="harbor-card">
          <header>
            <span className="harbor-card-ico">
              <IconShip size={18} />
            </span>
            <h2>{inbound.vessel}</h2>
            <span className="pill">{SRC[inbound.source] ?? inbound.source}</span>
          </header>
          <dl>
            <div>
              <dt>선종</dt>
              <dd>{inbound.kind || inbound.group}</dd>
            </div>
            <div>
              <dt>총톤수</dt>
              <dd className="num">{inbound.gt?.toLocaleString('ko-KR') ?? '-'}</dd>
            </div>
            <div>
              <dt>도착 예정</dt>
              <dd className="num">{fmtDT(inbound.eta)}</dd>
            </div>
            <div>
              <dt>목적 선석</dt>
              <dd>{inbound.facility}</dd>
            </div>
          </dl>
          {inbound.targetKey ? (
            <button type="button" className="btn primary block" onClick={() => onDecide(inbound.id)}>
              권고 보기 →
            </button>
          ) : (
            <p className="small muted">예측 대상 선석이 아니라 권고를 계산하지 않습니다.</p>
          )}
        </article>
      )}

      <div className="harbor-zoom">
        <button type="button" aria-label="확대" onClick={() => setZoom((z) => Math.min(2.4, Math.round((z + 0.2) * 10) / 10))}>
          <IconPlus size={16} />
        </button>
        <button type="button" aria-label="축소" onClick={() => setZoom((z) => Math.max(1, Math.round((z - 0.2) * 10) / 10))}>
          <IconMinus size={16} />
        </button>
      </div>

      <ul className="harbor-legend">
        <li>
          <i className="dot berthed" /> 예측 대상 선석에 접안
        </li>
        <li>
          <i className="dot waiting" /> 정박지 대기 (입항 신고 기준)
        </li>
        <li>
          <i className="dot other" /> 그 밖의 선박
        </li>
      </ul>
      <p className="harbor-note">지도 / 위성 타일 자리 · 시연용 자리표시</p>
    </div>
  )
}

function quantile(vals: number[], p: number) {
  const s = [...vals].sort((a, b) => a - b)
  const i = (s.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return s[lo] * (1 - (i - lo)) + s[hi] * (i - lo)
}

function labelW(name: string) {
  return Math.min(210, Math.max(88, name.length * 8 + 20))
}

function project(ps: PortState, inbound: Inbound | null) {
  const pts = ps.positions.filter((p) => p.lat && p.lon)
  const berthed = new Map(ps.berths.map((b) => [norm(b.vessel), b]))
  const waiting = new Map(ps.anchorage.map((w) => [norm(w.vessel), w]))
  const byName = new Map<string, Inbound>()
  ps.inbound.forEach((i) => {
    if (!byName.has(norm(i.vessel))) byName.set(norm(i.vessel), i)
  })

  if (pts.length === 0) {
    return { dots: [] as Dot[], labels: [] as Dot[], route: null as string | null }
  }

  const lats = pts.map((p) => p.lat)
  const lons = pts.map((p) => p.lon)
  // 바깥 점은 항만 밀집 구간을 찌그러뜨리므로 4–96% 범위에 맞춘다.
  let la0 = quantile(lats, 0.04)
  let la1 = quantile(lats, 0.96)
  let lo0 = quantile(lons, 0.04)
  let lo1 = quantile(lons, 0.96)
  const padLa = (la1 - la0) * 0.12 || 0.01
  const padLo = (lo1 - lo0) * 0.12 || 0.01
  la0 -= padLa
  la1 += padLa
  lo0 -= padLo
  lo1 += padLo
  const k = Math.cos((((la0 + la1) / 2) * Math.PI) / 180)
  const box = { x: 48, y: 28, w: W - 96, h: H - 64 }
  const sx = box.w / ((lo1 - lo0) * k || 1)
  const sy = box.h / (la1 - la0 || 1)
  const s = Math.min(sx, sy)
  const ox = box.x + (box.w - (lo1 - lo0) * k * s) / 2
  const oy = box.y + (box.h - (la1 - la0) * s) / 2
  const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n))
  const X = (lon: number) => clamp(ox + (lon - lo0) * k * s, 16, W - 16)
  const Y = (lat: number) => clamp(oy + (la1 - lat) * s, 16, H - 16)

  const dots: Dot[] = pts.map((p, i) => {
    const n = norm(p.name)
    const b = berthed.get(n)
    const w = waiting.get(n)
    const inn = byName.get(n)
    const cls = b ? 'berthed' : w ? 'waiting' : p.sog > 1 ? 'moving' : 'other'
    const sub = b ? `${b.berth} · 접안` : w ? `${w.anchorage ?? '정박지'} · 대기 ${w.waitedH.toFixed(0)}시간` : inn ? `${inn.facility}` : p.sog > 1 ? `${p.sog.toFixed(1)}노트` : ''
    return {
      key: `${p.callsign}-${p.t}-${i}`,
      name: p.name,
      x: X(p.lon),
      y: Y(p.lat),
      cls,
      title: `${p.name} · ${p.sog?.toFixed(1) ?? '-'}노트 · ${fmtDT(p.t)}`,
      sub,
      inboundId: inn?.id,
    }
  })

  const priority = (d: Dot) => (d.inboundId && d.inboundId === inbound?.id ? 0 : d.cls === 'berthed' ? 1 : d.cls === 'waiting' ? 2 : 9)
  const ranked = [...dots].sort((a, b) => priority(a) - priority(b) || a.name.localeCompare(b.name, 'ko'))
  const labels: Dot[] = []
  for (const d of ranked) {
    if (priority(d) > 2) break
    if (labels.length >= 6) break
    if (d.x < 340 && d.y < 230) continue
    const box = { x: d.x + 8, y: d.y - 28, w: labelW(d.name), h: 36 }
    const hit = labels.some((o) => {
      const ob = { x: o.x + 8, y: o.y - 28, w: labelW(o.name), h: 36 }
      return box.x < ob.x + ob.w && box.x + box.w > ob.x && box.y < ob.y + ob.h && box.y + box.h > ob.y
    })
    if (!hit) labels.push(d)
  }

  const sel = inbound ? dots.find((d) => d.inboundId === inbound.id) : undefined
  const dest = dots.find((d) => d.cls === 'berthed')
  // TODO: 항로 좌표는 저장본에 없다. 선택 선박과 접안 선박이 둘 다 있을 때만 시선 유도용 점선을 긋는다.
  const route = sel && dest ? `M${sel.x} ${sel.y} Q ${(sel.x + dest.x) / 2} ${Math.min(sel.y, dest.y) - 40} ${dest.x} ${dest.y}` : null
  return { dots, labels, route }
}
