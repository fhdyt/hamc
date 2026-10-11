import 'pixi.js/unsafe-eval'
import { Application, Container, Graphics, Mesh, MeshGeometry, Sprite, Text, Texture } from 'pixi.js'
import { quadtree, type Quadtree } from 'd3-quadtree'
import { neighbours, nodeRadius, type GNode, type Graph } from '../lib/brain/graphModel'

export interface GraphStyle {
  nodeSize: number
  linkWidth: number
  arrows: boolean
  /** 0..1, higher means labels only show when zoomed in further. */
  labelFade: number
  groupColors: readonly string[]
}

export interface RendererHandlers {
  onHover(id: string | null): void
  onSelect(id: string | null): void
}

export interface RendererOptions {
  /** Compact mode for the Dashboard: no wheel zoom and no node dragging. */
  mini?: boolean
}

export interface DragSink {
  drag(i: number, x: number, y: number): void
  release(i: number): void
}

const COLORS = { note: 0xbd93f9, ghost: 0x8b95bd, tag: 0x50fa7b, attachment: 0xffb86c, edge: 0x6272a4, hi: 0xf8f8f2, pulse: 0x50fa7b, bg: 0x282a36 }
const MAX_LABELS = 70
const TEX = 32
const MIN_K = 0.03
const MAX_K = 10
const ARROW_EDGE_LIMIT = 12000
const PULSE_MS = 1400

const hex = (s: string): number => parseInt(s.replace('#', ''), 16)

interface Ring {
  i: number
  t0: number
  g: Graphics
}

