import type { BrainNote } from '@shared/events'
import type { BrainGroup } from '@shared/settings'

export type NodeKind = 'note' | 'tag' | 'ghost' | 'attachment'

export interface GNode {
  id: string
  label: string
  kind: NodeKind
  /** Number of edges touching the node in the graph that is drawn. */
  degree: number
  /** Index into the groups list, or -1 when no group matches (and for non-note nodes). */
  group: number
  mtime: number
}

export interface GEdge {
  s: number
  t: number
}

export interface Graph {
  nodes: GNode[]
  edges: GEdge[]
  index: Map<string, number>
}

export interface GraphOptions {
  search: string
  showTags: boolean
  showAttachments: boolean
  existingOnly: boolean
  showOrphans: boolean
  groups: readonly BrainGroup[]
  /** Top-level folders that get their own colour, in the order of their colours; user groups come first in `group`. */
  folders: readonly string[]
  local: { id: string; depth: number } | null
}

export const tagId = (t: string): string => `tag:${t.toLowerCase()}`
export const ghostId = (n: string): string => `ghost:${n.toLowerCase()}`
export const fileId = (n: string): string => `file:${n.toLowerCase()}`

export interface ParsedQuery {
  tags: string[]
  paths: string[]
  words: string[]
  /** `file:name` (lower case, matches part of the file name) or `file:/regex/flags`. */
  files: (string | RegExp)[]
}

function fileToken(raw: string): string | RegExp | null {
  const m = /^\/(.+)\/([a-z]*)$/.exec(raw)
  if (m) {
    try {
      return new RegExp(m[1]!, m[2]!.includes('i') ? m[2] : m[2] + 'i')
    } catch {
      return null
    }
  }
  return raw ? raw.toLowerCase() : null
}

/** `tag:#x`, `path:folder`, `file:name` or `file:/regex/`, and plain words; every part must match. */
export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { tags: [], paths: [], words: [], files: [] }
  for (const original of q.trim().split(/\s+/)) {
    if (!original) continue
    const raw = original.toLowerCase()
    if (raw.startsWith('tag:')) {
      const t = raw.slice(4).replace(/^#/, '')
      if (t) out.tags.push(t)
    } else if (raw.startsWith('path:')) {
      const p = raw.slice(5)
      if (p) out.paths.push(p)
    } else if (raw.startsWith('file:')) {
      const f = fileToken(original.slice(5))
      if (f) out.files.push(f)
    } else out.words.push(raw)
  }
  return out
}

export const isEmptyQuery = (p: ParsedQuery): boolean => p.tags.length + p.paths.length + p.words.length + p.files.length === 0

export function matchesQuery(n: BrainNote, p: ParsedQuery): boolean {
  if (isEmptyQuery(p)) return false
  const id = n.id.toLowerCase()
  const title = n.title.toLowerCase()
  const tags = n.tags.map((t) => t.toLowerCase())
  return (
    p.tags.every((t) => tags.some((x) => x === t || x.startsWith(t + '/'))) &&
    p.paths.every((x) => id.includes(x)) &&
    p.files.every((f) => (typeof f === 'string' ? title.includes(f) : f.test(n.title))) &&
    p.words.every((w) => title.includes(w) || id.includes(w) || n.aliases.some((a) => a.toLowerCase().includes(w)))
  )
}

export const DEFAULT_OPTIONS: GraphOptions = {
  folders: [],
  search: '',
  showTags: false,
  showAttachments: false,
  existingOnly: false,
  showOrphans: true,
  groups: [],
  local: null
}

