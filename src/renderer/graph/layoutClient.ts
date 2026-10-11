import type { Graph } from '../lib/brain/graphModel'
import type { Forces, FromWorker, ToWorker } from './layoutTypes'

/**
 * Runs the force layout in a worker and keeps node positions by id, so a graph that changes a little
 * (a note appears, a filter toggles) continues from where it was instead of shaking up.
 */
export class LayoutClient {
  private worker: Worker
  private ids: string[] = []
  private last = new Map<string, [number, number]>()
  private forces: Forces
  onTick: (pos: Float32Array, alpha: number) => void = () => {}
  onSettled: () => void = () => {}

  constructor(forces: Forces) {
    this.forces = forces
    this.worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (ev: MessageEvent<FromWorker>): void => {
      const m = ev.data
      if (m.type === 'tick') {
        for (let i = 0; i < this.ids.length; i++) this.last.set(this.ids[i]!, [m.pos[i * 2]!, m.pos[i * 2 + 1]!])
        this.onTick(m.pos, m.alpha)
      } else this.onSettled()
    }
  }

  private send(m: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(m, transfer)
  }

  /** Positions for the current graph from what was known, with new nodes placed next to a neighbour. */
  initialPositions(g: Graph): { pos: Float32Array; known: number } {
    const n = g.nodes.length
    const pos = new Float32Array(n * 2).fill(NaN)
    let known = 0
    for (let i = 0; i < n; i++) {
      const p = this.last.get(g.nodes[i]!.id)
      if (p) {
        pos[i * 2] = p[0]
        pos[i * 2 + 1] = p[1]
        known++
      }
    }
    const spread = Math.sqrt(n) * 14 + 40
    const nb: number[][] = g.nodes.map(() => [])
    for (const e of g.edges) {
      nb[e.s]!.push(e.t)
      nb[e.t]!.push(e.s)
    }
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(pos[i * 2]!)) continue
      const anchor = nb[i]!.find((j) => !Number.isNaN(pos[j * 2]!))
      const jitter = (): number => (Math.random() - 0.5) * 24
      if (anchor !== undefined) {
        pos[i * 2] = pos[anchor * 2]! + jitter()
        pos[i * 2 + 1] = pos[anchor * 2 + 1]! + jitter()
      } else {
        const a = Math.random() * Math.PI * 2
        const r = Math.sqrt(Math.random()) * spread
        pos[i * 2] = Math.cos(a) * r
        pos[i * 2 + 1] = Math.sin(a) * r
      }
    }
    return { pos, known }
  }

  setGraph(g: Graph): Float32Array {
    this.ids = g.nodes.map((n) => n.id)
    const { pos, known } = this.initialPositions(g)
    const edges = new Int32Array(g.edges.length * 2)
    g.edges.forEach((e, i) => {
      edges[i * 2] = e.s
      edges[i * 2 + 1] = e.t
    })
    // most nodes already placed: only a gentle settling; a fresh graph starts hot
    const alpha = known === 0 ? 1 : known >= g.nodes.length ? 0.2 : 0.35
    this.send({ type: 'set', pos: pos.slice(), edges, forces: this.forces, alpha }, [])
    return pos
  }

  setForces(forces: Forces): void {
    this.forces = forces
    this.send({ type: 'forces', forces })
  }

  drag(i: number, x: number, y: number): void {
    this.send({ type: 'drag', i, x, y })
  }

  release(i: number): void {
    this.send({ type: 'release', i })
  }

  reheat(alpha = 0.6): void {
    this.send({ type: 'reheat', alpha })
  }

  destroy(): void {
    this.worker.terminate()
  }
}
