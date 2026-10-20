import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { KIND_COLOR, KINDS, trimEnds, type GEdge, type GNode, type Graph } from '../../lib/agentGraph'
import { agentColor, initials } from '../../lib/agentColor'
import type { Selection } from '../../stores/interactions'

export interface SvgHandle {
  fit(): void
}

interface Props {
  graph: Graph
  selected: Selection | null
  animate: boolean
  onSelect(sel: Selection | null): void
  handle: { current: SvgHandle | null }
}

const press = (fn: () => void) => (e: KeyboardEvent): void => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    fn()
  }
}

/** One quadratic curve per edge; edges between the same two nodes are fanned out so they do not hide each other. */
function curves(graph: Graph): Map<string, { d: string; mx: number; my: number }> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const groups = new Map<string, GEdge[]>()
  for (const e of graph.edges) {
    const key = [e.from, e.to].sort().join('|')
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  const out = new Map<string, { d: string; mx: number; my: number }>()
  for (const list of groups.values()) {
    list.forEach((e, i) => {
      const a = byId.get(e.from)!
      const b = byId.get(e.to)!
      const t = trimEnds(a, b)
      const off = (i - (list.length - 1) / 2) * 22
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const nx = -(b.y - a.y) / len
      const ny = (b.x - a.x) / len
      const mx0 = (t.x1 + t.x2) / 2
      const my0 = (t.y1 + t.y2) / 2
      const cx = mx0 + nx * off * 2
      const cy = my0 + ny * off * 2
      out.set(e.id, { d: `M${t.x1.toFixed(1)} ${t.y1.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${t.x2.toFixed(1)} ${t.y2.toFixed(1)}`, mx: mx0 + nx * off, my: my0 + ny * off })
    })
  }
  return out
}

