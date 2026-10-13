import { z } from 'zod'
import { InteractionKind } from './events'
import { DEFAULT_LOG_LEVELS, LOG_LEVELS, LOG_RANGES, type LogLevel, type LogRange } from './logs'

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface AgentGraphSettings {
  kinds: z.infer<typeof InteractionKind>[]
  range: '1h' | '24h' | '7d'
}

export const AGENT_GRAPH_DEFAULTS: AgentGraphSettings = { kinds: ['kanban', 'message', 'room', 'delegate'], range: '24h' }

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
  /** Colour notes by their top-level folder (user groups still win). */
  colorByFolder: boolean
  groups: BrainGroup[]
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
  colorByFolder: true,
  groups: [],
  labelFade: 0.5,
  nodeSize: 1,
  linkWidth: 1,
  centerForce: 0.47,
  repelForce: 0.32,
  linkForce: 0.5,
  linkDistance: 0.25,
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
  'chat.uploadDir': string
  'chat.maxUploadMb': number
  /** Chat through `hermes acp` when the server has it, so Hermes can ask before risky actions. */
  'chat.useAcp': boolean
  'dashboard.activityOpen': boolean
  'dashboard.serverOpen': boolean
  'dashboard.chatW': number
  'dashboard.cronH': number
  'dashboard.rosterH': number
  'dashboard.activityTab': 'activity' | 'alerts'
  /** Which graph the Dashboard graph panel shows. */
  'dashboard.graphTab': 'brain' | 'agents'
  /** Kinds and time range of the agent interaction graph. */
  'dashboard.agentGraph': AgentGraphSettings
  'brain.graph': BrainGraphSettings
  /** Agent and time range shared by Sessions, Usage, Logs and Skills (F-NAV-8). `all` or a profile name. */
  'filters.agent': string
  'filters.range': 'today' | '7d' | '14d' | '30d' | 'all'
  /** The daily cost alert (F-SHELL-5): on or off, and the USD per local day that all agents together must pass. */
  'alerts.cost.enabled': boolean
  'alerts.cost.usd': number
  /** Notify when an agent's gateway stops or a platform fails. */
  'alerts.gateway.enabled': boolean
  /** Logs screen: levels shown (DEBUG off by default), time range and line wrap. */
  'logs.levels': LogLevel[]
  'logs.range': LogRange
  'logs.wrap': boolean
  /** The Kanban board open in the Kanban screen: `default` or the folder name under kanban/boards. */
  'kanban.board': string
  'window.bounds': WindowBounds | null
}

export const SETTINGS_DEFAULTS: SettingsMap = {
  'ui.zoom': 1,
  'ui.density': 'compact',
  'ui.reduceMotion': false,
  'ui.sidebarCollapsed': false,
  'agents.panelCollapsed': false,
  'dashboard.cronOpen': true,
  'chat.uploadDir': '~/hermes-uploads',
  'chat.maxUploadMb': 50,
  'chat.useAcp': true,
  'dashboard.activityOpen': true,
  'dashboard.serverOpen': true,
  'dashboard.chatW': 320,
  'dashboard.cronH': 200,
  'dashboard.rosterH': 150,
  'dashboard.activityTab': 'activity',
  'dashboard.graphTab': 'brain',
  'dashboard.agentGraph': AGENT_GRAPH_DEFAULTS,
  'brain.graph': BRAIN_GRAPH_DEFAULTS,
  'filters.agent': 'all',
  'filters.range': '7d',
  'alerts.cost.enabled': false,
  'alerts.cost.usd': 10,
  'alerts.gateway.enabled': true,
  'logs.levels': DEFAULT_LOG_LEVELS,
  'logs.range': '24h',
  'logs.wrap': false,
  'kanban.board': 'default',
  'window.bounds': null
}

export const SETTINGS_SCHEMA = {
  'ui.zoom': z.number().min(0.7).max(1.5),
  'ui.density': z.enum(['compact', 'comfortable']),
  'ui.reduceMotion': z.boolean(),
  'ui.sidebarCollapsed': z.boolean(),
  'agents.panelCollapsed': z.boolean(),
  'dashboard.cronOpen': z.boolean(),
  'chat.uploadDir': z.string().min(1).max(300),
  'chat.maxUploadMb': z.number().int().min(1).max(2048),
  'chat.useAcp': z.boolean(),
  'dashboard.activityOpen': z.boolean(),
  'dashboard.serverOpen': z.boolean(),
  'dashboard.chatW': z.number().min(260).max(640),
  'dashboard.cronH': z.number().min(90).max(560),
  'dashboard.rosterH': z.number().min(60).max(480),
  'dashboard.activityTab': z.enum(['activity', 'alerts']),
  'dashboard.graphTab': z.enum(['brain', 'agents']),
  'dashboard.agentGraph': z.object({ kinds: z.array(InteractionKind).max(4), range: z.enum(['1h', '24h', '7d']) }),
  'brain.graph': z.object({
    showTags: z.boolean(),
    showAttachments: z.boolean(),
    existingOnly: z.boolean(),
    showOrphans: z.boolean(),
    colorByFolder: z.boolean(),
    groups: z.array(z.object({ id: z.string().max(40), query: z.string().max(200), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).max(12),
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
  'filters.agent': z.string().min(1).max(64),
  'filters.range': z.enum(['today', '7d', '14d', '30d', 'all']),
  'alerts.cost.enabled': z.boolean(),
  'alerts.cost.usd': z.number().min(0.01).max(100000),
  'alerts.gateway.enabled': z.boolean(),
  'logs.levels': z.array(z.enum(LOG_LEVELS)).max(6),
  'logs.range': z.enum(LOG_RANGES),
  'logs.wrap': z.boolean(),
  'kanban.board': z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  'window.bounds': z
    .object({ x: z.number().optional(), y: z.number().optional(), width: z.number(), height: z.number() })
    .nullable()
} satisfies { [K in keyof SettingsMap]: z.ZodType<SettingsMap[K]> }

export function isSettingKey(k: string): k is keyof SettingsMap {
  return Object.prototype.hasOwnProperty.call(SETTINGS_SCHEMA, k)
}