/** Builds the graph that is drawn: all nodes first, then the filters, then the local-graph cut. */
export function buildGraph(notes: Iterable<BrainNote>, opts: GraphOptions): Graph {
  const list = [...notes]
  const byId = new Map(list.map((n) => [n.id, n]))
  const parsedSearch = parseQuery(opts.search)
  const searching = !isEmptyQuery(parsedSearch)
  const groupQueries = opts.groups.map((g) => parseQuery(g.query))
  const folderIndex = new Map(opts.folders.map((f, i) => [f, i]))

  interface Raw {
    id: string
    label: string
    kind: NodeKind
    mtime: number
    note?: BrainNote
  }
  const raw = new Map<string, Raw>()
  const edges: [string, string][] = []
  const addNode = (r: Raw): void => {
    if (!raw.has(r.id)) raw.set(r.id, r)
  }

  for (const n of list) addNode({ id: n.id, label: n.title, kind: 'note', mtime: n.mtime, note: n })
  for (const n of list) {
    for (const t of n.links) if (byId.has(t)) edges.push([n.id, t])
    if (!opts.existingOnly) {
      for (const g of n.ghosts) {
        addNode({ id: ghostId(g), label: g.split('/').pop() || g, kind: 'ghost', mtime: 0 })
        edges.push([n.id, ghostId(g)])
      }
    }
    if (opts.showTags) {
      for (const t of n.tags) {
        addNode({ id: tagId(t), label: '#' + t, kind: 'tag', mtime: 0 })
        edges.push([n.id, tagId(t)])
      }
    }
    if (opts.showAttachments) {
      for (const a of n.attachments) {
        addNode({ id: fileId(a), label: a, kind: 'attachment', mtime: 0 })
        edges.push([n.id, fileId(a)])
      }
    }
  }

  // 1. search keeps matching notes and the extra nodes that touch them
  let keep = new Set<string>()
  if (searching) {
    for (const n of list) if (matchesQuery(n, parsedSearch)) keep.add(n.id)
    for (const [s, t] of edges) {
      if (keep.has(s) && raw.get(t)!.kind !== 'note') keep.add(t)
    }
  } else keep = new Set(raw.keys())

  const adj = new Map<string, string[]>()
  const live = edges.filter(([s, t]) => keep.has(s) && keep.has(t))
  for (const [s, t] of live) {
    adj.set(s, [...(adj.get(s) ?? []), t])
    adj.set(t, [...(adj.get(t) ?? []), s])
  }

  // 2. orphans: nothing touches them
  if (!opts.showOrphans) for (const id of [...keep]) if (!adj.has(id)) keep.delete(id)

  // 3. the local graph: breadth first from the chosen note
  if (opts.local) {
    const start = opts.local.id
    const seen = new Set<string>()
    if (raw.has(start)) {
      seen.add(start)
      let frontier = [start]
      for (let d = 0; d < opts.local.depth; d++) {
        const next: string[] = []
        for (const id of frontier) {
          for (const nb of adj.get(id) ?? []) {
            if (keep.has(nb) && !seen.has(nb)) {
              seen.add(nb)
              next.push(nb)
            }
          }
        }
        frontier = next
      }
    }
    keep = seen
  }

  const nodes: GNode[] = []
  const index = new Map<string, number>()
  for (const [id, r] of raw) {
    if (!keep.has(id)) continue
    let group = -1
    if (r.note) {
      group = groupQueries.findIndex((q) => matchesQuery(r.note!, q))
      if (group < 0) {
        const f = folderIndex.get(topFolder(r.note.id))
        if (f !== undefined) group = groupQueries.length + f
      }
    }
    index.set(id, nodes.length)
    nodes.push({ id, label: r.label, kind: r.kind, degree: 0, group, mtime: r.mtime })
  }
  const out: GEdge[] = []
  for (const [s, t] of edges) {
    const si = index.get(s)
    const ti = index.get(t)
    if (si === undefined || ti === undefined || si === ti) continue
    out.push({ s: si, t: ti })
    nodes[si]!.degree++
    nodes[ti]!.degree++
  }
  return { nodes, edges: out, index }
}