export class GraphRenderer {
  private app!: Application
  private world = new Container()
  private labelLayer = new Container()
  private ringLayer = new Container()
  private nodeLayer = new Container()
  private edgeMesh: Mesh | null = null
  private arrowMesh: Mesh | null = null
  private hiLines = new Graphics()
  private selRing = new Graphics()
  private sprites: Sprite[] = []
  private labels: Text[] = []
  private rings: Ring[] = []
  private tex!: Texture
  private graph: Graph = { nodes: [], edges: [], index: new Map() }
  private nb: number[][] = []
  private order: number[] = []
  private pos: Float32Array = new Float32Array(0)
  private cam = { x: 0, y: 0, k: 1 }
  private style: GraphStyle = { nodeSize: 1, linkWidth: 1, arrows: false, labelFade: 0.5, groupColors: [] }
  private hover = -1
  private selected = -1
  private hoverSet = new Set<number>()
  private dirtyPos = true
  private dirtyCam = true
  private dirtyStyle = true
  private dirtyHi = true
  private scheduled = 0
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
    await app.init({
      resizeTo: this.host,
      background: COLORS.bg,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      autoStart: false,
      preference: 'webgl'
    })
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
    this.world.addChild(this.hiLines)
    this.world.addChild(this.nodeLayer)
    this.world.addChild(this.selRing)
    this.world.addChild(this.ringLayer)
    app.stage.addChild(this.world)
    app.stage.addChild(this.labelLayer)
    this.bindEvents(app.canvas)
    const ro = new ResizeObserver(() => {
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
    const oldIds = this.graph.nodes.map((n) => n.id)
    this.graph = g
    this.pos = pos
    this.nb = neighbours(g)
    this.order = g.nodes.map((_, i) => i).sort((a, b) => g.nodes[b]!.degree - g.nodes[a]!.degree)
    // sprites: reuse the pool
    while (this.sprites.length < g.nodes.length) {
      const s = new Sprite(this.tex)
      s.anchor.set(0.5)
      this.nodeLayer.addChild(s)
      this.sprites.push(s)
    }
    for (let i = 0; i < this.sprites.length; i++) this.sprites[i]!.visible = i < g.nodes.length
    this.rebuildEdgeGeometry()
    this.hover = this.selected = -1
    this.hoverSet.clear()
    this.treeStale = true
    this.dirtyPos = this.dirtyStyle = this.dirtyCam = this.dirtyHi = true
    for (const r of this.rings) r.g.destroy()
    this.rings = []
    if (oldIds.length === 0) this.fit()
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
    this.style = s
    this.dirtyStyle = true
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

  pulse(ids: readonly string[]): void {
    const now = performance.now()
    for (const id of ids.slice(0, 40)) {
      const i = this.graph.index.get(id)
      if (i === undefined) continue
      const g = new Graphics()
      this.ringLayer.addChild(g)
      this.rings.push({ i, t0: now, g })
    }
    while (this.rings.length > 60) this.rings.shift()!.g.destroy()
    this.request()
  }

  /** Frames the bulk of the graph (2nd to 98th percentile, so a few far-away nodes do not shrink everything). */
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
    const x0 = q(xs, lo)
    const x1 = q(xs, 1 - lo)
    const y0 = q(ys, lo)
    const y1 = q(ys, 1 - lo)
    const { w, h } = this.size
    const bw = Math.max(40, x1 - x0) * 1.2
    const bh = Math.max(40, y1 - y0) * 1.2
    const k = Math.min(w / bw, h / bh, 2.5)
    this.cam = { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k }
    this.dirtyCam = true
    this.request()
  }

  /** Node centres in canvas pixels; used by the end-to-end tests to click on nodes. */
  screenPositions(): { id: string; x: number; y: number }[] {
    return this.graph.nodes.map((n, i) => ({ id: n.id, x: this.pos[i * 2]! * this.cam.k + this.cam.x, y: this.pos[i * 2 + 1]! * this.cam.k + this.cam.y }))
  }

  // ---- drawing ------------------------------------------------------------

  private request(): void {
    if (this.destroyed || this.scheduled) return
    this.scheduled = requestAnimationFrame(() => {
      this.scheduled = 0
      this.frame()
    })
  }

  private nodeColor(n: GNode): number {
    if (n.group >= 0 && this.style.groupColors[n.group]) return hex(this.style.groupColors[n.group]!)
    return COLORS[n.kind]
  }

  private radiusOf(i: number): number {
    return nodeRadius(this.graph.nodes[i]!.degree, this.style.nodeSize)
  }

  private rebuildEdgeGeometry(): void {
    for (const m of [this.edgeMesh, this.arrowMesh]) {
      if (m) {
        this.world.removeChild(m)
        m.destroy()
      }
    }
    this.edgeMesh = this.arrowMesh = null
    const e = this.graph.edges.length
    if (e === 0) return
    const idx = new Uint32Array(e * 6)
    for (let i = 0; i < e; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6)
    const geo = new MeshGeometry({ positions: new Float32Array(e * 8), uvs: new Float32Array(e * 8), indices: idx })
    this.edgeMesh = new Mesh({ geometry: geo, texture: Texture.WHITE })
    this.edgeMesh.tint = COLORS.edge
    this.world.addChildAt(this.edgeMesh, 0)
    if (e <= ARROW_EDGE_LIMIT) {
      const aidx = new Uint32Array(e * 3)
      for (let i = 0; i < e; i++) aidx.set([i * 3, i * 3 + 1, i * 3 + 2], i * 3)
      const ageo = new MeshGeometry({ positions: new Float32Array(e * 6), uvs: new Float32Array(e * 6), indices: aidx })
      this.arrowMesh = new Mesh({ geometry: ageo, texture: Texture.WHITE })
      this.arrowMesh.tint = COLORS.edge
      this.arrowMesh.visible = false
      this.world.addChildAt(this.arrowMesh, 1)
    }
  }

  private updateEdges(): void {
    const mesh = this.edgeMesh
    if (!mesh) return
    const k = this.cam.k
    const half = Math.max(0.4, this.style.linkWidth) / k / 2
    const p = this.pos
    const out = mesh.geometry.positions
    const edges = this.graph.edges
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]!
      const x1 = p[e.s * 2]!
      const y1 = p[e.s * 2 + 1]!
      const x2 = p[e.t * 2]!
      const y2 = p[e.t * 2 + 1]!
      let dx = y2 - y1
      let dy = x1 - x2
      const len = Math.hypot(dx, dy) || 1
      dx = (dx / len) * half
      dy = (dy / len) * half
      const o = i * 8
      out[o] = x1 + dx
      out[o + 1] = y1 + dy
      out[o + 2] = x1 - dx
      out[o + 3] = y1 - dy
      out[o + 4] = x2 + dx
      out[o + 5] = y2 + dy
      out[o + 6] = x2 - dx
      out[o + 7] = y2 - dy
    }
    mesh.geometry.getBuffer('aPosition').update()
    mesh.alpha = this.hover >= 0 ? 0.12 : 0.55

