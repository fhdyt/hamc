import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { Graph } from '../lib/brain/graphModel'
import { GraphEngine } from './engine'
import type { Forces } from './layoutTypes'
import type { GraphStyle } from './renderer'

interface Props {
  graph: Graph
  style: GraphStyle
  forces: Forces
  hovered: string | null
  selected: string | null
  pulse: { ids: string[]; seq: number }
  mini?: boolean
  onHover(id: string | null): void
  onSelect(id: string | null): void
  /** Gives the parent a handle for actions such as "fit all nodes". */
  engineRef?: MutableRefObject<GraphEngine | null>
}

export function BrainCanvas({ graph, style, forces, hovered, selected, pulse, mini, onHover, onSelect, engineRef }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<GraphEngine | null>(null)
  const hoverCb = useRef(onHover)
  const selectCb = useRef(onSelect)
  hoverCb.current = onHover
  selectCb.current = onSelect
  const initialForces = useRef(forces)
  const lastPulse = useRef(pulse.seq)

  useEffect(() => {
    let dead = false
    let made: GraphEngine | null = null
    void GraphEngine.create(
      host.current!,
      initialForces.current,
      { onHover: (id) => hoverCb.current(id), onSelect: (id) => selectCb.current(id) },
      { mini }
    ).then((e) => {
      if (dead) e.destroy()
      else {
        made = e
        if (engineRef) engineRef.current = e
        setEngine(e)
      }
    })
    return () => {
      dead = true
      made?.destroy()
      if (engineRef) engineRef.current = null
      setEngine(null)
    }
  }, [mini, engineRef])

  useEffect(() => engine?.setStyle(style), [engine, style])
  useEffect(() => engine?.setGraph(graph), [engine, graph])
  useEffect(() => engine?.setForces(forces), [engine, forces])
  useEffect(() => engine?.setHovered(hovered), [engine, hovered, graph])
  useEffect(() => engine?.setSelected(selected), [engine, selected, graph])
  useEffect(() => {
    if (engine && pulse.seq !== lastPulse.current) engine.pulse(pulse.ids)
    lastPulse.current = pulse.seq
  }, [engine, pulse])

  return <div ref={host} className="brain-canvas" role="img" aria-label="Graph of the notes and their links" />
}
