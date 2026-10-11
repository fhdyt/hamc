import { radiiOf, type Graph } from '../lib/brain/graphModel'
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
    __mcBrainStats?: () => EngineStats
    __mcBrainLabels?: () => string[]
    __mcBrainNodes?: () => { id: string; x: number; y: number; wx: number; wy: number; wr: number }[]
  }
}

/** Ties the layout worker to the Pixi renderer and keeps both in step. */
export class GraphEngine {
  private ticks = 0
  private settled = false
  private started = 0
  private settleMs: number | null = null
  private nodes = 0
  private autoFit = false
  private graph: Graph | null = null
  private nodeSize = 1
  private lastFit = 0
  private edges = 0

  private constructor(
    private readonly renderer: GraphRenderer,
    private readonly layout: LayoutClient
  ) {
    layout.onTick = (pos) => {
      this.ticks++
      this.settled = false
      renderer.setPositions(pos)
      // keep a fresh layout framed while it unfolds, until the reader takes over the camera
      const now = performance.now()
      if (this.autoFit && !renderer.userMoved && now - this.lastFit > 250) {
        this.lastFit = now
        renderer.fit()
      }
    }
    layout.onSettled = () => {
      this.settled = true
      if (this.autoFit && !renderer.userMoved) renderer.fit()
      this.autoFit = false
      if (this.settleMs === null) this.settleMs = performance.now() - this.started
    }
    renderer.setSink(layout)
    window.__mcBrainNodes = () => renderer.screenPositions()
    window.__mcBrainLabels = () => renderer.visibleLabels()
    window.__mcBrainStats = () => this.stats()
  }

  static async create(host: HTMLElement, forces: Forces, handlers: RendererHandlers, opts: RendererOptions = {}): Promise<GraphEngine> {
    const renderer = await GraphRenderer.create(host, handlers, opts)
    return new GraphEngine(renderer, new LayoutClient(forces))
  }

  setGraph(g: Graph): void {
    this.started = performance.now()
    this.settleMs = null
    if (this.nodes === 0 && g.nodes.length > 0) this.autoFit = true // the first graph is framed as it unfolds
    this.nodes = g.nodes.length
    this.edges = g.edges.length
    this.graph = g
    const pos = this.layout.setGraph(g, radiiOf(g.nodes, this.nodeSize))
    this.renderer.setGraph(g, pos)
  }

  setStyle(s: GraphStyle): void {
    if (s.nodeSize !== this.nodeSize) {
      this.nodeSize = s.nodeSize
      if (this.graph) this.layout.setRadii(radiiOf(this.graph.nodes, s.nodeSize))
    }
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
    delete window.__mcBrainNodes
    delete window.__mcBrainLabels
  }
}
