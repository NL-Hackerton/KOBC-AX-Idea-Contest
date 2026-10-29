import { ms } from './time'

/** 대기열 막대와 선석 분포가 공유하는 시간 창 (결정 시각 기준 시간). */
export function sharedWindow(tau: string, points: number[]): [number, number] {
  const finite = points.filter((n) => Number.isFinite(n))
  let lo = Math.min(0, ...finite)
  let hi = Math.max(24, ...finite)
  const span = Math.max(24, hi - lo)
  lo -= span * 0.06
  hi += span * 0.08
  if (!Number.isFinite(ms(tau))) return [0, 48]
  return [lo, hi]
}
