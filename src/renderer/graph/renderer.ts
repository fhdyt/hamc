import 'pixi.js/unsafe-eval'
import { Application, Container, Graphics, Mesh, MeshGeometry, Sprite, Text, Texture } from 'pixi.js'
import { quadtree, type Quadtree } from 'd3-quadtree'
import { densityScale, neighbours, reachOf, somaRadius, type GNode, type Graph } from '../lib/brain/graphModel'

export interface GraphStyle {
  nodeSize: number
  linkWidth: number
  /** Show the synapse dot at the end of every link even when zoomed out. */
  arrows: boolean
  /** 0..1, higher means labels only show when zoomed in further. */
  labelFade: number
  groupColors: readonly string[]
  /** Idle neurons fire now and then; off when the reader asked for reduced motion. */
  motion: boolean
}

export interface RendererHandlers {
  onHover(id: string | null, at?: { x: number; y: number }): void
  onSelect(id: string | null): void
}

export interface RendererOptions {
  /** Compact mode for the Dashboard: no hub labels and no node dragging. */
  mini?: boolean
}

export interface DragSink {
  drag(i: number, x: number, y: number): void
  release(i: number): void
}

const NEUTRAL = { note: 0xa9b2d3, ghost: 0x6b7089, tag: 0x50fa7b, attachment: 0xffb86c }
const WHITE = 0xffffff
const ACCENT = 0xbd93f9
const MAX_LABELS = 60
const TEX = 32
const GLOW = 128
const MIN_K = 0.02
const MAX_K = 10
const PULSE_MS = 1400
const SEGMENTS = 3 // segments per half of a link
const MAX_ARBORS = 260
const MAX_SIGNALS = 260
const MAX_SYNAPSES = 700
const RECENT_S = 3600
const FRAME_MS = 33

const hex = (s: string): number => parseInt(s.replace('#', ''), 16)
const css = (c: number, a: number): string => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
const rng = (seed: number) => (): number => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296

interface Ring {
  i: number
  t0: number
  g: Graphics
}

interface Signal {
  e: number
  from: number
  t: number
  sp: number
  hops: number
}

interface Bucket {
  color: number
  entries: Int32Array
  mesh: Mesh
}

type Seg = [number, number, number, number]

export class GraphRenderer {
  private app!: Application
  private world = new Container()
  private labelLayer = new Container()
  private edgeLayer = new Container()
  private synGfx = new Graphics()
  private signalLayer = new Container()
  private arborLayer = new Container()
  private glowLayer = new Container()
  private discLayer = new Container()
  private coreLayer = new Container()
  private hiLines = new Graphics()
  private recentGfx = new Graphics()
  private ringLayer = new Container()
  private selRing = new Graphics()
  private buckets: Bucket[] = []
  private glows: Sprite[] = []
  private discs: Sprite[] = []
  private cores: Sprite[] = []
  private sigSprites: Sprite[] = []
  private labels: Text[] = []
  private rings: Ring[] = []
  private arbors = new Map<number, Graphics>()
  private glowTex = new Map<number, Texture>()
  private tex!: Texture
  private graph: Graph = { nodes: [], edges: [], index: new Map() }
  private nb: number[][] = []
  private adjE: number[][] = []
  private order: number[] = []
  private recent: number[] = []
  private pos: Float32Array = new Float32Array(0)
  private ctrl: Float32Array = new Float32Array(0)
  private curv: Float32Array = new Float32Array(0)
  private fireV: Float32Array = new Float32Array(0)
  private signals: Signal[] = []
  private cam = { x: 0, y: 0, k: 1 }
  private style: GraphStyle = { nodeSize: 1, linkWidth: 1, arrows: false, labelFade: 0.5, groupColors: [], motion: true }
  private density = 1
  private edgeAlpha = 0.5
  private hover = -1
  private selected = -1
  private hoverSet = new Set<number>()
  private dirtyPos = true
  private dirtyCam = true
  private dirtyStyle = true
  private dirtyHi = true
  private colorKey = ''
  private scheduled = 0
  private lastFrame = 0
  private ambientT = 1
  private tree: Quadtree<number> | null = null
  private treeStale = true
  private mode: { kind: 'none' } | { kind: 'pan'; x: number; y: number; moved: number } | { kind: 'node'; i: number; x: number; y: number; moved: number } = { kind: 'none' }
  private destroyed = false
  private sink: DragSink | null = null
  private cleanups: (() => void)[] = []
  frames = 0
  /** True once the reader panned or zoomed; automatic framing then stops. */
  userMoved = false

  private constructor(
    private readonly host: HTMLElement,
    private readonly h: RendererHandlers,
    private readonly opts: RendererOptions
  ) {}

  static async create(host: HTMLElement, h: RendererHandlers, opts: RendererOptions = {}): Promise<GraphRenderer> {
    const r = new GraphRenderer(host, h, opts)
    await r.init()
    return r
  }

