import { z } from 'zod'

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface BrainGroup {
  id: string
  query: string
  color: string
}

export interface BrainGraphSettings {
  showTags: boolean
  showAttachments: boolean
  existingOnly: boolean
  showOrphans: boolean
  groups: BrainGroup[]
  arrows: boolean
  /** Zoom level above which labels start to show (0 shows them early, 1 only when zoomed in). */
  labelFade: number
  nodeSize: number
  linkWidth: number
  centerForce: number
  repelForce: number
  linkForce: number
  linkDistance: number
  controlsOpen: boolean
  previewOpen: boolean
}

export const BRAIN_GRAPH_DEFAULTS: BrainGraphSettings = {
  showTags: false,
  showAttachments: false,
  existingOnly: false,
  showOrphans: true,
  groups: [],
  arrows: false,
  labelFade: 0.5,
  nodeSize: 1,
  linkWidth: 1,
  centerForce: 0.3,
  repelForce: 0.5,
  linkForce: 0.5,
  linkDistance: 0.4,
  controlsOpen: true,
  previewOpen: true
}

export interface SettingsMap {
  'ui.zoom': number
  'ui.density': 'compact' | 'comfortable'
  'ui.reduceMotion': boolean
  'ui.sidebarCollapsed': boolean
  'agents.panelCollapsed': boolean
  'dashboard.cronOpen': boolean
  'brain.graph': BrainGraphSettings
  'window.bounds': WindowBounds | null
}

export const SETTINGS_DEFAULTS: SettingsMap = {
  'ui.zoom': 1,
  'ui.density': 'compact',
  'ui.reduceMotion': false,
  'ui.sidebarCollapsed': false,
  'agents.panelCollapsed': false,
  'dashboard.cronOpen': true,
  'brain.graph': BRAIN_GRAPH_DEFAULTS,
  'window.bounds': null
}

export const SETTINGS_SCHEMA = {
  'ui.zoom': z.number().min(0.7).max(1.5),
  'ui.density': z.enum(['compact', 'comfortable']),
  'ui.reduceMotion': z.boolean(),
  'ui.sidebarCollapsed': z.boolean(),
  'agents.panelCollapsed': z.boolean(),
  'dashboard.cronOpen': z.boolean(),
  'brain.graph': z.object({
    showTags: z.boolean(),
    showAttachments: z.boolean(),
    existingOnly: z.boolean(),
    showOrphans: z.boolean(),
    groups: z.array(z.object({ id: z.string().max(40), query: z.string().max(200), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).max(12),
    arrows: z.boolean(),
    labelFade: z.number().min(0).max(1),
    nodeSize: z.number().min(0.3).max(3),
    linkWidth: z.number().min(0.3).max(4),
    centerForce: z.number().min(0).max(1),
    repelForce: z.number().min(0).max(1),
    linkForce: z.number().min(0).max(1),
    linkDistance: z.number().min(0).max(1),
    controlsOpen: z.boolean(),
    previewOpen: z.boolean()
  }),
  'window.bounds': z
    .object({ x: z.number().optional(), y: z.number().optional(), width: z.number(), height: z.number() })
    .nullable()
} satisfies { [K in keyof SettingsMap]: z.ZodType<SettingsMap[K]> }

export function isSettingKey(k: string): k is keyof SettingsMap {
  return Object.prototype.hasOwnProperty.call(SETTINGS_SCHEMA, k)
}
