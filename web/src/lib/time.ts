// 모든 시각은 브라우저 시간대와 무관하게 KST(UTC+9)로 표시한다.
const KST_OFFSET_MS = 9 * 3600 * 1000

function kstParts(iso: string | number | Date) {
  const t = typeof iso === 'number' ? iso : new Date(iso).getTime()
  const d = new Date(t + KST_OFFSET_MS)
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }
}

const p2 = (n: number) => String(n).padStart(2, '0')

export const ms = (iso: string) => new Date(iso).getTime()
export const hoursBetween = (a: string, b: string) => (ms(b) - ms(a)) / 3600000
export const addHours = (iso: string, h: number) => ms(iso) + h * 3600000

/** 9/1 07:35 */
export function fmtDT(iso: string | number | null | undefined): string {
  if (iso == null) return '-'
  const k = kstParts(iso)
  return `${k.mo}/${k.d} ${p2(k.h)}:${p2(k.mi)}`
}

/** 07:35 */
export function fmtT(iso: string | number): string {
  const k = kstParts(iso)
  return `${p2(k.h)}:${p2(k.mi)}`
}

/** 9/1 */
export function fmtD(iso: string | number): string {
  const k = kstParts(iso)
  return `${k.mo}/${k.d}`
}

export function kstHour(iso: string | number): number {
  return kstParts(iso).h
}

/** datetime-local 입력값 (KST) */
export function toLocalInput(iso: string | number): string {
  const k = kstParts(iso)
  return `${k.y}-${p2(k.mo)}-${p2(k.d)}T${p2(k.h)}:${p2(k.mi)}`
}

export function fromLocalInput(v: string): string {
  return `${v}:00+09:00`
}