  private async init(): Promise<void> {
    const app = new Application()
    await app.init({ resizeTo: this.host, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1, autoStart: false, preference: 'webgl' })
    if (this.destroyed) {
      app.destroy(true, { children: true, texture: true })
      return
    }
    this.app = app
    app.ticker.stop()
    this.host.appendChild(app.canvas)
    app.canvas.style.display = 'block'
    app.canvas.style.touchAction = 'none'
    const g = new Graphics().circle(TEX / 2, TEX / 2, TEX / 2).fill(0xffffff)
    this.tex = app.renderer.generateTexture({ target: g, resolution: 2 })
    g.destroy()
    for (const l of [this.edgeLayer, this.synGfx, this.signalLayer, this.arborLayer, this.glowLayer, this.discLayer, this.coreLayer, this.hiLines, this.recentGfx, this.ringLayer, this.selRing]) this.world.addChild(l)
    app.stage.addChild(this.world)
    app.stage.addChild(this.labelLayer)
    this.bindEvents(app.canvas)
    // Pixi's own `resizeTo` only follows the window, so follow the container ourselves (panels opening and closing resize it).
    const ro = new ResizeObserver(() => {
      if (this.destroyed) return
      const { w, h } = this.size
      this.app.renderer.resize(w, h)
      this.dirtyCam = true
      this.request()
    })
    ro.observe(this.host)
    this.cleanups.push(() => ro.disconnect())
    this.request()
  }

  setSink(s: DragSink): void {
    this.sink = s
  }

  get size(): { w: number; h: number } {
    return { w: this.host.clientWidth || 1, h: this.host.clientHeight || 1 }
  }

  // ---- data ---------------------------------------------------------------

  setGraph(g: Graph, pos: Float32Array): void {
    if (this.destroyed || !this.app) return
    const first = this.graph.nodes.length === 0
    this.graph = g
    this.pos = pos
    this.nb = neighbours(g)
    this.adjE = g.nodes.map(() => [])
    g.edges.forEach((e, i) => {
      this.adjE[e.s]!.push(i)
      this.adjE[e.t]!.push(i)
    })
    this.density = densityScale(g.nodes.length)
    this.edgeAlpha = clamp(0.62 - 0.12 * Math.log10(Math.max(10, g.edges.length)), 0.2, 0.55)
    this.order = g.nodes.map((_, i) => i).sort((a, b) => g.nodes[b]!.degree - g.nodes[a]!.degree)
    this.fireV = new Float32Array(g.nodes.length)
    this.signals = []
    const nowS = Date.now() / 1000
    this.recent = g.nodes.map((n, i) => (n.kind === 'note' && n.mtime > 0 && nowS - n.mtime < RECENT_S ? i : -1)).filter((i) => i >= 0).slice(0, 80)
    this.curv = Float32Array.from(g.edges, (e) => {
      const h = Math.imul(e.s + 1, 73856093) ^ Math.imul(e.t + 1, 19349663)
      return (((h >>> 0) % 1000) / 1000 - 0.5) * 0.5
    })
    this.ctrl = new Float32Array(g.edges.length * 6)
    this.ensurePools(g.nodes.length)
    this.hover = this.selected = -1
    this.hoverSet.clear()
    this.treeStale = true
    for (const r of this.rings) r.g.destroy()
    this.rings = []
    this.clearArbors()
    this.rebuildBuckets()
    this.dirtyPos = this.dirtyStyle = this.dirtyCam = this.dirtyHi = true
    if (first) this.fit()
    this.request()
  }

  setPositions(pos: Float32Array): void {
    if (pos.length !== this.pos.length) return
    this.pos = pos
    this.dirtyPos = true
    this.treeStale = true
    this.request()
  }

  setStyle(s: GraphStyle): void {
    const key = s.groupColors.join(',')
    this.style = s
    this.dirtyStyle = true
    if (key !== this.colorKey) {
      this.colorKey = key
      this.clearArbors()
      this.rebuildBuckets()
    }
    this.request()
  }

  setHovered(id: string | null): void {
    const i = id === null ? -1 : (this.graph.index.get(id) ?? -1)
    if (i === this.hover) return
    this.hover = i
    this.hoverSet = new Set(i >= 0 ? [i, ...this.nb[i]!] : [])
    this.dirtyHi = true
    this.request()
  }

  setSelected(id: string | null): void {
    const i = id === null ? -1 : (this.graph.index.get(id) ?? -1)
    if (i === this.selected) return
    this.selected = i
    this.dirtyHi = true
    this.request()
  }

  /** Notes that just appeared or changed: their neurons fire and a ring spreads out. */
  pulse(ids: readonly string[]): void {
    const now = performance.now()
    for (const id of ids.slice(0, 40)) {
      const i = this.graph.index.get(id)
      if (i === undefined) continue
      this.fire(i, 3)
      const g = new Graphics()
      this.ringLayer.addChild(g)
      this.rings.push({ i, t0: now, g })
    }
    while (this.rings.length > 60) this.rings.shift()!.g.destroy()
    this.request()
  }

