/// <reference lib="webworker" />
import { forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force'
import { forceValues, type Forces, type FromWorker, type ToWorker } from './layoutTypes'

interface N extends SimulationNodeDatum {
  index: number
}

const FRAME_MS = 33
const BUDGET_MS = 24

let nodes: N[] = []
let links: SimulationLinkDatum<N>[] = []
let degree: Int32Array = new Int32Array(0)
let ringRadius = 200
/** A fixed random factor per node, so the unlinked notes form a band rather than a single line. */
let band: Float32Array = new Float32Array(0)
let ring: ReturnType<typeof forceRadial<N>> | null = null
let ticks = 0
let radii: Float32Array = new Float32Array(0)
let sim: Simulation<N, SimulationLinkDatum<N>> | null = null
let timer: ReturnType<typeof setInterval> | null = null
let forces: Forces = { center: 0.3, repel: 0.5, link: 0.5, distance: 0.4 }

const post = (m: FromWorker, transfer?: Transferable[]): void => (self as unknown as Worker).postMessage(m, transfer ?? [])

function applyForces(): void {
  if (!sim) return
  const v = forceValues(forces)
  // linked notes drift to the centre; notes without any link are held on a ring just outside the connected core
  const linked = (n: N): number => (degree[n.index] === 0 ? 0 : v.gravity)
  sim.force('x', forceX<N>(0).strength(linked))
  sim.force('y', forceY<N>(0).strength(linked))
  ring = forceRadial<N>((n) => ringRadius * (band[n.index] ?? 1), 0, 0).strength((n) => (degree[n.index] === 0 ? 1 : 0))
  sim.force('ring', ring)
  sim.force('collide', forceCollide<N>((n) => (radii[n.index] ?? 2) + 1.5).strength(0.9).iterations(1))
  sim.force('charge', forceManyBody<N>().strength(v.charge).theta(0.9))
  sim.force(
    'link',
    forceLink<N, SimulationLinkDatum<N>>(links)
      .distance(v.distance)
      .strength((l) => v.strength / Math.max(1, Math.min(degree[(l.source as N).index] ?? 1, degree[(l.target as N).index] ?? 1)))
  )
}

function stopLoop(): void {
  if (timer !== null) clearInterval(timer)
  timer = null
}

function snapshot(): Float32Array {
  const out = new Float32Array(nodes.length * 2)
  for (let i = 0; i < nodes.length; i++) {
    out[i * 2] = nodes[i]!.x ?? 0
    out[i * 2 + 1] = nodes[i]!.y ?? 0
  }
  return out
}

/** The ring sits at about 1.15 times the radius that holds nearly all linked notes. */
function measureRing(): void {
  const radii: number[] = []
  for (const n of nodes) if (degree[n.index]! > 0 && n.x !== undefined && n.y !== undefined) radii.push(Math.hypot(n.x, n.y))
  if (radii.length < 3) return
  radii.sort((a, b) => a - b)
  const r90 = radii[Math.floor(radii.length * 0.9)]!
  ringRadius = r90 * 1.0 + 12
  ring?.radius((n) => ringRadius * (band[n.index] ?? 1)) // d3 reads the radius when the force is set up, so set it again
}

function loop(): void {
  if (!sim) return
  const start = performance.now()
  do {
    sim.tick()
    if (++ticks % 10 === 0) measureRing()
  } while (sim.alpha() >= sim.alphaMin() && performance.now() - start < BUDGET_MS)
  const pos = snapshot()
  post({ type: 'tick', pos, alpha: sim.alpha() }, [pos.buffer])
  if (sim.alpha() < sim.alphaMin() && sim.alphaTarget() === 0) {
    stopLoop()
    post({ type: 'settled' })
  }
}

function wake(): void {
  if (timer === null && sim) timer = setInterval(loop, FRAME_MS)
}

function setGraph(m: Extract<ToWorker, { type: 'set' }>): void {
  stopLoop()
  const n = m.pos.length / 2
  nodes = Array.from({ length: n }, (_, i) => {
    const x = m.pos[i * 2]!
    const y = m.pos[i * 2 + 1]!
    return { index: i, x: Number.isNaN(x) ? undefined : x, y: Number.isNaN(y) ? undefined : y }
  })
  degree = new Int32Array(n)
  links = []
  for (let e = 0; e < m.edges.length; e += 2) {
    const s = m.edges[e]!
    const t = m.edges[e + 1]!
    degree[s]!++
    degree[t]!++
    links.push({ source: nodes[s]!, target: nodes[t]! })
  }
  forces = m.forces
  radii = m.radii
  ticks = 0
  ringRadius = Math.sqrt(n) * 12 + 60
  band = Float32Array.from({ length: n }, (_, i) => 0.95 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.3)
  sim = forceSimulation<N>(nodes).alpha(m.alpha).alphaDecay(0.02).velocityDecay(0.45).stop()
  applyForces()
  wake()
}

self.onmessage = (ev: MessageEvent<ToWorker>): void => {
  const m = ev.data
  if (m.type === 'set') setGraph(m)
  else if (!sim) return
  else if (m.type === 'radii') {
    radii = m.radii
    sim.force('collide', forceCollide<N>((n) => (radii[n.index] ?? 2) + 1.5).strength(0.9).iterations(1))
    sim.alpha(Math.max(sim.alpha(), 0.3))
    wake()
  } else if (m.type === 'forces') {
    forces = m.forces
    applyForces()
    sim.alpha(Math.max(sim.alpha(), 0.4))
    wake()
  } else if (m.type === 'drag') {
    const node = nodes[m.i]
    if (!node) return
    node.fx = m.x
    node.fy = m.y
    sim.alphaTarget(0.25)
    sim.alpha(Math.max(sim.alpha(), 0.25))
    wake()
  } else if (m.type === 'release') {
    const node = nodes[m.i]
    if (node) {
      node.fx = null
      node.fy = null
    }
    sim.alphaTarget(0)
  } else if (m.type === 'reheat') {
    sim.alpha(Math.max(sim.alpha(), m.alpha))
    wake()
  }
}
