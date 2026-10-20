import type { ObsidianGraph } from '@shared/events'
import type { BrainGraphSettings, BrainGroup } from '@shared/settings'

/** F-BRAIN-10: the vault's `.obsidian/graph.json` drawn with the app's own graph settings. Pure. */

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const hex = (rgb: number): string => `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`

/** Obsidian colour groups as read-only groups (ids `obs-<i>`); empty queries are dropped. */
export function toGroups(groups: ObsidianGraph['colorGroups']): BrainGroup[] {
  return (groups ?? []).flatMap((g, i) => (g.query.trim() ? [{ id: `obs-${i}`, query: g.query, color: hex(g.color.rgb) }] : []))
}

type Followable = Exclude<keyof BrainGraphSettings, 'groups' | 'colorByFolder' | 'controlsOpen' | 'previewOpen' | 'useObsidian'>

/** The app settings Obsidian sets, on the app's slider scales (Obsidian: repel 0-20, distance 30-500, fade -3..3). */
export function toSettings(g: ObsidianGraph): Partial<Pick<BrainGraphSettings, Followable>> {
  const out: Partial<Pick<BrainGraphSettings, Followable>> = {}
  if (g.showTags !== undefined) out.showTags = g.showTags
  if (g.showAttachments !== undefined) out.showAttachments = g.showAttachments
  if (g.hideUnresolved !== undefined) out.existingOnly = g.hideUnresolved
  if (g.showOrphans !== undefined) out.showOrphans = g.showOrphans
  if (g.centerStrength !== undefined) out.centerForce = clamp(g.centerStrength, 0, 1)
  if (g.repelStrength !== undefined) out.repelForce = clamp(g.repelStrength / 20, 0, 1)
  if (g.linkStrength !== undefined) out.linkForce = clamp(g.linkStrength, 0, 1)
  if (g.linkDistance !== undefined) out.linkDistance = clamp((g.linkDistance - 30) / 470, 0, 1)
  if (g.nodeSizeMultiplier !== undefined) out.nodeSize = clamp(g.nodeSizeMultiplier, 0.3, 3)
  if (g.lineSizeMultiplier !== undefined) out.linkWidth = clamp(g.lineSizeMultiplier, 0.3, 4)
  if (g.textFadeMultiplier !== undefined) out.labelFade = clamp((g.textFadeMultiplier + 3) / 6, 0, 1)
  return out
}

export interface EffectiveGraph {
  /** What to draw: the app's settings with the followed fields replaced. */
  settings: BrainGraphSettings
  /** Obsidian's colour groups, after the app's own groups. */
  obsidianGroups: BrainGroup[]
  /** Fields that come from graph.json (their controls are read-only). */
  followed: Followable[]
}

export function effectiveGraph(own: BrainGraphSettings, obsidian: ObsidianGraph | null, on: boolean): EffectiveGraph {
  if (!on || !obsidian) return { settings: own, obsidianGroups: [], followed: [] }
  const patch = toSettings(obsidian)
  return { settings: { ...own, ...patch }, obsidianGroups: toGroups(obsidian.colorGroups), followed: Object.keys(patch) as Followable[] }
}
