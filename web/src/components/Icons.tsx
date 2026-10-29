import type { ReactNode } from 'react'

type P = { size?: number }

function Svg({ size = 16, children }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  )
}

export const IconAnchor = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="5" r="2" />
    <path d="M12 7v13M5 13h14M6.5 18.5a7 7 0 0 0 11 0" />
  </Svg>
)
export const IconPort = (p: P) => (
  <Svg {...p}>
    <path d="M4 20h16M6 20V10l6-4 6 4v10M10 20v-5h4v5" />
  </Svg>
)
export const IconShip = (p: P) => (
  <Svg {...p}>
    <path d="M3 16l2-6h14l2 6M4 16h16l-1.2 3.2a2 2 0 0 1-1.9 1.3H7.1a2 2 0 0 1-1.9-1.3L4 16zM12 10V4" />
  </Svg>
)
export const IconSim = (p: P) => (
  <Svg {...p}>
    <path d="M4 19V5M4 19h16" />
    <path d="M8 15v-4M12 15V8M16 15v-6" />
  </Svg>
)
export const IconDoc = (p: P) => (
  <Svg {...p}>
    <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v6h6M8 13h8M8 17h5" />
  </Svg>
)
export const IconCii = (p: P) => (
  <Svg {...p}>
    <path d="M4 19c4-1 6-8 8-8s4 7 8 8" />
    <path d="M12 11V5M9 7l3-2 3 2" />
  </Svg>
)
export const IconFile = (p: P) => (
  <Svg {...p}>
    <path d="M8 4h8a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2z" />
  </Svg>
)
export const IconBell = (p: P) => (
  <Svg {...p}>
    <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2H4.5L6 16z" />
    <path d="M10 18a2 2 0 0 0 4 0" />
  </Svg>
)
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6" />
    <path d="M16 16l4 4" />
  </Svg>
)
export const IconFuel = (p: P) => (
  <Svg {...p}>
    <path d="M7 20V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v14" />
    <path d="M6 20h12M16 8h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2" />
  </Svg>
)
export const IconLeaf = (p: P) => (
  <Svg {...p}>
    <path d="M5 19C5 11 11 5 19 5c0 8-6 14-14 14z" />
    <path d="M9 15c2-1 4-3 6-6" />
  </Svg>
)
export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v5l3 2" />
  </Svg>
)
export const IconGauge = (p: P) => (
  <Svg {...p}>
    <path d="M5 16a8 8 0 1 1 14 0" />
    <path d="M12 16l4-5" />
  </Svg>
)
export const IconPin = (p: P) => (
  <Svg {...p}>
    <path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z" />
    <circle cx="12" cy="11" r="1.6" />
  </Svg>
)
export const IconSend = (p: P) => (
  <Svg {...p}>
    <path d="M4 12l16-7-6 16-2.5-6.5L4 12z" />
  </Svg>
)
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 6v12M6 12h12" />
  </Svg>
)
export const IconMinus = (p: P) => (
  <Svg {...p}>
    <path d="M6 12h12" />
  </Svg>
)
