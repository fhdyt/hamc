import type { KeyboardEvent } from 'react'
import { agentColor } from '../../lib/agentColor'
import { moneyLabel, niceTicks, type DayTotal } from '../../lib/usage'

const W = 640
const H = 220
const LEFT = 48
const RIGHT = 8
const TOP = 10
const BOTTOM = 24

export const dayLabel = (ts: number): string => new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

interface Props {
  days: DayTotal[]
  agents: string[]
  names: Record<string, string>
  /** The daily alert threshold, or null when the alert is off. */
  threshold: number | null
  pinned: number | null
  total: number
  onPin(day: number | null): void
}

/** Stacked bars per day and agent as plain SVG. Every day is also a button that pins it. */
export function CostChart({ days, agents, names, threshold, pinned, total, onPin }: Props) {
  const n = days.length
  const maxTotal = days.reduce((m, d) => Math.max(m, d.total), 0)
  const { max: yMax, ticks } = niceTicks(Math.max(maxTotal, threshold ?? 0))
  const pw = W - LEFT - RIGHT
  const ph = H - TOP - BOTTOM
  const slot = pw / Math.max(n, 1)
  const barW = Math.min(34, slot * 0.7)
  const y = (v: number): number => TOP + ph * (1 - v / yMax)
  const every = n > 20 ? 3 : n > 10 ? 2 : 1

  const onKey = (e: KeyboardEvent<SVGSVGElement>): void => {
    if (e.key === 'Escape' && pinned !== null) {
      e.stopPropagation()
      onPin(null)
    }
  }

  return (
    <svg
      className="us-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label={`Bar chart of daily cost in US dollars for ${n} days, total ${moneyLabel(total)}`}
      onKeyDown={onKey}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={LEFT} x2={W - RIGHT} y1={y(t)} y2={y(t)} stroke="#343746" strokeWidth={1} />
          <text x={LEFT - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="#8b95bd">
            {`$${t >= 100 ? Math.round(t) : t}`}
          </text>
        </g>
      ))}
      {days.map((d, i) => {
        const cx = LEFT + slot * i + slot / 2
        const over = threshold !== null && d.total > threshold
        let acc = 0
        const label = `${dayLabel(d.ts)}, ${moneyLabel(d.total, d.estimated)}${over ? ', over the alert threshold' : ''}`
        const detail = agents.filter((a) => (d.byAgent[a] ?? 0) > 0).map((a) => `${names[a] ?? a} ${moneyLabel(d.byAgent[a]!)}`).join(', ')
        return (
          <g key={d.index}>
            {agents.map((a) => {
              const v = d.byAgent[a] ?? 0
              if (v <= 0) return null
              const top = y(acc + v)
              const h = y(acc) - top
              acc += v
              return <rect key={a} x={cx - barW / 2} y={top} width={barW} height={Math.max(h, 0.5)} fill={agentColor(a)} />
            })}
            {(pinned === d.index || over) && (
              <rect x={cx - barW / 2 - 2} y={y(d.total) - 2} width={barW + 4} height={Math.max(y(0) - y(d.total) + 2, 4)} fill="none" stroke={pinned === d.index ? '#f8f8f2' : '#ffb86c'} strokeWidth={1.5} />
            )}
            <rect
              className="us-hit"
              role="button"
              tabIndex={0}
              aria-pressed={pinned === d.index}
              aria-label={label}
              x={LEFT + slot * i}
              y={TOP}
              width={slot}
              height={ph}
              fill="transparent"
              onClick={() => onPin(d.index)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onPin(d.index)
                }
              }}
            >
              <title>{detail ? `${label}: ${detail}` : label}</title>
            </rect>
            {i % every === 0 && (
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill="#a9b2d3">
                {n <= 14 && (i === 0 || new Date(d.ts * 1000).getDate() === 1) ? dayLabel(d.ts) : new Date(d.ts * 1000).getDate()}
              </text>
            )}
          </g>
        )
      })}
      {threshold !== null && (
        <g>
          <line x1={LEFT} x2={W - RIGHT} y1={y(threshold)} y2={y(threshold)} stroke="#ffb86c" strokeWidth={1.2} strokeDasharray="5 4" />
          <text x={W - RIGHT - 2} y={y(threshold) - 4} textAnchor="end" fontSize={10} fill="#ffb86c">
            {`alert ${moneyLabel(threshold)}`}
          </text>
        </g>
      )}
    </svg>
  )
}
