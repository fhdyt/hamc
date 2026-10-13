import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Skill, SkillLedgerEntry } from '@shared/events'
import { ago, askView, curateBlock, facts, filterSkills, installProblem, kindCounts, ledgerDiffFile, mergeLedgers, sortSkills, summary } from '../../src/renderer/lib/skills'
import { askSkillAction, confirmSkillAction, inspectHub, installHub, loadSkills, openInstall, selectSkill, toggleLedgerDiff } from '../../src/renderer/skillsActions'
import { useSkills } from '../../src/renderer/stores/skills'

const skill = (name: string, over: Partial<Skill> = {}): Skill => ({
  profile: 'default', path: `research/${name}`, category: 'research', dir: name, name, description: `About ${name}`, version: null, author: null,
  tags: [], platforms: [], requiresToolsets: [], envNames: [], origin: 'agent', createdBy: 'agent', state: 'active', pinned: false,
  useCount: 0, viewCount: 0, patchCount: 0, createdAt: null, lastUsedAt: null, lastViewedAt: null, lastPatchedAt: null, archivedAt: null,
  size: 10, mtime: 1, ...over
})
const entry = (id: string, ts: number, over: Partial<SkillLedgerEntry> = {}): SkillLedgerEntry => ({ id, ts, actor: 'agent', action: 'patch', skill: 'x', note: null, sessionId: null, files: [], ...over })

const LIB = [
  skill('a', { lastUsedAt: 100, tags: ['Notes'] }),
  skill('b', { pinned: true }),
  skill('c', { state: 'stale', lastUsedAt: 500 }),
  skill('n', { origin: 'bundled', createdBy: null, description: 'Notion API' }),
  skill('h', { origin: 'hub', profile: 'scout' }),
  skill('r', { state: 'archived', path: '.archive/r', category: '' })
]

describe('lib/skills', () => {
  it('filters by agent, kind and words in name, description or tags', () => {
    expect(filterSkills(LIB, { agent: 'all', kind: 'all', q: '' }).map((s) => s.name)).toEqual(['b', 'a', 'h', 'n', 'c', 'r'])
    expect(filterSkills(LIB, { agent: 'scout', kind: 'all', q: '' }).map((s) => s.name)).toEqual(['h'])
    expect(filterSkills(LIB, { agent: 'all', kind: 'agent', q: '' }).map((s) => s.name)).toEqual(['b', 'a', 'c', 'r'])
    expect(filterSkills(LIB, { agent: 'all', kind: 'stale', q: '' }).map((s) => s.name)).toEqual(['c'])
    expect(filterSkills(LIB, { agent: 'all', kind: 'all', q: 'notion' }).map((s) => s.name)).toEqual(['n'])
    expect(filterSkills(LIB, { agent: 'all', kind: 'all', q: 'notes' }).map((s) => s.name)).toEqual(['a'])
  })

  it('counts each kind and sums it up', () => {
    expect(kindCounts(LIB)).toEqual({ active: 4, agent: 4, hub: 1, bundled: 1, stale: 1, archived: 1 })
    expect(summary(LIB)).toBe('6 skills · 4 agent-written · 1 stale · 1 archived')
  })

  it('puts pinned first, then state, then recent use', () => {
    expect(sortSkills([skill('z', { state: 'archived' }), skill('y', { lastUsedAt: 5 }), skill('x', { pinned: true, state: 'stale' })]).map((s) => s.name)).toEqual(['x', 'y', 'z'])
  })

  it('offers curator actions only for agent-written skills, with the exact command', () => {
    expect(curateBlock(skill('n', { origin: 'bundled' }))).toContain('Bundled')
    expect(curateBlock(skill('h', { origin: 'hub' }))).toContain('hermes skills')
    expect(curateBlock(skill('a'))).toBeNull()
    expect(askView('archive', skill('a', { profile: 'scout' })).command).toBe('$ hermes -p scout curator archive a')
    expect(askView('pin', skill('a')).title).toBe('Pin “a”?')
  })

  it('shows facts, ages, ledger diffs and install checks', () => {
    expect(facts(skill('a', { state: 'archived' })).map(([k]) => k)).toContain('archived')
    expect(ago(null, 0)).toBe('never')
    expect(ago(0, 7200)).toBe('2h ago')
    const e = entry('1', 1, { files: [{ path: 'a/x.txt', before: 'b'.repeat(64), after: null }, { path: 'a/SKILL.md', before: null, after: 'a'.repeat(64) }] })
    expect(ledgerDiffFile(e)?.path).toBe('a/SKILL.md')
    expect(ledgerDiffFile(entry('2', 1))).toBeNull()
    expect(mergeLedgers([{ profile: 'a', entries: [entry('1', 5)] }, { profile: 'b', entries: [entry('2', 9)] }]).map((x) => `${x.profile}:${x.id}`)).toEqual(['b:2', 'a:1'])
    expect(installProblem('')).toContain('Enter')
    expect(installProblem('http://x.y/z')).toContain('https')
    expect(installProblem('--force')).toContain('hub id')
    expect(installProblem('official/web/scraper')).toBeNull()
  })
})

