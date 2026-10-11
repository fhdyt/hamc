import type { CSSProperties, ReactNode } from 'react'

interface Props {
  title: ReactNode
  label?: string
  tone?: 'default' | 'hi' | 'warn' | 'bad'
  /** `frame` puts the title on the border (┤ title ├); `card` is the rounded dashboard panel with a header row. */
  variant?: 'frame' | 'card'
  actions?: ReactNode
  /** Small muted text next to the title (a count, a host line). */
  meta?: ReactNode
  /** Replaces the title text with custom content, such as tabs. */
  head?: ReactNode
  style?: CSSProperties
  flush?: boolean
  className?: string
  children?: ReactNode
}

export function Panel({ title, label, tone = 'default', variant = 'frame', actions, meta, head, style, flush, className = '', children }: Props) {
  const aria = label ?? (typeof title === 'string' ? title : undefined)
  if (variant === 'card') {
    return (
      <section className={['card', className].filter(Boolean).join(' ')} aria-label={aria} style={style}>
        <div className="ph">
          {head ?? <h2>{title}</h2>}
          {meta && <span className="ph-meta">{meta}</span>}
          {actions && <span className="ph-actions">{actions}</span>}
        </div>
        {children}
      </section>
    )
  }
  const cls = ['pnl', tone === 'default' ? '' : tone, flush ? 'flush' : '', className].filter(Boolean).join(' ')
  return (
    <section className={cls} aria-label={aria}>
      <h2 className="pt">┤ {title} ├</h2>
      {children}
    </section>
  )
}
