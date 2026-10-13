import type { ReactNode } from 'react'

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" className="sw" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 40 }}>
      <div style={{ flex: 1 }}>
        <div>{label}</div>
        {hint && <div style={{ color: '#8B95BD', fontSize: 11 }}>{hint}</div>}
      </div>
      {children}
    </div>
  )
}