export function AgentGraphSvg({ graph, selected, animate, onSelect, handle }: Props) {
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const svg = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const { minX, minY, maxX, maxY } = graph.bounds
  const vbW = maxX - minX
  const vbH = maxY - minY
  const shapes = useMemo(() => curves(graph), [graph])

  useEffect(() => {
    handle.current = { fit: () => setView({ x: 0, y: 0, k: 1 }) }
    return () => {
      handle.current = null
    }
  }, [handle])

  const selEdge = selected?.type === 'edge' ? graph.edges.find((e) => e.id === selected.id) : undefined
  const hotEdge = (e: GEdge): boolean => (selEdge ? e.id === selEdge.id : selected ? e.from === selected.id || e.to === selected.id : true)
  const hotNode = (n: GNode): boolean => {
    if (selEdge) return n.id === selEdge.from || n.id === selEdge.to
    if (selected) return n.id === selected.id || graph.edges.some((e) => (e.from === selected.id && e.to === n.id) || (e.to === selected.id && e.from === n.id))
    return true
  }

  const scale = (): number => {
    const r = svg.current?.getBoundingClientRect()
    return r && r.width > 0 && r.height > 0 ? Math.min(r.width / vbW, r.height / vbH) : 1
  }
  const onDown = (e: PointerEvent<SVGSVGElement>): void => {
    if (e.target !== e.currentTarget) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
  }
  const onMove = (e: PointerEvent<SVGSVGElement>): void => {
    const d = drag.current
    if (!d) return
    const s = scale()
    setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x) / s, y: d.vy + (e.clientY - d.y) / s }))
  }
  const onUp = (e: PointerEvent<SVGSVGElement>): void => {
    if (drag.current && Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) < 3) onSelect(null)
    drag.current = null
  }
  const onWheel = (e: React.WheelEvent<SVGSVGElement>): void => {
    const f = e.deltaY < 0 ? 1.1 : 1 / 1.1
    setView((v) => ({ ...v, k: Math.min(3, Math.max(0.4, v.k * f)) }))
  }

  return (
    <svg
      ref={svg}
      className="ag-svg"
      viewBox={`${minX} ${minY} ${vbW} ${vbH}`}
      role="group"
      aria-label={`Agent interaction graph: ${graph.nodes.length} nodes, ${graph.edges.length} interactions`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onWheel={onWheel}
    >
      <defs>
        {KINDS.map((k) => (
          <marker key={k} id={`ag-arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill={KIND_COLOR[k]} />
          </marker>
        ))}
      </defs>
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        {graph.edges.map((e) => {
          const sh = shapes.get(e.id)
          if (!sh) return null
          const hot = hotEdge(e)
          const color = KIND_COLOR[e.kind]
          return (
            <g key={e.id} opacity={hot ? 1 : 0.3}>
              <path d={sh.d} fill="none" stroke={color} strokeWidth={hot ? 2 : 1.2} strokeDasharray={e.kind === 'delegate' ? '5 4' : undefined} markerEnd={e.kind === 'room' ? undefined : `url(#ag-arrow-${e.kind})`} />
              {e.active && animate && (
                <circle r="3.4" fill={color}>
                  <animateMotion dur="2.4s" repeatCount="indefinite" path={sh.d} />
                </circle>
              )}
              {e.active && !animate && <circle cx={sh.mx} cy={sh.my} r="3.4" fill={color} />}
            </g>
          )
        })}
        {graph.edges
          .filter((e) => e.label)
          .map((e) => {
            const sh = shapes.get(e.id)
            if (!sh) return null
            const text = e.label ?? ''
            const w = text.length * 6.4 + 12
            const pick = (): void => onSelect({ type: 'edge', id: e.id })
            return (
              <g
                key={`l-${e.id}`}
                className="ag-label"
                role="button"
                tabIndex={0}
                aria-label={`${e.kind}, ${e.from} to ${e.to}${e.label ? `, ${e.label}` : ''}`}
                aria-pressed={selected?.type === 'edge' && selected.id === e.id}
                opacity={hotEdge(e) ? 1 : 0.4}
                onClick={pick}
                onKeyDown={press(pick)}
              >
                <rect x={sh.mx - w / 2} y={sh.my - 9} width={w} height={18} rx={9} stroke={KIND_COLOR[e.kind]} fill={selected?.id === e.id ? '#44475a' : '#282a36'} />
                <text x={sh.mx} y={sh.my + 3.5} textAnchor="middle">
                  {text}
                </text>
              </g>
            )
          })}
        {graph.nodes.map((n) => {
          const pick = (): void => onSelect({ type: 'node', id: n.id })
          const color = n.kind === 'agent' ? agentColor(n.id) : n.kind === 'room' ? KIND_COLOR.room : n.kind === 'peer' ? KIND_COLOR.peer : KIND_COLOR.delegate
          const on = selected?.type === 'node' && selected.id === n.id
          const op = n.dim ? 0.45 : hotNode(n) ? 1 : 0.4
          return (
            <g key={n.id} className="ag-node" role="button" tabIndex={0} aria-label={`${n.kind === 'agent' ? 'agent' : n.kind === 'room' ? 'room' : n.kind === 'peer' ? 'remote agent' : 'subagent'} ${n.label}`} aria-pressed={on} opacity={op} onClick={pick} onKeyDown={press(pick)}>
              {on && <circle cx={n.x} cy={n.y} r={n.r + 5} fill="none" stroke="#f8f8f2" strokeWidth={2} />}
              {n.kind === 'room' ? (
                <rect x={n.x - n.r} y={n.y - n.r} width={n.r * 2} height={n.r * 2} rx={8} fill="#21222c" stroke={color} strokeWidth={2} />
              ) : n.kind === 'peer' ? (
                <polygon points={`${n.x},${n.y - n.r} ${n.x + n.r},${n.y} ${n.x},${n.y + n.r} ${n.x - n.r},${n.y}`} fill="#21222c" stroke={color} strokeWidth={1.5} strokeDasharray="4 2" />
              ) : n.kind === 'sub' ? (
                <circle cx={n.x} cy={n.y} r={n.r} fill={n.running ? `${color}55` : '#21222c'} stroke={color} strokeWidth={1.5} strokeDasharray="3 2" />
              ) : (
                <circle cx={n.x} cy={n.y} r={n.r} fill={`${color}26`} stroke={color} strokeWidth={2} />
              )}
              {n.kind === 'agent' && (
                <text x={n.x} y={n.y + 4} textAnchor="middle" fill={color} fontSize={n.r > 20 ? 12 : 10} fontWeight={700}>
                  {initials(n.label)}
                </text>
              )}
              {n.kind === 'room' && (
                <text x={n.x} y={n.y + 4} textAnchor="middle" fill={color} fontSize={11} fontWeight={700}>
                  #
                </text>
              )}
              <text x={n.x} y={n.y + n.r + 13} textAnchor="middle" fill="#a9b2d3" fontSize={10}>
                {n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}
              </text>
              {n.kind === 'peer' && (
                <text x={n.x} y={n.y + n.r + 24} textAnchor="middle" fill="#8b95bd" fontSize={8} letterSpacing="0.08em">
                  REMOTE
                </text>
              )}
              {n.kind === 'agent' && n.status && (
                <text x={n.x} y={n.y + n.r + 25} textAnchor="middle" fill={n.status === 'working' ? '#50fa7b' : '#8b95bd'} fontSize={9} letterSpacing="0.06em">
                  {n.status.toUpperCase()}
                </text>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}