    const am = this.arrowMesh
    if (am) {
      am.visible = this.style.arrows
      if (this.style.arrows) {
        const ap = am.geometry.positions
        for (let i = 0; i < edges.length; i++) {
          const e = edges[i]!
          const x1 = p[e.s * 2]!
          const y1 = p[e.s * 2 + 1]!
          const x2 = p[e.t * 2]!
          const y2 = p[e.t * 2 + 1]!
          const dx = x2 - x1
          const dy = y2 - y1
          const len = Math.hypot(dx, dy) || 1
          const ux = dx / len
          const uy = dy / len
          const r = this.radiusOf(e.t) + 1 / k
          const tipx = x2 - ux * r
          const tipy = y2 - uy * r
          const size = 7 / k
          const o = i * 6
          ap[o] = tipx
          ap[o + 1] = tipy
          ap[o + 2] = tipx - ux * size + -uy * size * 0.45
          ap[o + 3] = tipy - uy * size + ux * size * 0.45
          ap[o + 4] = tipx - ux * size - -uy * size * 0.45
          ap[o + 5] = tipy - uy * size - ux * size * 0.45
        }
        am.geometry.getBuffer('aPosition').update()
        am.alpha = this.hover >= 0 ? 0.12 : 0.7
      }
    }
  }

  private updateNodes(): void {
    const k = this.cam.k
    const p = this.pos
    const nodes = this.graph.nodes
    for (let i = 0; i < nodes.length; i++) {
      const s = this.sprites[i]!
      s.position.set(p[i * 2]!, p[i * 2 + 1]!)
      if (this.dirtyStyle || this.dirtyCam) {
        const r = Math.max(this.radiusOf(i), 1.6 / k)
        s.scale.set((r * 2) / TEX)
      }
      if (this.dirtyStyle) {
        s.tint = this.nodeColor(nodes[i]!)
      }
    }
  }

  private updateHighlight(): void {
    const nodes = this.graph.nodes
    const dim = this.hover >= 0
    for (let i = 0; i < nodes.length; i++) {
      const base = nodes[i]!.kind === 'ghost' ? 0.7 : 1
      this.sprites[i]!.alpha = dim ? (this.hoverSet.has(i) ? 1 : 0.15) : base
    }
  }

  private drawOverlays(): void {
    const k = this.cam.k
    const hl = this.hiLines
    hl.clear()
    if (this.hover >= 0) {
      const w = 1.4 / k
      for (const e of this.graph.edges) {
        if (e.s !== this.hover && e.t !== this.hover) continue
        hl.moveTo(this.pos[e.s * 2]!, this.pos[e.s * 2 + 1]!).lineTo(this.pos[e.t * 2]!, this.pos[e.t * 2 + 1]!)
      }
      hl.stroke({ width: w, color: COLORS.hi, alpha: 0.85 })
    }
    const sr = this.selRing
    sr.clear()
    if (this.selected >= 0) {
      const r = Math.max(this.radiusOf(this.selected), 1.6 / k) + 3 / k
      sr.circle(this.pos[this.selected * 2]!, this.pos[this.selected * 2 + 1]!, r).stroke({ width: 1.6 / k, color: COLORS.hi })
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
      const base = Math.max(this.radiusOf(r.i), 1.6 / k)
      r.g.clear()
      r.g.circle(this.pos[r.i * 2]!, this.pos[r.i * 2 + 1]!, base * (1 + age * 3.5)).stroke({ width: 2 / k, color: COLORS.pulse, alpha: 1 - age })
      live = true
      return true
    })
    return live
  }

  private updateLabels(): void {
    const { k, x, y } = this.cam
    const { w, h } = this.size
    const threshold = 0.25 + this.style.labelFade * 1.6
    const base = Math.max(0, Math.min(1, (k - threshold * 0.6) / (threshold * 0.8)))
    const wanted: { i: number; a: number }[] = []
    const seen = new Set<number>()
    if (this.hover >= 0) for (const i of this.hoverSet) wanted.push({ i, a: 1 }), seen.add(i)
    if (this.selected >= 0 && !seen.has(this.selected)) wanted.push({ i: this.selected, a: 1 }), seen.add(this.selected)
    if (base > 0 && !this.opts.mini) {
      let scanned = 0
      for (const i of this.order) {
        if (wanted.length >= MAX_LABELS || scanned++ > 2500) break
        if (seen.has(i)) continue
        const sx = this.pos[i * 2]! * k + x
        const sy = this.pos[i * 2 + 1]! * k + y
        if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue
        wanted.push({ i, a: this.hover >= 0 ? base * 0.25 : base })
      }
    }
    while (this.labels.length < wanted.length) {
      const t = new Text({ text: '', style: { fill: 0xf8f8f2, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' } })
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
      if (t.text !== n.label) t.text = n.label.length > 36 ? n.label.slice(0, 35) + '…' : n.label
      t.visible = true
      t.alpha = wnt.a
      const r = Math.max(this.radiusOf(wnt.i), 1.6 / k) * k
      t.position.set(this.pos[wnt.i * 2]! * k + x, this.pos[wnt.i * 2 + 1]! * k + y + r + 2)
    }
  }

  private frame(): void {
    if (this.destroyed || !this.app) return
    const t0 = performance.now()
    this.world.position.set(this.cam.x, this.cam.y)
    this.world.scale.set(this.cam.k)
    if (this.dirtyPos || this.dirtyCam || this.dirtyStyle) {
      this.updateEdges()
      this.updateNodes()
    }
    if (this.dirtyHi || this.dirtyStyle || this.dirtyPos || this.dirtyCam) this.updateHighlight()
    this.drawOverlays()
    const live = this.updateRings(t0)
    this.updateLabels()
    this.dirtyPos = this.dirtyCam = this.dirtyStyle = this.dirtyHi = false
    this.app.render()
    this.frames++
    if (live) this.request()
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
    const slack = 4 / this.cam.k
    const i = this.tree.find(wx, wy, 24 + slack)
    if (i === undefined) return -1
    const d = Math.hypot(this.pos[i * 2]! - wx, this.pos[i * 2 + 1]! - wy)
    return d <= Math.max(this.radiusOf(i), 1.6 / this.cam.k) + slack ? i : -1
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
        const id = i >= 0 ? this.graph.nodes[i]!.id : null
        el.style.cursor = i >= 0 ? 'pointer' : 'grab'
        this.h.onHover(id)
      }
    }
    const up = (e: PointerEvent): void => {
      const m = this.mode
      this.mode = { kind: 'none' }
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (m.kind === 'node') {
        this.sink?.release(m.i)
        if (m.moved <= 4) this.h.onSelect(this.graph.nodes[m.i]!.id)
      } else if (m.kind === 'pan' && m.moved <= 4) this.h.onSelect(null)
    }
    const leave = (): void => {
      if (this.mode.kind === 'none') this.h.onHover(null)
    }
    const wheel = (e: WheelEvent): void => {
      if (this.opts.mini) return
      e.preventDefault()
      const [sx, sy] = local(e)
      const k = Math.min(MAX_K, Math.max(MIN_K, this.cam.k * Math.exp(-e.deltaY * 0.0015)))
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
