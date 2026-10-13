/** The skill writes of the app (F-SKILL-4/5). Nothing else is ever sent to `hermes curator` or `hermes skills`. */
export const SKILL_ACTIONS = ['pin', 'unpin', 'archive', 'restore', 'install'] as const
export type SkillAction = (typeof SKILL_ACTIONS)[number]

export interface SkillActionRequest {
  action: SkillAction
  profile: string
  /** The skill name (pin, unpin, archive, restore). */
  name?: string
  /** The hub identifier or https URL (install). */
  id?: string
  /** Category folder to install into (install, optional). */
  category?: string
}

export type SkillActionError = 'bad-input' | 'not-connected' | 'failed'
export type SkillActionResult = { ok: true; output: string } | { ok: false; error: SkillActionError; detail?: string }

/** Raw text of a read-only command (`skills inspect`, `curator status`); parsed loosely by the renderer. */
export type SkillTextResult = { ok: true; text: string } | { ok: false; error: SkillActionError; detail?: string }

export const PROFILE_RE = /^[A-Za-z0-9._-]{1,64}$/
export const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
export const HUB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/
export const HUB_URL_RE = /^https:\/\/[^\s"'`\\]{1,300}$/
export const CATEGORY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
/** A skill folder relative to skills/ as the collector lists it. */
export const SKILL_PATH_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+){0,9}$/
export const SHA_RE = /^[0-9a-f]{64}$/

const okProfile = (p: string): boolean => PROFILE_RE.test(p) && p !== '.' && p !== '..'
export const validHubId = (id: unknown): id is string =>
  typeof id === 'string' && ((HUB_ID_RE.test(id) && !id.includes('://')) || HUB_URL_RE.test(id)) && !id.split('/').includes('..')
export const validSkillPath = (p: unknown): p is string => typeof p === 'string' && SKILL_PATH_RE.test(p) && !p.split('/').some((x) => x === '.' || x === '..')

const profileArgs = (p: string): string[] => (p === 'default' ? [] : ['-p', p])

/**
 * The arguments after `hermes` for one skill write, or null. Install always carries `--yes`: Hermes asks
 * `Confirm [y/N]` on stdin and a non-interactive answer is "no", so the app's own confirm (with the inspect output)
 * takes its place. Hermes's safety scan still blocks; `--force` is never added.
 */
export function skillActionArgs(r: SkillActionRequest): string[] | null {
  if (!okProfile(r.profile)) return null
  const p = profileArgs(r.profile)
  switch (r.action) {
    case 'pin':
    case 'unpin':
    case 'archive':
    case 'restore':
      return typeof r.name === 'string' && SKILL_NAME_RE.test(r.name) ? [...p, 'curator', r.action, r.name] : null
    case 'install': {
      if (!validHubId(r.id)) return null
      if (r.category !== undefined && r.category !== '' && !CATEGORY_RE.test(r.category)) return null
      return [...p, 'skills', 'install', r.id, ...(r.category ? ['--category', r.category] : []), '--yes']
    }
    default:
      return null
  }
}

/** `skills inspect <id>`: read-only, shown before an install. */
export function skillInspectArgs(profile: string, id: string): string[] | null {
  return okProfile(profile) && validHubId(id) ? [...profileArgs(profile), 'skills', 'inspect', id] : null
}

export const curatorStatusArgs = (profile: string): string[] | null => (okProfile(profile) ? [...profileArgs(profile), 'curator', 'status'] : null)

const quote = (a: string): string => (/^[A-Za-z0-9._:/=@%+-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)
export const commandPreview = (args: string[] | null): string | null => (args ? `$ hermes ${args.map(quote).join(' ')}` : null)
