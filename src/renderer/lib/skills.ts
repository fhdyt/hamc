import { commandPreview, skillActionArgs, validHubId, type SkillAction } from '@shared/skills'
import type { Skill, SkillLedgerEntry } from '@shared/events'

export type SkillKind = 'all' | 'active' | 'agent' | 'hub' | 'bundled' | 'stale' | 'archived'

export const KINDS: { id: Exclude<SkillKind, 'all'>; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'agent', label: 'Agent-written' },
  { id: 'hub', label: 'Hub' },
  { id: 'bundled', label: 'Bundled' },
  { id: 'stale', label: 'Stale' },
  { id: 'archived', label: 'Archived' }
]

export const skillKey = (s: Pick<Skill, 'profile' | 'path'>): string => `${s.profile}:${s.path}`

export function matchesKind(s: Skill, kind: SkillKind): boolean {
  switch (kind) {
    case 'all':
      return true
    case 'active':
    case 'stale':
    case 'archived':
      return s.state === kind
    default:
      return s.origin === kind
  }
}

const norm = (t: string): string => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

export function matchesQuery(s: Skill, q: string): boolean {
  const words = norm(q).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = norm([s.name, s.category, s.description, ...s.tags].join(' '))
  return words.every((w) => hay.includes(w))
}

export const byAgent = (skills: readonly Skill[], agent: string): Skill[] => (agent === 'all' ? [...skills] : skills.filter((s) => s.profile === agent))

export function kindCounts(skills: readonly Skill[]): Record<Exclude<SkillKind, 'all'>, number> {
  const out = { active: 0, agent: 0, hub: 0, bundled: 0, stale: 0, archived: 0 }
  for (const s of skills) for (const k of KINDS) if (matchesKind(s, k.id)) out[k.id]++
  return out
}

const STATE_ORDER = { active: 0, stale: 1, archived: 2 } as const

/** Pinned first, then active before stale before archived, then the most recently used, then by name. */
export function sortSkills(skills: readonly Skill[]): Skill[] {
  return [...skills].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      (b.lastUsedAt ?? -1) - (a.lastUsedAt ?? -1) ||
      a.name.localeCompare(b.name) ||
      a.profile.localeCompare(b.profile)
  )
}

export function filterSkills(skills: readonly Skill[], f: { agent: string; kind: SkillKind; q: string }): Skill[] {
  return sortSkills(byAgent(skills, f.agent).filter((s) => matchesKind(s, f.kind) && matchesQuery(s, f.q)))
}

export const ORIGIN_LABEL: Record<Skill['origin'], string> = { agent: 'agent-written', hub: 'from hub', bundled: 'bundled' }
export const ORIGIN_COLOR: Record<Skill['origin'], string> = { agent: '#FFB86C', hub: '#8BE9FD', bundled: '#A9B2D3' }
export const STATE_COLOR: Record<Skill['state'], string> = { active: '#50FA7B', stale: '#F1FA8C', archived: '#8B95BD' }

/** Why pin and archive are not offered, or null when they are (F-SKILL-4). */
export function curateBlock(s: Skill): string | null {
  if (s.origin === 'bundled') return 'Bundled skills are updated together with Hermes, so there is nothing to pin or archive here.'
  if (s.origin === 'hub') return 'Hub skills are managed with `hermes skills` (update, uninstall); the curator never touches them.'
  return null
}

export interface SkillAskView {
  title: string
  body: string
  confirm: string
  command: string | null
}

export function askView(action: Exclude<SkillAction, 'install'>, s: Skill): SkillAskView {
  const command = commandPreview(skillActionArgs({ action, profile: s.profile, name: s.name }))
  const n = `“${s.name}”`
  switch (action) {
    case 'pin':
      return { title: `Pin ${n}?`, body: 'The curator will never mark it stale or archive it on its own.', confirm: 'Pin skill', command }
    case 'unpin':
      return { title: `Unpin ${n}?`, body: 'The curator may mark it stale and later archive it when it stays unused.', confirm: 'Unpin skill', command }
    case 'archive':
      return {
        title: `Archive ${n}?`,
        body: 'Hermes moves it to skills/.archive/ and stops offering it to the agent. Restore brings it back.',
        confirm: 'Archive skill',
        command
      }
    case 'restore':
      return { title: `Restore ${n}?`, body: 'Hermes moves it back into the skills folder (at the top level) and offers it again.', confirm: 'Restore skill', command }
  }
}

/** `3h ago`, `2d ago`, `never`. */
export function ago(ts: number | null, nowS: number): string {
  if (ts === null) return 'never'
  const s = Math.max(0, nowS - ts)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const day = (ts: number | null): string =>
  ts === null ? '—' : new Date(ts * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

/** Facts of the detail panel (F-SKILL-3): frontmatter, then the usage record. */
export function facts(s: Skill): [string, string][] {
  const rows: [string, string][] = [
    ['version', s.version ?? '—'],
    ['author', s.author ?? '—'],
    ['platforms', s.platforms.join(', ') || '—'],
    ['tags', s.tags.join(', ') || '—'],
    ['requires toolsets', s.requiresToolsets.join(', ') || '—'],
    ['created by', s.createdBy ?? '—'],
    ['state', s.state + (s.pinned ? ' · pinned' : '')],
    ['uses', String(s.useCount)],
    ['views', String(s.viewCount)],
    ['patches', String(s.patchCount)],
    ['created', day(s.createdAt)],
    ['last used', day(s.lastUsedAt)],
    ['last patched', day(s.lastPatchedAt)]
  ]
  if (s.state === 'archived') rows.push(['archived', day(s.archivedAt)])
  return rows
}

export function summary(skills: readonly Skill[]): string {
  const c = kindCounts(skills)
  return `${skills.length} skill${skills.length === 1 ? '' : 's'} · ${c.agent} agent-written · ${c.stale} stale · ${c.archived} archived`
}

export const ACTOR_COLOR: Record<string, string> = { agent: '#FFB86C', curator: '#BD93F9', user: '#8BE9FD' }

/** The SKILL.md change of a ledger entry that can be shown as a diff: both blobs, or one side for a create/delete. */
export function ledgerDiffFile(e: SkillLedgerEntry): { path: string; before: string | null; after: string | null } | null {
  const md = e.files.find((f) => f.path.endsWith('SKILL.md') && (f.before || f.after))
  return md ?? e.files.find((f) => f.before || f.after) ?? null
}

/** Ledger entries of several profiles, newest first. */
export function mergeLedgers(lists: readonly { profile: string; entries: readonly SkillLedgerEntry[] }[]): (SkillLedgerEntry & { profile: string })[] {
  return lists
    .flatMap((l) => l.entries.map((e) => ({ ...e, profile: l.profile })))
    .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0) || a.id.localeCompare(b.id))
}

export function installProblem(id: string): string | null {
  const t = id.trim()
  if (!t) return 'Enter a skill id or an https URL.'
  if (t !== id) return 'Remove the spaces at the start or end.'
  if (/^http:\/\//i.test(t)) return 'Use an https URL.'
  return validHubId(t) ? null : 'Use a hub id like owner/repo/skill or an https URL, without spaces or quotes.'
}
