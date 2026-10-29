import type { ReactNode } from 'react'

export default function PageHeader({ title, lede, extra }: { title: string; lede?: ReactNode; extra?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-titles">
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {extra && <div className="page-extra">{extra}</div>}
    </header>
  )
}
