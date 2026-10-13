/**
 * The commands of Settings → Agents → MCP, Toolsets, Fallback and New profile (F-CFG-19..26). One builder serves the
 * preview and the run; the main process prepends the real hermes path.
 */

export const PROFILE_RE = /^[A-Za-z0-9._-]{1,64}$/
export const NEW_PROFILE_RE = /^[a-z][a-z0-9-]{1,23}$/
export const MCP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const TOOLSET_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
export const PLATFORM_RE = /^[a-z][a-z0-9_]{0,31}$/
export const DESCRIPTION_MAX = 300

const okProfile = (p: string): boolean => PROFILE_RE.test(p) && p !== '.' && p !== '..'
const pre = (p: string): string[] => (p === 'default' ? [] : ['-p', p])

export const validDescription = (d: unknown): d is string =>
  // eslint-disable-next-line no-control-regex
  typeof d === 'string' && d.length <= DESCRIPTION_MAX && !/[\u0000-\u001f\u007f]/.test(d)

export const mcpListArgs = (p: string): string[] | null => (okProfile(p) ? [...pre(p), 'mcp', 'list'] : null)
export const mcpTestArgs = (p: string, name: string): string[] | null => (okProfile(p) && MCP_NAME_RE.test(name) ? [...pre(p), 'mcp', 'test', name] : null)
export const fallbackListArgs = (p: string): string[] | null => (okProfile(p) ? [...pre(p), 'fallback', 'list'] : null)
export const toolsListArgs = (p: string, platform: string): string[] | null =>
  okProfile(p) && PLATFORM_RE.test(platform) ? [...pre(p), 'tools', 'list', '--platform', platform] : null

export interface ToolChange {
  toolset: string
  platform: string
  enable: boolean
}

/** One command per action and platform, in a stable order: disables first, then enables. */
export function toolsApplyArgs(p: string, changes: readonly ToolChange[]): string[][] | null {
  if (!okProfile(p) || changes.length === 0 || changes.length > 200) return null
  if (!changes.every((c) => TOOLSET_RE.test(c.toolset) && PLATFORM_RE.test(c.platform))) return null
  const groups = new Map<string, string[]>()
  for (const c of changes) {
    const key = `${c.enable ? 'b' : 'a'}|${c.platform}`
    const list = groups.get(key) ?? []
    if (!list.includes(c.toolset)) list.push(c.toolset)
    groups.set(key, list)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, names]) => {
      const [kind, platform] = key.split('|') as [string, string]
      return [...pre(p), 'tools', kind === 'b' ? 'enable' : 'disable', ...names, '--platform', platform]
    })
}

export interface NewProfileRequest {
  name: string
  description?: string
  /** An existing profile to copy (`--clone-from`); empty for a blank profile. */
  cloneFrom?: string
  noSkills: boolean
  /** Let Hermes write its wrapper script (`~/.local/bin/<name>`); off adds `--no-alias`. */
  alias: boolean
}

export function profileCreateArgs(r: NewProfileRequest): string[] | null {
  if (!NEW_PROFILE_RE.test(r.name) || r.name === 'default') return null
  if (r.description !== undefined && !validDescription(r.description)) return null
  if (r.cloneFrom && !okProfile(r.cloneFrom)) return null
  const desc = r.description?.trim()
  return [
    'profile',
    'create',
    r.name,
    ...(desc ? [`--description=${desc}`] : []),
    ...(r.cloneFrom ? ['--clone-from', r.cloneFrom] : []),
    ...(r.noSkills ? ['--no-skills'] : []),
    ...(r.alias ? [] : ['--no-alias'])
  ]
}

/** Commands the user runs in their own terminal (copied, never run by the app: F-CFG-26). */
export const terminalCommands = (p: string) => ({
  mcpAdd: `hermes ${[...pre(p), 'mcp', 'add', '<name>', '--url', '<endpoint>'].join(' ')}`,
  mcpRemove: (name: string) => `hermes ${[...pre(p), 'mcp', 'remove', name].join(' ')}`,
  fallbackAdd: `hermes ${[...pre(p), 'fallback', 'add'].join(' ')}`,
  fallbackRemove: `hermes ${[...pre(p), 'fallback', 'remove'].join(' ')}`
})

const quote = (a: string): string => (/^[A-Za-z0-9._:/=@%+-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)
export const preview = (args: string[] | null): string | null => (args ? `$ hermes ${args.map(quote).join(' ')}` : null)

export type OpsText = { ok: true; text: string } | { ok: false; error: 'bad-input' | 'not-connected' | 'failed'; detail?: string }
export type OpsApply = { ok: true; results: { command: string; ok: boolean; output: string }[] } | { ok: false; error: 'bad-input' | 'not-connected' }

export interface BackupRequest {
  profile: string
  includeStateDb: boolean
}
export type BackupResult = { saved: string; files: number; bytes: number; skipped: string[] } | { canceled: true } | { failed: string }
