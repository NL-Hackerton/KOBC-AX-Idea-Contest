import type { ReactNode } from 'react'
import { useTween } from '../lib/motion'
import Icon from './Icon'

/** Screen title row: H1 + caption on the left, controls on the right (Figma "Header"). `bodySub`: 14px description instead of a 12px caption. */
export function PageHeader({ title, sub, right, bodySub = false }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; bodySub?: boolean }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {sub && <p className={`page-sub${bodySub ? ' body' : ''}`}>{sub}</p>}
      </div>
      {right && <div className="page-head-right">{right}</div>}
    </header>
  )
}

/** Card title row: H2 + optional caption and a right-aligned slot. */
export function CardHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="card-head">
      <div className="card-head-text">
        <h2>{title}</h2>
        {sub && <p className="small muted">{sub}</p>}
      </div>
      {right && <div className="card-head-right">{right}</div>}
    </div>
  )
}

/** Number that counts up from 0 on first show, then from its previous value to each new one (instant under reduced motion). */
export function CountUp({ value, format, duration = 700 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [v] = useTween([value], duration, [0])
  const decimals = Number.isInteger(value) ? 0 : (String(value).split('.')[1]?.length ?? 1)
  const text = format ? format(v) : v.toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return <span className="num">{text}</span>
}

type Tone = 'band' | 'good' | 'wait' | 'idle'

/** KPI card (Figma "KPI/*"): icon chip + label, big value + unit, caption. */
export function Kpi({ icon, tone = 'band', label, value, unit, format, sub, text }: { icon?: string; tone?: Tone; label: ReactNode; value?: number | null; unit?: ReactNode; format?: (n: number) => string; sub?: ReactNode; text?: ReactNode }) {
  return (
    <div className="kpi enter">
      <div className="kpi-head">
        {icon && (
          <span className={`kpi-icon tone-${tone}`}>
            <Icon src={icon} size={18} />
          </span>
        )}
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value">
        <strong>{text ?? (value == null ? '-' : <CountUp value={value} format={format} />)}</strong>
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      {sub && <p className="kpi-sub">{sub}</p>}
    </div>
  )
}
