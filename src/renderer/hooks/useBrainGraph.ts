import { useMemo } from 'react'
import type { Forces } from '../graph/layoutTypes'
import type { GraphStyle } from '../graph/renderer'
import { buildGraph, type Graph } from '../lib/brain/graphModel'
import { useBrain } from '../stores/brain'
import { useUi } from '../stores/ui'

/** The graph that the current notes, filters and settings add up to, with its drawing style and force values. */
export function useBrainGraph(opts: { plain?: boolean } = {}): { graph: Graph; style: GraphStyle; forces: Forces } {
  const notes = useBrain((s) => s.notes)
  const search = useBrain((s) => s.search)
  const local = useBrain((s) => s.local)
  const g = useUi((s) => s.settings['brain.graph'])
  const plain = opts.plain === true

  const graph = useMemo(
    () =>
      buildGraph(notes.values(), {
        search: plain ? '' : search,
        showTags: g.showTags,
        showAttachments: g.showAttachments,
        existingOnly: g.existingOnly,
        showOrphans: g.showOrphans,
        groups: g.groups,
        local: plain ? null : local
      }),
    [notes, plain, search, local, g.showTags, g.showAttachments, g.existingOnly, g.showOrphans, g.groups]
  )
  const style = useMemo<GraphStyle>(
    () => ({ nodeSize: g.nodeSize, linkWidth: g.linkWidth, arrows: g.arrows, labelFade: g.labelFade, groupColors: g.groups.map((x) => x.color) }),
    [g.nodeSize, g.linkWidth, g.arrows, g.labelFade, g.groups]
  )
  const forces = useMemo<Forces>(() => ({ center: g.centerForce, repel: g.repelForce, link: g.linkForce, distance: g.linkDistance }), [g.centerForce, g.repelForce, g.linkForce, g.linkDistance])
  return { graph, style, forces }
}