  /** Makes a neuron fire and sends signals along some of its links. Without an id a well connected one is picked. */
  fire(id?: number, hops = 5): void {
    const nodes = this.graph.nodes
    if (nodes.length === 0) return
    let i = id ?? -1
    if (i < 0) {
      const pool = nodes.map((n, k) => (n.degree > 3 ? k : -1)).filter((k) => k >= 0)
      const from = pool.length ? pool : nodes.map((_, k) => k)
      i = from[Math.floor(Math.random() * from.length)]!
    }
    this.fireV[i] = 1
    const es = this.adjE[i]!.slice().sort(() => Math.random() - 0.5).slice(0, 4)
    for (const e of es) if (this.signals.length < MAX_SIGNALS) this.signals.push({ e, from: i, t: 0, sp: 0.55 + Math.random() * 0.4, hops: hops - 1 })
    this.request()
  }

  /** Frames the bulk of the graph (2nd to 98th percentile, so a few far-away neurons do not shrink everything). */
  fit(): void {
    const n = this.graph.nodes.length
    if (n === 0 || !this.app) return
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < n; i++) {
      xs.push(this.pos[i * 2]!)
      ys.push(this.pos[i * 2 + 1]!)
    }
    xs.sort((a, b) => a - b)
    ys.sort((a, b) => a - b)
    const q = (a: number[], p: number): number => a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))]!
    const lo = n > 50 ? 0.02 : 0
    const margin = reachOf(4, this.style.nodeSize * this.density) * 0.7
    const x0 = q(xs, lo) - margin
    const x1 = q(xs, 1 - lo) + margin
    const y0 = q(ys, lo) - margin
    const y1 = q(ys, 1 - lo) + margin
    const { w, h } = this.size
    const k = Math.min(w / Math.max(40, x1 - x0), h / Math.max(40, y1 - y0), 2.5) * 0.94
    this.cam = { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k }
    this.dirtyCam = true
    this.request()
  }

  /** Node centres in canvas pixels and world units; used by the end-to-end tests to click on nodes. */
  screenPositions(): { id: string; x: number; y: number; wx: number; wy: number; wr: number }[] {
    return this.graph.nodes.map((n, i) => ({
      id: n.id,
      x: this.pos[i * 2]! * this.cam.k + this.cam.x,
      y: this.pos[i * 2 + 1]! * this.cam.k + this.cam.y,
      wx: this.pos[i * 2]!,
      wy: this.pos[i * 2 + 1]!,
      wr: this.somaOf(i)
    }))
  }

  /** The texts of the labels that are on screen; used by the end-to-end tests. */
  visibleLabels(): string[] {
    return this.labels.filter((t) => t.visible && t.alpha > 0).map((t) => t.text)
  }

  /** How many signals are travelling and how many neurons are lit; used by the end-to-end tests. */
  activity(): { signals: number; lit: number } {
    let lit = 0
    for (const v of this.fireV) if (v > 0.05) lit++
    return { signals: this.signals.length, lit }
  }

  // ---- geometry helpers ---------------------------------------------------

  private scale(): number {
    return this.style.nodeSize * this.density
  }

  private somaOf(i: number): number {
    return somaRadius(this.graph.nodes[i]!.degree, this.scale())
  }

  private colorOf(n: GNode): number {
    if (n.group >= 0 && this.style.groupColors[n.group]) return hex(this.style.groupColors[n.group]!)
    return NEUTRAL[n.kind]
  }

  private glowTexture(color: number): Texture {
    let t = this.glowTex.get(color)
    if (t) return t
    const c = document.createElement('canvas')
    c.width = c.height = GLOW
    const g = c.getContext('2d')!
    const gr = g.createRadialGradient(GLOW / 2, GLOW / 2, 0, GLOW / 2, GLOW / 2, GLOW / 2)
    gr.addColorStop(0, 'rgba(255,255,255,1)')
    gr.addColorStop(0.16, css(color, 0.95))
    gr.addColorStop(0.4, css(color, 0.3))
    gr.addColorStop(1, css(color, 0))
    g.fillStyle = gr
    g.fillRect(0, 0, GLOW, GLOW)
    t = Texture.from(c)
    this.glowTex.set(color, t)
    return t
  }

  private ensurePools(n: number): void {
    while (this.glows.length < n) {
      const glow = new Sprite(this.glowTexture(NEUTRAL.note))
      glow.anchor.set(0.5)
      glow.blendMode = 'add'
      this.glowLayer.addChild(glow)
      this.glows.push(glow)
      const disc = new Sprite(this.tex)
      disc.anchor.set(0.5)
      this.discLayer.addChild(disc)
      this.discs.push(disc)
      const core = new Sprite(this.tex)
      core.anchor.set(0.5)
      core.tint = WHITE
      this.coreLayer.addChild(core)
      this.cores.push(core)
    }
    for (let i = 0; i < this.glows.length; i++) {
      const on = i < n
      this.glows[i]!.visible = this.discs[i]!.visible = this.cores[i]!.visible = on
    }
  }

  // ---- dendrites ----------------------------------------------------------

  private clearArbors(): void {
    for (const g of this.arbors.values()) g.destroy()
    this.arbors.clear()
  }

  /** A neuron's dendrite tree: a few thick branches from the soma that fork into thinner ones. Hubs fork once more. */
  private buildArbor(i: number): Graphics {
    const n = this.graph.nodes[i]!
    const r = rng(Math.imul(i + 1, 2654435761) >>> 0)
    const rs = somaRadius(n.degree, 1)
    const levels: Seg[][] = [[], [], [], [], []]
    const L0 = 13 + 6.5 * Math.sqrt(n.degree + 1)
    const nprim = 4 + Math.floor(r() * 3)
    const dmax = n.degree > 8 ? 4 : 3
    const grow = (x: number, y: number, a: number, len: number, d: number): void => {
      const bend = (r() - 0.5) * 0.35
      const x2 = x + Math.cos(a + bend) * len
      const y2 = y + Math.sin(a + bend) * len
      levels[d]!.push([x, y, x2, y2])
      if (d >= dmax) return
      for (let k = 0; k < 2; k++) grow(x2, y2, a + (k ? 1 : -1) * (0.35 + r() * 0.55), len * (0.66 + r() * 0.13), d + 1)
    }
    for (let k = 0; k < nprim; k++) {
      const a = (k / nprim) * Math.PI * 2 + r() * 0.6
      grow(Math.cos(a) * rs, Math.sin(a) * rs, a, L0, 0)
    }
    const color = this.colorOf(n)
    const widths = [2.2, 1.6, 1.15, 0.8, 0.6]
    const g = new Graphics()
    levels.forEach((segs, lv) => {
      if (!segs.length) return
      for (const s of segs) g.moveTo(s[0], s[1]).lineTo(s[2], s[3])
      g.stroke({ width: widths[lv]!, color, alpha: 0.62 - lv * 0.08, cap: 'round' })
    })
    return g
  }

  private updateArbors(): void {
    const { k, x, y } = this.cam
    const { w, h } = this.size
    const sc = this.scale()
    const want: number[] = []
    for (const i of this.order) {
      const n = this.graph.nodes[i]!
      if (n.kind !== 'note') continue
      const reach = reachOf(n.degree, sc)
      if (reach * k < 14) continue
      const sx = this.pos[i * 2]! * k + x
      const sy = this.pos[i * 2 + 1]! * k + y
      const m = reach * k
      if (sx < -m || sy < -m || sx > w + m || sy > h + m) continue
      want.push(i)
      if (want.length >= MAX_ARBORS) break
    }
    const keep = new Set(want)
    for (const [i, g] of this.arbors) {
      if (keep.has(i)) continue
      g.visible = false
      if (this.arbors.size > MAX_ARBORS * 2) {
        g.destroy()
        this.arbors.delete(i)
      }
    }
    for (const i of want) {
      let g = this.arbors.get(i)
      if (!g) {
        g = this.buildArbor(i)
        this.arborLayer.addChild(g)
        this.arbors.set(i, g)
      }
      const dim = this.hover >= 0 ? (this.hoverSet.has(i) ? 1 : 0.22) : 1
      g.visible = true
      g.position.set(this.pos[i * 2]!, this.pos[i * 2 + 1]!)
      g.scale.set(sc)
      g.alpha = clamp(dim * (1 + this.fireV[i]! * 0.7), 0, 1)
    }
  }

  // ---- links --------------------------------------------------------------

  private rebuildBuckets(): void {
    for (const b of this.buckets) {
      this.edgeLayer.removeChild(b.mesh)
      b.mesh.destroy()
    }
    this.buckets = []
    const nodes = this.graph.nodes
    const lists = new Map<number, number[]>()
    this.graph.edges.forEach((e, i) => {
      for (const [h, c] of [
        [0, this.colorOf(nodes[e.s]!)],
        [1, this.colorOf(nodes[e.t]!)]
      ] as const) {
        const l = lists.get(c) ?? []
        l.push(i * 2 + h)
        lists.set(c, l)
      }
    })
    for (const [color, list] of lists) {
      const m = list.length
      const idx = new Uint32Array(m * SEGMENTS * 6)
      for (let k = 0; k < m; k++) {
        for (let s = 0; s < SEGMENTS; s++) {
          const v = k * (SEGMENTS + 1) * 2 + s * 2
          idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], (k * SEGMENTS + s) * 6)
        }
      }
      const geo = new MeshGeometry({ positions: new Float32Array(m * (SEGMENTS + 1) * 4), uvs: new Float32Array(m * (SEGMENTS + 1) * 4), indices: idx })
      const mesh = new Mesh({ geometry: geo, texture: Texture.WHITE })
      mesh.tint = color
      this.edgeLayer.addChild(mesh)
      this.buckets.push({ color, entries: Int32Array.from(list), mesh })
    }
  }

  /** Control points of every link: it starts at the edge of the first soma, bends a little and ends at the next one. */
  private updateCtrl(): void {
    const k = this.cam.k
    const p = this.pos
    const edges = this.graph.edges
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]!
      const x1 = p[e.s * 2]!
      const y1 = p[e.s * 2 + 1]!
      const x2 = p[e.t * 2]!
      const y2 = p[e.t * 2 + 1]!
      const dx = x2 - x1
      const dy = y2 - y1
      const L = Math.hypot(dx, dy) || 1
      const ra = Math.max(this.somaOf(e.s), 1.1 / k)
      const rb = Math.max(this.somaOf(e.t), 1.1 / k) + 2
      const ax = x1 + (dx / L) * ra
      const ay = y1 + (dy / L) * ra
      const bx = x2 - (dx / L) * rb
      const by = y2 - (dy / L) * rb
      const c = this.curv[i]!
      const o = i * 6
      this.ctrl[o] = ax
      this.ctrl[o + 1] = ay
      this.ctrl[o + 2] = bx
      this.ctrl[o + 3] = by
      this.ctrl[o + 4] = (ax + bx) / 2 - (by - ay) * c
      this.ctrl[o + 5] = (ay + by) / 2 + (bx - ax) * c
    }
  }

  private updateEdges(): void {
    this.updateCtrl()
    const k = this.cam.k
    const hw = Math.max(0.3, this.style.linkWidth * 0.9) / k / 2
    const c = this.ctrl
    for (const b of this.buckets) {
      const out = b.mesh.geometry.positions
      let o = 0
      for (let n = 0; n < b.entries.length; n++) {
        const code = b.entries[n]!
        const e = code >> 1
        const half = code & 1
        const q = e * 6
        const ax = c[q]!
        const ay = c[q + 1]!
        const bx = c[q + 2]!
        const by = c[q + 3]!
        const cx = c[q + 4]!
        const cy = c[q + 5]!
        for (let s = 0; s <= SEGMENTS; s++) {
          const t = half * 0.5 + (s / SEGMENTS) * 0.5
          const u = 1 - t
          const px = u * u * ax + 2 * u * t * cx + t * t * bx
          const py = u * u * ay + 2 * u * t * cy + t * t * by
          let tx = 2 * u * (cx - ax) + 2 * t * (bx - cx)
          let ty = 2 * u * (cy - ay) + 2 * t * (by - cy)
          const len = Math.hypot(tx, ty) || 1
          tx = (tx / len) * hw
          ty = (ty / len) * hw
          out[o++] = px - ty
          out[o++] = py + tx
          out[o++] = px + ty
          out[o++] = py - tx
        }
      }
      b.mesh.geometry.getBuffer('aPosition').update()
      b.mesh.alpha = this.hover >= 0 ? 0.06 : this.edgeAlpha
    }
  }

  private quad(e: number, t: number): [number, number] {
    const c = this.ctrl
    const q = e * 6
    const u = 1 - t
    return [u * u * c[q]! + 2 * u * t * c[q + 4]! + t * t * c[q + 2]!, u * u * c[q + 1]! + 2 * u * t * c[q + 5]! + t * t * c[q + 3]!]
  }

  /** The synapse dots where a link ends, and the highlighted links of the neuron under the pointer. */
  private drawLinkDetails(): void {
    const k = this.cam.k
    const { w, h } = this.size
    const syn = this.synGfx
    syn.clear()
    const edges = this.graph.edges
    const nodes = this.graph.nodes
    if ((k > 1.1 || this.style.arrows) && edges.length > 0) {
      let drawn = 0
      const dim = this.hover >= 0
      for (let i = 0; i < edges.length && drawn < MAX_SYNAPSES; i++) {
        const q = i * 6
        const sx = this.ctrl[q + 2]! * k + this.cam.x
        const sy = this.ctrl[q + 3]! * k + this.cam.y
        if (sx < -10 || sy < -10 || sx > w + 10 || sy > h + 10) continue
        const e = edges[i]!
        const col = this.colorOf(nodes[e.t]!)
        const a = dim ? 0.08 : 0.8
        syn.circle(this.ctrl[q + 2]!, this.ctrl[q + 3]!, 2.3).fill({ color: col, alpha: a })
        for (const t of [0.9, 0.95]) {
          const p = this.quad(i, t)
          syn.circle(p[0], p[1], 1.1).fill({ color: col, alpha: a })
        }
        drawn++
      }
    }
    const hl = this.hiLines
    hl.clear()
    if (this.hover >= 0) {
      const col = ACCENT
      for (const i of this.adjE[this.hover]!) {
        const q = i * 6
        hl.moveTo(this.ctrl[q]!, this.ctrl[q + 1]!).quadraticCurveTo(this.ctrl[q + 4]!, this.ctrl[q + 5]!, this.ctrl[q + 2]!, this.ctrl[q + 3]!)
      }
      hl.stroke({ width: 1.6 / k, color: col, alpha: 0.95 })
      for (const i of this.adjE[this.hover]!) {
        const q = i * 6
        hl.circle(this.ctrl[q + 2]!, this.ctrl[q + 3]!, 2.6).fill({ color: col, alpha: 0.95 })
      }
    }
  }

  // ---- signals and firing -------------------------------------------------

  private updateSignals(dt: number): void {
    const S = this.signals
    const f = this.fireV
    for (let i = 0; i < f.length; i++) if (f[i]! > 0) f[i] = Math.max(0, f[i]! - dt)
    for (let i = S.length - 1; i >= 0; i--) {
      const s = S[i]!
      s.t += s.sp * dt
      if (s.t < 1) continue
      const e = this.graph.edges[s.e]!
      const to = e.s === s.from ? e.t : e.s
      f[to] = 1
      if (s.hops > 0 && Math.random() < 0.8) {
        const next = this.adjE[to]!.filter((x) => x !== s.e).sort(() => Math.random() - 0.5).slice(0, 2)
        for (const x of next) if (S.length < MAX_SIGNALS) S.push({ e: x, from: to, t: 0, sp: 0.55 + Math.random() * 0.4, hops: s.hops - 1 })
      }
      S[i] = S[S.length - 1]!
      S.pop()
    }
    if (this.style.motion && this.graph.nodes.length > 0) {
      this.ambientT -= dt
      if (this.ambientT <= 0) {
        this.ambientT = 0.5 + Math.random() * 0.7
        const pool = this.recent.length && Math.random() < 0.6 ? this.recent : this.graph.nodes.map((n, i) => (n.degree > 0 ? i : -1)).filter((i) => i >= 0)
        if (pool.length) this.fire(pool[Math.floor(Math.random() * pool.length)]!, 4)
      }
    }
  }

  private drawSignals(): void {
    let used = 0
    const k = this.cam.k
    for (const s of this.signals) {
      const e = this.graph.edges[s.e]!
      const col = this.colorOf(this.graph.nodes[s.from]!)
      const t = e.s === s.from ? s.t : 1 - s.t
      for (let q = 0; q < 4; q++) {
        const tt = t - (e.s === s.from ? 1 : -1) * q * 0.018
        if (tt < 0 || tt > 1) continue
        let sp = this.sigSprites[used]
        if (!sp) {
          sp = new Sprite(this.glowTexture(col))
          sp.anchor.set(0.5)
          sp.blendMode = 'add'
          this.signalLayer.addChild(sp)
          this.sigSprites.push(sp)
        }
        used++
        const p = this.quad(s.e, tt)
        const size = Math.max(14, 7 / k) * (1 - q * 0.2)
        sp.texture = this.glowTexture(col)
        sp.visible = true
        sp.alpha = 1 - q * 0.25
        sp.position.set(p[0], p[1])
        sp.scale.set(size / GLOW)
      }
    }
    for (let i = used; i < this.sigSprites.length; i++) this.sigSprites[i]!.visible = false
  }

  // ---- nodes --------------------------------------------------------------

  private updateNodes(): void {
    const k = this.cam.k
    const p = this.pos
    const nodes = this.graph.nodes
    const dimOn = this.hover >= 0
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!
      const f = this.fireV[i]!
      const color = this.colorOf(n)
      const rs = Math.max(this.somaOf(i), 1.1 / k)
      const dim = dimOn ? (this.hoverSet.has(i) ? 1 : 0.22) : n.kind === 'ghost' ? 0.7 : 1
      const note = n.kind === 'note'
      const glow = this.glows[i]!
      const disc = this.discs[i]!
      const core = this.cores[i]!
      const x = p[i * 2]!
      const y = p[i * 2 + 1]!
      glow.position.set(x, y)
      disc.position.set(x, y)
      core.position.set(x, y)
      const gs = Math.max(rs * ((note ? 6 : 4.5) + f * 5), 5 / k)
      glow.scale.set(gs / GLOW)
      glow.alpha = dim * (0.8 + f * 0.2)
      const dr = rs * (1 + f * 0.25)
      disc.scale.set((dr * 2) / TEX)
      disc.tint = i === this.hover ? ACCENT : color
      disc.alpha = dim
      core.scale.set((dr * 0.84) / TEX)
      core.alpha = dim * clamp(0.5 + f * 0.5, 0, 1)
      if (this.dirtyStyle) glow.texture = this.glowTexture(color)
    }
  }

  private updateRecent(now: number): boolean {
    const g = this.recentGfx
    g.clear()
    if (this.recent.length === 0) return false
    const { k, x, y } = this.cam
    const { w, h } = this.size
    let any = false
    const t = now / 1000
    for (const i of this.recent) {
      const sx = this.pos[i * 2]! * k + x
      const sy = this.pos[i * 2 + 1]! * k + y
      if (sx < -30 || sy < -30 || sx > w + 30 || sy > h + 30) continue
      const dim = this.hover >= 0 ? (this.hoverSet.has(i) ? 1 : 0.22) : 1
      const rs = Math.max(this.somaOf(i), 1.1 / k)
      g.circle(this.pos[i * 2]!, this.pos[i * 2 + 1]!, rs * (1.9 + 0.5 * Math.sin(t * 2.2 + i))).stroke({ width: 1 / k, color: this.colorOf(this.graph.nodes[i]!), alpha: 0.55 * dim })
      any = true
    }
    return any
  }

  private drawSelection(): void {
    const sr = this.selRing
    sr.clear()
    if (this.selected >= 0) {
      const r = Math.max(this.somaOf(this.selected), 1.1 / this.cam.k) * 1.6 + 3 / this.cam.k
      sr.circle(this.pos[this.selected * 2]!, this.pos[this.selected * 2 + 1]!, r).stroke({ width: 1.3 / this.cam.k, color: WHITE })
    }
  }

  private updateRings(now: number): boolean {
    const k = this.cam.k
    let live = false
    this.rings = this.rings.filter((r) => {
      const age = (now - r.t0) / PULSE_MS
      if (age >= 1) {
        r.g.destroy()
        return false
      }
      const base = Math.max(this.somaOf(r.i), 1.1 / k)
      r.g.clear()
      r.g.circle(this.pos[r.i * 2]!, this.pos[r.i * 2 + 1]!, base * (1.5 + age * 5)).stroke({ width: 2 / k, color: this.colorOf(this.graph.nodes[r.i]!), alpha: 1 - age })
      live = true
      return true
    })
    return live
  }

  private updateLabels(): void {
    const { k, x, y } = this.cam
    const { w, h } = this.size
    const threshold = 0.25 + this.style.labelFade * 1.6
    const base = clamp((k - threshold * 0.6) / (threshold * 0.8), 0, 1)
    const wanted: { i: number; a: number; hot?: boolean }[] = []
    const seen = new Set<number>()
    // While the pointer is on a neuron the card names it, so no other label competes with it.
    if (this.hover < 0 && this.selected >= 0) {
      wanted.push({ i: this.selected, a: 1, hot: true })
      seen.add(this.selected)
    }
    if (this.hover < 0 && base > 0 && !this.opts.mini) {
      let scanned = 0
      for (const i of this.order) {
        if (wanted.length >= MAX_LABELS || scanned++ > 2500) break
        if (seen.has(i) || this.graph.nodes[i]!.degree < 4) continue
        const sx = this.pos[i * 2]! * k + x
        const sy = this.pos[i * 2 + 1]! * k + y
        if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue
        wanted.push({ i, a: base })
      }
    }
    while (this.labels.length < wanted.length) {
      const t = new Text({ text: '', style: { fill: 0xffffff, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' } })
      t.anchor.set(0.5, 0)
      this.labelLayer.addChild(t)
      this.labels.push(t)
    }
    for (let j = 0; j < this.labels.length; j++) {
      const t = this.labels[j]!
      const wnt = wanted[j]
      if (!wnt) {
        t.visible = false
        continue
      }
      const n = this.graph.nodes[wnt.i]!
      const text = n.label.length > 30 ? n.label.slice(0, 29) + '…' : n.label
      if (t.text !== text) t.text = text
      t.visible = true
      t.alpha = wnt.a
      t.tint = wnt.hot ? 0xffffff : 0xcdd2e8
      const r = Math.max(this.somaOf(wnt.i), 1.1 / k) * k
      t.position.set(this.pos[wnt.i * 2]! * k + x, this.pos[wnt.i * 2 + 1]! * k + y + r + 4)
    }
  }

  // ---- frame --------------------------------------------------------------

  private request(): void {
    if (this.destroyed || this.scheduled) return
    this.scheduled = requestAnimationFrame((t) => {
      this.scheduled = 0
      this.frame(t)
    })
  }

  private frame(now: number): void {
    if (this.destroyed || !this.app) return
    const dirty = this.dirtyPos || this.dirtyCam || this.dirtyStyle || this.dirtyHi
    const animating = this.signals.length > 0 || this.rings.length > 0 || this.recent.length > 0 || (this.style.motion && this.graph.nodes.length > 0)
    // idle animation runs at about 30 fps; anything the reader does is drawn at once
    if (!dirty && now - this.lastFrame < FRAME_MS) {
      if (animating) this.request()
      return
    }
    const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0.016
    this.lastFrame = now
    this.world.position.set(this.cam.x, this.cam.y)
    this.world.scale.set(this.cam.k)
    this.updateSignals(dt)
    if (this.dirtyPos || this.dirtyCam || this.dirtyStyle) this.updateEdges()
    this.drawLinkDetails()
    this.drawSignals()
    this.updateArbors()
    this.updateNodes()
    const recentLive = this.updateRecent(now)
    const ringsLive = this.updateRings(now)
    this.drawSelection()
    this.updateLabels()
    this.dirtyPos = this.dirtyCam = this.dirtyStyle = this.dirtyHi = false
    this.app.render()
    this.frames++
    if (this.signals.length > 0 || ringsLive || recentLive || this.fireV.some((v) => v > 0) || (this.style.motion && this.graph.nodes.length > 0)) this.request()
  }

  // ---- input --------------------------------------------------------------

  private toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.cam.x) / this.cam.k, (sy - this.cam.y) / this.cam.k]
  }

  private hit(sx: number, sy: number): number {
    if (this.graph.nodes.length === 0) return -1
    if (this.treeStale || !this.tree) {
      const p = this.pos
      this.tree = quadtree<number>()
        .x((i) => p[i * 2]!)
        .y((i) => p[i * 2 + 1]!)
        .addAll(this.graph.nodes.map((_, i) => i))
      this.treeStale = false
    }
    const [wx, wy] = this.toWorld(sx, sy)
    const slack = 5 / this.cam.k
    const i = this.tree.find(wx, wy, 40 + slack)
    if (i === undefined) return -1
    const d = Math.hypot(this.pos[i * 2]! - wx, this.pos[i * 2 + 1]! - wy)
    return d <= Math.max(this.somaOf(i), 1.1 / this.cam.k) + slack ? i : -1
  }

  private bindEvents(el: HTMLCanvasElement): void {
    const local = (e: PointerEvent | WheelEvent): [number, number] => {
      const r = el.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top]
    }
    const down = (e: PointerEvent): void => {
      const [sx, sy] = local(e)
      el.setPointerCapture(e.pointerId)
      const i = this.hit(sx, sy)
      this.mode = i >= 0 ? { kind: 'node', i, x: sx, y: sy, moved: 0 } : { kind: 'pan', x: sx, y: sy, moved: 0 }
    }
    const move = (e: PointerEvent): void => {
      const [sx, sy] = local(e)
      const m = this.mode
      if (m.kind === 'pan') {
        m.moved += Math.abs(sx - m.x) + Math.abs(sy - m.y)
        if (m.moved > 4) this.userMoved = true
        this.cam.x += sx - m.x
        this.cam.y += sy - m.y
        m.x = sx
        m.y = sy
        this.dirtyCam = true
        this.request()
      } else if (m.kind === 'node') {
        m.moved += Math.abs(sx - m.x) + Math.abs(sy - m.y)
        m.x = sx
        m.y = sy
        if (m.moved > 4 && !this.opts.mini) {
          const [wx, wy] = this.toWorld(sx, sy)
          this.sink?.drag(m.i, wx, wy)
        }
      } else {
        const i = this.hit(sx, sy)
        el.style.cursor = i >= 0 ? 'pointer' : 'grab'
        this.h.onHover(i >= 0 ? this.graph.nodes[i]!.id : null, { x: sx, y: sy })
      }
    }
    const up = (e: PointerEvent): void => {
      const m = this.mode
      this.mode = { kind: 'none' }
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (m.kind === 'node') {
        this.sink?.release(m.i)
        if (m.moved <= 4) {
          this.fire(m.i, 5)
          this.h.onSelect(this.graph.nodes[m.i]!.id)
        }
      } else if (m.kind === 'pan' && m.moved <= 4) this.h.onSelect(null)
    }
    const leave = (): void => {
      if (this.mode.kind === 'none') this.h.onHover(null)
    }
    const wheel = (e: WheelEvent): void => {
      e.preventDefault()
      const [sx, sy] = local(e)
      const k = clamp(this.cam.k * Math.exp(-e.deltaY * 0.0015), MIN_K, MAX_K)
      const [wx, wy] = this.toWorld(sx, sy)
      this.userMoved = true
      this.cam = { k, x: sx - wx * k, y: sy - wy * k }
      this.dirtyCam = true
      this.request()
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('wheel', wheel, { passive: false })
    this.cleanups.push(() => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('wheel', wheel)
    })
  }

  destroy(): void {
    this.destroyed = true
    if (this.scheduled) cancelAnimationFrame(this.scheduled)
    for (const c of this.cleanups) c()
    this.cleanups = []
    if (this.app) {
      this.app.canvas.remove()
      this.app.destroy(true, { children: true, texture: true })
    }
  }
}
