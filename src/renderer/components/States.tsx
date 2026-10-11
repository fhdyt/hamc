import type { ReactNode } from 'react'
import { formatAge } from '../lib/format'
import { Icon } from './Icon'

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skel" style={{ width: `${95 - ((i * 13) % 40)}%` }} />
      ))}
    </div>
  )
}

export function EmptyState({ title, why, children }: { title: string; why?: string; children?: ReactNode }) {
  return (
    <div className="state" role="status">
      <strong>{title}</strong>
      {why && <span className="why">{why}</span>}
      {children}
    </div>
  )
}

export function UnsupportedState({ title = 'Coming in a later release', why }: { title?: string; why?: string }) {
  return (
    <div className="state" role="status">
      <Icon name="lock" size={18} />
      <strong>{title}</strong>
      {why && <span className="why">{why}</span>}
    </div>
  )
}

export function ErrorState({ title, why, onRetry }: { title: string; why?: string; onRetry?: () => void }) {
  return (
    <div className="state" role="alert">
      <strong style={{ color: '#FF5555' }}>{title}</strong>
      {why && <span className="why">{why}</span>}
      {onRetry && (
        <button type="button" className="cb" onClick={onRetry}>
          <Icon name="refresh" size={12} /> Retry
        </button>
      )}
    </div>
  )
}

export function StaleBanner({ receivedAt, now, label }: { receivedAt: number; now: number; label: string }) {
  return (
    <div className="banner" role="status">
      <Icon name="clock" size={12} />
      {label} · last update {formatAge(Math.max(0, (now - receivedAt) / 1000))}
    </div>
  )
}
