import { useLayoutEffect, useRef } from 'react'

interface Opt<T extends string> {
  value: T
  label: string
  hint?: string
}

/**
 * Segmented control. `primary` (default): selected option filled with the brand color (port tabs, 정보 조건, 위험 수준).
 * `plain`: selected option lifted on white (재생/실시간). The selection pill slides between options.
 */
export default function Segmented<T extends string>({ label, value, options, onChange, variant = 'primary', hideLabel = false, boxed = false }: { label: string; value: T; options: Opt<T>[]; onChange: (v: T) => void; variant?: 'primary' | 'plain'; hideLabel?: boolean; boxed?: boolean }) {
  const current = options.find((o) => o.value === value)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const place = () => {
      const on = box.querySelector<HTMLElement>('button.on')
      if (!on) return box.style.setProperty('--pill-w', '0px')
      box.style.setProperty('--pill-x', `${on.offsetLeft}px`)
      box.style.setProperty('--pill-w', `${on.offsetWidth}px`)
    }
    place()
    // Fonts arriving late change label widths; keep the pill under the selected option.
    const ro = new ResizeObserver(place)
    ro.observe(box)
    return () => ro.disconnect()
  }, [value, options.length])
  return (
    <div className="seg-wrap">
      {!hideLabel && <span className="seg-label small muted">{label}</span>}
      <div ref={ref} className={`seg seg-${variant}${boxed ? ' boxed' : ''}`} role="radiogroup" aria-label={label}>
        <span className="seg-pill" aria-hidden />
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {current?.hint && <span className="seg-hint small muted">{current.hint}</span>}
    </div>
  )
}
