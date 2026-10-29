import type { ReactNode } from 'react'

export default function KpiCard({
  icon,
  label,
  value,
  unit,
  sub,
  loading,
  empty,
  selected,
  onClick,
}: {
  icon?: ReactNode
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  loading?: boolean
  empty?: boolean
  selected?: boolean
  onClick?: () => void
}) {
  const cls = `kpi${selected ? ' is-selected' : ''}${empty ? ' is-empty' : ''}${loading ? ' is-loading' : ''}`
  const body = (
    <>
      <div className="kpi-top">
        {icon && <span className="kpi-ico">{icon}</span>}
        <span className="kpi-label">{label}</span>
      </div>
      {loading ? (
        <div className="skel skel-lg" />
      ) : (
        <p className="kpi-value num">
          {empty ? '—' : value}
          {!empty && unit && <span className="kpi-unit">{unit}</span>}
        </p>
      )}
      {sub && <p className="kpi-sub">{loading ? <span className="skel skel-sm" /> : sub}</p>}
    </>
  )
  if (onClick) {
    return (
      <button type="button" className={cls} aria-pressed={selected} aria-busy={loading || undefined} onClick={onClick}>
        {body}
      </button>
    )
  }
  return (
    <article className={cls} aria-busy={loading || undefined}>
      {body}
    </article>
  )
}
