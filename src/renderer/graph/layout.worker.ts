/// <reference lib="webworker" />
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force'
import { forceValues, type Forces, type FromWorker, type ToWorker } from './layoutTypes'

interface N extends SimulationNodeDatum {
  index: number
}

const FRAME_MS = 33
const BUDGET_MS = 24

let nodes: N[] = []
let links: SimulationLinkDatum<N>[] = []
let radii: Float32Array = new Float32Array(0)
let anchors: Float32Array = new Float32Array(0)
let sim: Simulation<N, SimulationLinkDatum<N>> | null = null
let timer: ReturnType<typeof setInterval> | null = null
let forces: Forces = { center: 0.3, repel: 0.5, link: 0.5, distance: 0.4 }

const post = (m: FromWorker, transfer?: Transferable[]): void => (self as unknown as Worker).postMessage(m, transfer ?? [])

function collide(): void {
  sim?.force('collide', forceCollide<N>((n) => (radii[n.index] ?? 4) + 1).strength(0.9).iterations(1))
}

function applyForces(): void {
  if (!sim) return
  const v = forceValues(forces)
  // every group of notes is drawn towards its own spot on a circle, so folders form separate regions of neurons
  sim.force('x', forceX<N>((n) => anchors[n.index * 2] ?? 0).strength(v.gravity))
  sim.force('y', forceY<N>((n) => anchors[n.index * 2 + 1] ?? 0).strength(v.gravity))
  collide()
  sim.force('charge', forceManyBody<N>().strength(v.charge).theta(0.9).distanceMax(700))
  sim.force(
    'link',
    forceLink<N, SimulationLinkDatum<N>>(links)
      .distance((l) => v.distance + ((radii[(l.source as N).index] ?? 0) + (radii[(l.target as N).index] ?? 0)) * 0.55)
      .strength(v.strength)
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

function loop(): void {
  if (!sim) return
  const start = performance.now()
  do sim.tick()
  while (sim.alpha() >= sim.alphaMin() && performance.now() - start < BUDGET_MS)
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
  links = []
  for (let e = 0; e < m.edges.length; e += 2) links.push({ source: nodes[m.edges[e]!]!, target: nodes[m.edges[e + 1]!]! })
  forces = m.forces
  radii = m.radii
  anchors = m.anchors
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
    collide()
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
