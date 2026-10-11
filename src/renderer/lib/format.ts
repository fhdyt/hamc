export function formatBytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? Math.round(v) : v.toFixed(digits)} ${units[i]}`
}

export function formatRate(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let v = bps
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  const text = i === 0 || v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  return `${text} ${units[i]}`
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

export function formatUptime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${pad2(h)}h`
  if (h > 0) return `${h}h ${pad2(m)}m`
  if (m > 0) return `${m}m ${pad2(s % 60)}s`
  return `${s}s`
}

export function formatAge(sec: number): string {
  if (sec < 1) return 'just now'
  if (sec < 60) return `${Math.floor(sec)}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

export const formatPct = (n: number): string => `${Math.round(n)}%`

export function loadColor(pct: number): string {
  return pct < 50 ? '#50FA7B' : pct < 80 ? '#FFB86C' : '#FF5555'
}

export function textBar(pct: number, width: number): string {
  const n = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return '■'.repeat(n) + '·'.repeat(width - n)
}