type Fn = ReturnType<typeof vi.fn>
function stub(over: Partial<Record<'list' | 'read' | 'ledger' | 'blobs' | 'action' | 'inspect' | 'curatorStatus', Fn>> = {}) {
  let lib = [...LIB]
  const mc = {
    skills: {
      list: vi.fn(async () => ({ ok: true, data: { skills: lib, profiles: [] } })),
      read: vi.fn(async (a: { path: string }) => ({ ok: true, data: { path: a.path, text: '---\nname: x\n---\n# Body', truncated: false, size: 1, mtime: 1 } })),
      ledger: vi.fn(async () => ({ ok: true, data: { profile: 'default', entries: [], exists: true, truncated: false } })),
      blobs: vi.fn(async (a: { shas: string[] }) => ({ ok: true, data: { blobs: a.shas.map((sha) => ({ sha, text: `text ${sha.slice(0, 2)}`, truncated: false })) } })),
      action: vi.fn(async (r: { action: string; name?: string }) => {
        if (r.action === 'archive') lib = lib.map((s) => (s.name === r.name ? { ...s, state: 'archived' as const, path: `.archive/${s.name}` } : s))
        return { ok: true, output: 'done' }
      }),
      inspect: vi.fn(async () => ({ ok: true, text: 'Name: scraper' })),
      curatorStatus: vi.fn(async () => ({ ok: true, text: 'Curator: enabled' })),
      ...over
    }
  }
  vi.stubGlobal('window', { mc })
  return mc
}

beforeEach(() => useSkills.getState().reset())
afterEach(() => vi.unstubAllGlobals())

describe('skills store and actions', () => {
  it('loads the list and the picked SKILL.md once', async () => {
    const mc = stub()
    await loadSkills()
    expect(useSkills.getState()).toMatchObject({ status: 'ok' })
    await selectSkill('default:research/a')
    await selectSkill('default:research/a')
    expect(mc.skills.read).toHaveBeenCalledTimes(1)
    expect(useSkills.getState().docs['default:research/a']).toMatchObject({ status: 'ok' })
  })

  it('keeps the list on a failed quiet refresh and drops stale answers', async () => {
    stub()
    await loadSkills()
    stub({ list: vi.fn(async () => ({ ok: false, error: 'timeout' })) })
    await loadSkills(true)
    expect(useSkills.getState().list?.skills).toHaveLength(6)
    expect(useSkills.getState().status).toBe('error')
  })

  it('archives the picked skill; the selection and the note follow it to .archive/', async () => {
    const mc = stub()
    await loadSkills()
    await selectSkill('default:research/c')
    askSkillAction('archive')
    expect(useSkills.getState().ask).toEqual({ key: 'default:research/c', action: 'archive' })
    await confirmSkillAction()
    expect(mc.skills.action).toHaveBeenCalledWith({ action: 'archive', profile: 'default', name: 'c' })
    const st = useSkills.getState()
    expect(st.selected).toBe('default:.archive/c')
    expect(st.notes['default:.archive/c']).toEqual({ ok: true, title: 'Done', detail: 'done' })
    expect(st.pending).toBeNull()
  })

  it('inspects before installing, installs with the chosen category and reloads', async () => {
    const mc = stub()
    openInstall('scout')
    useSkills.getState().patchInstall({ id: 'official/web/scraper', category: 'web' })
    await inspectHub()
    expect(mc.skills.inspect).toHaveBeenCalledWith('scout', 'official/web/scraper')
    expect(useSkills.getState().install.inspect).toEqual({ status: 'ok', text: 'Name: scraper' })
    await installHub()
    expect(mc.skills.action).toHaveBeenCalledWith({ action: 'install', profile: 'scout', id: 'official/web/scraper', category: 'web' })
    expect(useSkills.getState().install.note).toEqual({ ok: true, title: 'Installed', detail: 'done' })
    expect(mc.skills.list).toHaveBeenCalled()
  })

  it('reads the blobs of a ledger diff once and toggles it', async () => {
    const mc = stub()
    const e = entry('9', 1, { files: [{ path: 'a/SKILL.md', before: 'a'.repeat(64), after: 'b'.repeat(64) }] })
    await toggleLedgerDiff('default', e)
    expect(useSkills.getState().openDiff).toBe('default:9')
    expect(useSkills.getState().blobs['a'.repeat(64)]).toMatchObject({ status: 'ok' })
    await toggleLedgerDiff('default', e)
    expect(useSkills.getState().openDiff).toBeNull()
    await toggleLedgerDiff('default', e)
    expect(mc.skills.blobs).toHaveBeenCalledTimes(1)
  })
})
