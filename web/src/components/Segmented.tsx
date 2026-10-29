interface Opt<T extends string> {
  value: T
  label: string
  hint?: string
}

export default function Segmented<T extends string>({ label, value, options, onChange, variant = 'soft' }: { label: string; value: T; options: Opt<T>[]; onChange: (v: T) => void; variant?: 'soft' | 'accent' }) {
  const current = options.find((o) => o.value === value)
  return (
    <div className={`seg-wrap${variant === 'accent' ? ' seg-accent' : ''}`}>
      <span className="seg-label small muted">{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {current?.hint && <span className="seg-hint small muted">{current.hint}</span>}
    </div>
  )
}
