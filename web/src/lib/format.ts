export const fmtH = (h: number | null | undefined, digits = 1) =>
  h == null ? '-' : `${h.toFixed(h >= 100 ? 0 : digits)}시간`

export const fmtT = (t: number | null | undefined) => (t == null ? '-' : `${t.toFixed(1)} t`)

export const fmtN = (n: number | null | undefined) => (n == null ? '-' : n.toLocaleString('ko-KR'))

export const fmtKn = (v: number | null | undefined) => (v == null ? '-' : `${v.toFixed(1)}노트`)

export const fmtPct = (v: number) => `${Math.round(v * 100)}%`
