import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

interface Props {
  orientation: 'vertical' | 'horizontal'
  value: number
  min: number
  max: number
  label: string
  /** Called with the new size while dragging and on arrow keys. */
  onChange(v: number): void
  /** Called once when a drag ends, so the size can be saved. */
  onCommit?(v: number): void
  /** Dragging towards the start (left or up) makes the controlled panel bigger, as for a panel on the right. */
  invert?: boolean
}

const STEP = 24
const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, Math.round(v)))

/** A draggable divider that is also a keyboard separator (arrow keys), as in the mockup. */
export function Resizer({ orientation, value, min, max, label, onChange, onCommit, invert }: Props) {
  const drag = useRef<{ start: number; value: number; last: number } | null>(null)
  const vertical = orientation === 'vertical'

  const down = (e: PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const start = vertical ? e.clientX : e.clientY
    drag.current = { start, value, last: value }
  }
  const move = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const pos = vertical ? e.clientX : e.clientY
    const delta = (pos - d.start) * (invert ? -1 : 1)
    const next = clamp(d.value + delta, min, max)
    d.last = next
    onChange(next)
  }
  const up = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (d) onCommit?.(d.last)
  }
  const key = (e: KeyboardEvent<HTMLDivElement>): void => {
    const grow = vertical ? (invert ? 'ArrowLeft' : 'ArrowRight') : invert ? 'ArrowUp' : 'ArrowDown'
    const shrink = vertical ? (invert ? 'ArrowRight' : 'ArrowLeft') : invert ? 'ArrowDown' : 'ArrowUp'
    if (e.key !== grow && e.key !== shrink) return
    e.preventDefault()
    const next = clamp(value + (e.key === grow ? STEP : -STEP), min, max)
    onChange(next)
    onCommit?.(next)
  }

  return (
    <div
      className={`rz ${vertical ? 'rz-v' : 'rz-h'}`}
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title="Drag to resize"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    >
      <span />
    </div>
  )
}
