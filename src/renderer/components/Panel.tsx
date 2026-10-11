import type { ReactNode } from 'react'

interface Props {
  title: ReactNode
  label?: string
  tone?: 'default' | 'hi' | 'warn' | 'bad'
  /** `frame` puts the title on the border (┤ title ├); `card` is the rounded dashboard panel with a header row. */
  variant?: 'frame' | 'card'
  actions?: ReactNode
  flush?: boolean
  className?: string
  children?: ReactNode
}

export function Panel({ title, label, tone = 'default', variant = 'frame', actions, flush, className = '', children }: Props) {
  const aria = label ?? (typeof title === 'string' ? title : undefined)
  if (variant === 'card') {
    return (
      <section className={['card', className].filter(Boolean).join(' ')} aria-label={aria}>
        <div className="ph">
          <h2>{title}</h2>
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
