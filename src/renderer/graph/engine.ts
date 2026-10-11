import type { Graph } from '../lib/brain/graphModel'
import { LayoutClient } from './layoutClient'
import type { Forces } from './layoutTypes'
import { GraphRenderer, type GraphStyle, type RendererHandlers, type RendererOptions } from './renderer'

export interface EngineStats {
  frames: number
  ticks: number
  settled: boolean
  nodes: number
  edges: number
  /** Milliseconds from setGraph until the layout first settled. */
  settleMs: number | null
}

declare global {
  interface Window {
    __mcBrainStats?: EngineStats
  }
}

/** Ties the layout worker to the Pixi renderer and keeps both in step. */
export class GraphEngine {
  private ticks = 0
  private settled = false
  private started = 0
  private settleMs: number | null = null
  private nodes = 0
  private edges = 0

  private constructor(
    private readonly renderer: GraphRenderer,
    private readonly layout: LayoutClient
  ) {
    layout.onTick = (pos) => {
      this.ticks++
      this.settled = false
      renderer.setPositions(pos)
      this.publish()
    }
    layout.onSettled = () => {
      this.settled = true
      if (this.settleMs === null) this.settleMs = performance.now() - this.started
      this.publish()
    }
    renderer.setSink(layout)
  }

  static async create(host: HTMLElement, forces: Forces, handlers: RendererHandlers, opts: RendererOptions = {}): Promise<GraphEngine> {
    const renderer = await GraphRenderer.create(host, handlers, opts)
    return new GraphEngine(renderer, new LayoutClient(forces))
  }

  private publish(): void {
    window.__mcBrainStats = { frames: this.renderer.frames, ticks: this.ticks, settled: this.settled, nodes: this.nodes, edges: this.edges, settleMs: this.settleMs }
  }

  setGraph(g: Graph): void {
    this.started = performance.now()
    this.settleMs = null
    this.nodes = g.nodes.length
    this.edges = g.edges.length
    const pos = this.layout.setGraph(g)
    this.renderer.setGraph(g, pos)
    this.publish()
  }

  setStyle(s: GraphStyle): void {
    this.renderer.setStyle(s)
  }

  setForces(f: Forces): void {
    this.layout.setForces(f)
  }

  setHovered(id: string | null): void {
    this.renderer.setHovered(id)
  }

  setSelected(id: string | null): void {
    this.renderer.setSelected(id)
  }

  pulse(ids: readonly string[]): void {
    this.renderer.pulse(ids)
  }

  fit(): void {
    this.renderer.fit()
  }

  stats(): EngineStats {
    return { frames: this.renderer.frames, ticks: this.ticks, settled: this.settled, nodes: this.nodes, edges: this.edges, settleMs: this.settleMs }
  }

  destroy(): void {
    this.layout.destroy()
    this.renderer.destroy()
    delete window.__mcBrainStats
  }
}
