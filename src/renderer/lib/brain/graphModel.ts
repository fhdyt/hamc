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
  local: { id: string; depth: number } | null
}

export const tagId = (t: string): string => `tag:${t.toLowerCase()}`
export const ghostId = (n: string): string => `ghost:${n.toLowerCase()}`
export const fileId = (n: string): string => `file:${n.toLowerCase()}`

export interface ParsedQuery {
  tags: string[]
  paths: string[]
  words: string[]
}

/** `tag:#x`, `path:folder` and plain words; every part must match. */
export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { tags: [], paths: [], words: [] }
  for (const raw of q.trim().toLowerCase().split(/\s+/)) {
    if (!raw) continue
    if (raw.startsWith('tag:')) {
      const t = raw.slice(4).replace(/^#/, '')
      if (t) out.tags.push(t)
    } else if (raw.startsWith('path:')) {
      const p = raw.slice(5)
      if (p) out.paths.push(p)
    } else out.words.push(raw)
  }
  return out
}

export const isEmptyQuery = (p: ParsedQuery): boolean => p.tags.length + p.paths.length + p.words.length === 0

export function matchesQuery(n: BrainNote, p: ParsedQuery): boolean {
  if (isEmptyQuery(p)) return false
  const id = n.id.toLowerCase()
  const title = n.title.toLowerCase()
  const tags = n.tags.map((t) => t.toLowerCase())
  return (
    p.tags.every((t) => tags.some((x) => x === t || x.startsWith(t + '/'))) &&
    p.paths.every((x) => id.includes(x)) &&
    p.words.every((w) => title.includes(w) || id.includes(w) || n.aliases.some((a) => a.toLowerCase().includes(w)))
  )
}

export const DEFAULT_OPTIONS: GraphOptions = {
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
        addNode({ id: ghostId(g), label: g, kind: 'ghost', mtime: 0 })
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
    if (r.note) group = groupQueries.findIndex((q) => matchesQuery(r.note!, q))
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

/** Node radius in pixels at zoom 1: grows with the square root of the connections. */
export function nodeRadius(degree: number, scale: number): number {
  return Math.min(22, (3 + Math.sqrt(degree) * 1.6) * scale)
}
