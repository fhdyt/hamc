import type { ReactNode } from 'react'

interface Props {
  title: ReactNode
  label?: string
  tone?: 'default' | 'hi' | 'warn' | 'bad'
  flush?: boolean
  className?: string
  children?: ReactNode
}

export function Panel({ title, label, tone = 'default', flush, className = '', children }: Props) {
  const cls = ['pnl', tone === 'default' ? '' : tone, flush ? 'flush' : '', className].filter(Boolean).join(' ')
  return (
    <section className={cls} aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
      <h2 className="pt">┤ {title} ├</h2>
      {children}
    </section>
  )
}
