import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

const FOCUSABLE = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'

export function Modal({ title, onClose, width = 560, children }: { title: string; onClose: () => void; width?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const el = ref.current!
    const prev = document.activeElement as HTMLElement | null
    const focusables = (): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => !x.hasAttribute('disabled'))
    ;(focusables()[0] ?? el).focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      } else if (e.key === 'Tab') {
        const f = focusables()
        if (f.length === 0) return
        const first = f[0]!
        const last = f[f.length - 1]!
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    el.addEventListener('keydown', onKey)
    // Content that re-renders can drop the focused element; Escape must still close the topmost dialog.
    const onDocKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const all = document.querySelectorAll('.mc-modal')
      if (all[all.length - 1] === el) closeRef.current()
    }
    document.addEventListener('keydown', onDocKey)
    return () => {
      el.removeEventListener('keydown', onKey)
      document.removeEventListener('keydown', onDocKey)
      prev?.focus()
    }
  }, [])

  return (
    <div className="mc-modal-bk" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="mc-modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} style={{ maxWidth: width }}>
        <div className="mc-modal-head">
          <h2>{title}</h2>
          <button type="button" className="ib sm" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="mc-modal-body">{children}</div>
      </div>
    </div>
  )
}
