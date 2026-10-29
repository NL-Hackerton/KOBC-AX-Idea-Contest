import { useEffect, useRef, useState, type CSSProperties } from 'react'

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** 숫자 배열을 이전 값에서 새 값으로 duration 동안 보간한다. initial 을 주면 첫 표시도 그 값에서 출발한다. 감소된 모션이면 즉시 바뀐다. */
export function useTween(target: number[], duration = 240, initial?: number[]): number[] {
  const [value, setValue] = useState(initial ?? target)
  const from = useRef(initial ?? target)
  const key = target.join(',')
  useEffect(() => {
    const start = from.current
    if (reduced() || start.length !== target.length) {
      from.current = target
      setValue(target)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / duration)
      const e = 1 - Math.pow(1 - k, 3)
      const v = target.map((x, i) => start[i] + (x - start[i]) * e)
      // Remember where we are, so a new target mid-flight continues from here instead of jumping back.
      from.current = v
      setValue(v)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, duration])
  return value
}

/** `.enter` 자식의 등장 순서: style={stagger(i)} 이면 i × 60ms 늦게 떠오른다. */
export function stagger(i: number): CSSProperties {
  return { '--i': i } as CSSProperties
}
