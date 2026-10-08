import { useEffect, useRef, useState } from 'react'

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** 숫자 배열을 이전 값에서 새 값으로 duration 동안 보간한다. 감소된 모션이면 즉시 바뀐다. */
export function useTween(target: number[], duration = 240): number[] {
  const [value, setValue] = useState(target)
  const from = useRef(target)
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
      setValue(v)
      if (k < 1) raf = requestAnimationFrame(step)
      else from.current = target
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, duration])
  return value
}
