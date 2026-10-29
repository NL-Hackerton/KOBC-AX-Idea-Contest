import type { CSSProperties } from 'react'

/**
 * Figma icon asset drawn in the current text color.
 * The SVG file is used unchanged as a CSS mask, so one asset serves light, dark, active and idle states.
 */
export default function Icon({ src, size = 18, className = '' }: { src: string; size?: number; className?: string }) {
  const style = { '--icon': `url("${src}")`, width: size, height: size } as CSSProperties
  return <span className={`icon ${className}`} style={style} aria-hidden />
}