/** Notes that link to `id`. */
export function backlinksOf(notes: Iterable<BrainNote>, id: string): BrainNote[] {
  const out: BrainNote[] = []
  for (const n of notes) if (n.links.includes(id)) out.push(n)
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

/** Neighbour indices of a node, both directions. */
export function neighbours(g: Graph): number[][] {
  const out: number[][] = g.nodes.map(() => [])
  for (const e of g.edges) {
    out[e.s]!.push(e.t)
    out[e.t]!.push(e.s)
  }
  return out
}

/** Radius of a neuron's cell body (soma) in world units: grows with the square root of the connections. */
export function somaRadius(degree: number, scale: number): number {
  return Math.min(20, (2.4 + Math.sqrt(degree) * 1.7) * scale)
}

/** Space a node keeps to itself in the layout, so neighbouring glows do not pile up. */
export function collideRadius(n: Pick<GNode, 'degree'>, scale: number): number {
  return somaRadius(n.degree, scale) + 6
}

/** Collision radius of every node of a graph, in the order of `g.nodes`. */
export function radiiOf(nodes: readonly GNode[], nodeSize: number): Float32Array {
  const scale = nodeSize * densityScale(nodes.length)
  return Float32Array.from(nodes, (n) => collideRadius(n, scale))
}

/** Where each group of notes is drawn towards: groups sit evenly on a circle, notes without a group in the middle. */
export function anchorsOf(nodes: readonly GNode[]): Float32Array {
  const used = [...new Set(nodes.map((n) => n.group).filter((g) => g >= 0))].sort((a, b) => a - b)
  const slot = new Map(used.map((g, i) => [g, i]))
  const R = used.length > 1 ? 60 + Math.sqrt(nodes.length) * 12 : 0
  const out = new Float32Array(nodes.length * 2)
  nodes.forEach((n, i) => {
    const s = slot.get(n.group)
    if (s === undefined) return
    const a = (s / used.length) * Math.PI * 2 - Math.PI / 2
    out[i * 2] = Math.cos(a) * R
    out[i * 2 + 1] = Math.sin(a) * R
  })
  return out
}

export const FOLDER_PALETTE = ['#BD93F9', '#8BE9FD', '#50FA7B', '#FF79C6', '#FFB86C', '#F1FA8C', '#FF5555', '#6EA8FE'] as const

/** The first folder of a note's path ('' for a note at the top of the vault). */
export function topFolder(id: string): string {
  const i = id.indexOf('/')
  return i < 0 ? '' : id.slice(0, i)
}

export const MAX_FOLDERS = 24

/** The folders that get a colour, biggest first. Colours repeat after the palette runs out, but every folder keeps its own region. */
export function folderLegend(notes: Iterable<BrainNote>, max: number = MAX_FOLDERS): { name: string; color: string; count: number }[] {
  const count = new Map<string, number>()
  for (const n of notes) {
    const f = topFolder(n.id)
    if (f) count.set(f, (count.get(f) ?? 0) + 1)
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, max)
    .map(([name, c], i) => ({ name, color: FOLDER_PALETTE[i % FOLDER_PALETTE.length]!, count: c }))
}

/** Big vaults get smaller dots so the cloud stays readable (about 1.3 for 10 nodes, 0.75 for 1,000, 0.6 for 5,000). */
export function densityScale(nodeCount: number): number {
  return Math.min(1.4, Math.max(0.55, 1.6 - 0.28 * Math.log10(Math.max(10, nodeCount))))
}

/** Resolves a link target as written in a note to a note id, the way the collector does (name, path suffix, alias). */
export function resolveNoteId(notes: Iterable<BrainNote>, target: string): string | null {
  let t = target.trim().toLowerCase().replaceAll('\\', '/').replace(/^\/+/, '')
  if (t.endsWith('.md')) t = t.slice(0, -3)
  if (!t) return null
  const list = [...notes]
  const shortest = (ids: string[]): string | null => (ids.length === 0 ? null : ids.sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0]!)
  const low = (n: BrainNote): string => n.id.slice(0, -3).toLowerCase()
  if (t.includes('/')) {
    return shortest(list.filter((n) => low(n) === t || low(n).endsWith('/' + t)).map((n) => n.id))
  }
  return (
    shortest(list.filter((n) => low(n).split('/').pop() === t).map((n) => n.id)) ??
    shortest(list.filter((n) => n.aliases.some((a) => a.toLowerCase() === t)).map((n) => n.id))
  )
}
