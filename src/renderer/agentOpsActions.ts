import type { OpsText, ToolChange } from '@shared/agentOps'
import { toggleChange } from './lib/agentOps'
import { useAgentOps, type OpsEntry } from './stores/agentOps'

const ERR = { 'bad-input': 'Mission Control refused the request.', 'not-connected': 'Not connected to the server.', failed: 'Hermes answered with an error.' } as const
const entry = (r: OpsText): OpsEntry => (r.ok ? { status: 'ok', text: r.text } : { status: 'error', message: r.detail ? `${ERR[r.error]} ${r.detail}` : ERR[r.error] })
const st = useAgentOps.getState

export async function loadMcp(profile: string): Promise<void> {
  st().set({ mcp: { ...st().mcp, [profile]: { status: 'loading' } } })
  const r = await window.mc.ops.mcpList(profile)
  st().set({ mcp: { ...st().mcp, [profile]: entry(r) } })
}

/** `hermes mcp test <name>` after the confirm: it starts the server once. */
export async function testMcp(): Promise<void> {
  const ask = st().mcpAsk
  if (!ask) return
  const key = `${ask.profile}:${ask.name}`
  st().set({ mcpAsk: null, mcpTest: { ...st().mcpTest, [key]: { status: 'loading' } } })
  const r = await window.mc.ops.mcpTest(ask.profile, ask.name)
  st().set({ mcpTest: { ...st().mcpTest, [key]: r.ok ? entry(r) : { status: 'error', message: r.detail ?? ERR[r.error] } } })
}

export async function loadFallback(profile: string): Promise<void> {
  st().set({ fallback: { ...st().fallback, [profile]: { status: 'loading' } } })
  const r = await window.mc.ops.fallbackList(profile)
  st().set({ fallback: { ...st().fallback, [profile]: entry(r) } })
}

export async function loadTools(profile: string, platforms: string[]): Promise<void> {
  st().set({ tools: { ...st().tools, [profile]: Object.fromEntries(platforms.map((p) => [p, { status: 'loading' } as OpsEntry])) } })
  const r = await window.mc.ops.toolsList(profile, platforms)
  st().set({ tools: { ...st().tools, [profile]: Object.fromEntries(platforms.map((p) => [p, r[p] ? entry(r[p]!) : ({ status: 'error', message: 'No answer.' } as OpsEntry)])) } })
}

export function toggleTool(profile: string, toolset: string, platform: string, serverEnabled: boolean): void {
  const changes = toggleChange(st().changes[profile] ?? [], toolset, platform, serverEnabled)
  st().set({ changes: { ...st().changes, [profile]: changes } })
}

export const discardTools = (profile: string): void => st().set({ changes: { ...st().changes, [profile]: [] }, applyAsk: null })

/** Runs the held changes one command at a time, then reads the matrix again. */
export async function applyTools(profile: string, platforms: string[]): Promise<void> {
  const changes: ToolChange[] = st().changes[profile] ?? []
  if (changes.length === 0) return
  st().set({ applyAsk: null, applying: profile })
  const r = await window.mc.ops.toolsApply(profile, changes)
  st().set({ applying: null, applied: { ...st().applied, [profile]: r.ok ? r.results : { error: ERR[r.error] } }, changes: { ...st().changes, [profile]: [] } })
  await loadTools(profile, platforms)
}

export async function runBackup(profile: string): Promise<void> {
  const b = st().backup
  st().set({ backup: { ...b, busy: true, result: null } })
  const result = await window.mc.ops.backup({ profile, includeStateDb: b.includeStateDb })
  st().set({ backup: { ...st().backup, busy: false, result } })
}

export async function createProfile(): Promise<void> {
  const f = st().newProfile
  st().set({ newProfile: { ...f, busy: true, confirm: false, result: null } })
  const r = await window.mc.ops.profileCreate({
    name: f.name,
    ...(f.description.trim() ? { description: f.description.trim() } : {}),
    ...(f.cloneFrom ? { cloneFrom: f.cloneFrom } : {}),
    noSkills: f.noSkills,
    alias: f.alias
  })
  st().set({ newProfile: { ...st().newProfile, busy: false, result: r.ok ? { ok: true, text: r.text.trim() || `Created ${f.name}.` } : { ok: false, text: r.detail ?? ERR[r.error] } } })
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
