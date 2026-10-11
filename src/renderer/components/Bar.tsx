export function Bar({ pct, color }: { pct: number; color: string }) {
  const w = Math.max(0, Math.min(100, pct))
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w)}>
      <i style={{ width: `${w}%`, background: color }} />
    </div>
  )
}
