import { useMemo } from 'react'
import type { Forces } from '../graph/layoutTypes'
import type { GraphStyle } from '../graph/renderer'
import { buildGraph, folderLegend, type Graph } from '../lib/brain/graphModel'
import { effectiveGraph } from '../lib/brain/obsidianGraph'
import { useBrain } from '../stores/brain'
import { useUi } from '../stores/ui'

const LEGEND_MAX = 8

export interface LegendItem {
  label: string
  color: string
}

/** The graph that the current notes, filters and settings add up to, with its drawing style, force values and colour legend. */
export function useBrainGraph(opts: { plain?: boolean } = {}): { graph: Graph; style: GraphStyle; forces: Forces; legend: LegendItem[] } {
  const notes = useBrain((s) => s.notes)
  const search = useBrain((s) => s.search)
  const local = useBrain((s) => s.local)
  const own = useUi((s) => s.settings['brain.graph'])
  const obsidian = useBrain((s) => s.obsidian)
  // F-BRAIN-10: the vault's .obsidian/graph.json wins for the fields it sets, its groups come after the app's
  const eff = useMemo(() => effectiveGraph(own, obsidian.state === 'ok' ? obsidian.graph : null, own.useObsidian), [own, obsidian])
  const g = eff.settings
  const groups = useMemo(() => [...g.groups, ...eff.obsidianGroups], [g.groups, eff.obsidianGroups])
  const reduceMotion = useUi((s) => s.settings['ui.reduceMotion'])
  const plain = opts.plain === true

  const folders = useMemo(() => (g.colorByFolder ? folderLegend(notes.values()) : []), [notes, g.colorByFolder])
  const graph = useMemo(
    () =>
      buildGraph(notes.values(), {
        search: plain ? '' : search,
        showTags: g.showTags,
        showAttachments: g.showAttachments,
        existingOnly: g.existingOnly,
        showOrphans: g.showOrphans,
        groups,
        folders: folders.map((f) => f.name),
        local: plain ? null : local
      }),
    [notes, plain, search, local, g.showTags, g.showAttachments, g.existingOnly, g.showOrphans, groups, folders]
  )
  const colors = useMemo(() => [...groups.map((x) => x.color), ...folders.map((f) => f.color)], [groups, folders])
  const style = useMemo<GraphStyle>(
    () => ({ nodeSize: g.nodeSize, linkWidth: g.linkWidth, labelFade: g.labelFade, groupColors: colors, motion: !reduceMotion }),
    [g.nodeSize, g.linkWidth, g.labelFade, colors, reduceMotion]
  )
  const forces = useMemo<Forces>(() => ({ center: g.centerForce, repel: g.repelForce, link: g.linkForce, distance: g.linkDistance }), [g.centerForce, g.repelForce, g.linkForce, g.linkDistance])
  const legend = useMemo<LegendItem[]>(() => {
    const items = [...groups.filter((x) => x.query.trim()).map((x) => ({ label: x.query.trim(), color: x.color })), ...folders.map((f) => ({ label: f.name, color: f.color }))]
    return items.length > LEGEND_MAX ? [...items.slice(0, LEGEND_MAX), { label: `+${items.length - LEGEND_MAX} more`, color: '#6272A4' }] : items
  }, [groups, folders])
  return { graph, style, forces, legend }
}
