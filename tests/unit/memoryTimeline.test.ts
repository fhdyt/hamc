import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoryVersion } from '@shared/memory'
import { authorView, limitOf, versionRows } from '../../src/renderer/lib/memoryTimeline'
import { copyVersion, loadVersions, memoryChanged, pickVersion, restoreVersion } from '../../src/renderer/memoryActions'
import { useAgentCfg } from '../../src/renderer/stores/agentCfg'
import { useMemoryTimeline } from '../../src/renderer/stores/memoryTimeline'
import { useUi } from '../../src/renderer/stores/ui'

const DAY = 86_400_000
const v = (id: number, takenAt: number, over: Partial<MemoryVersion> = {}): MemoryVersion => ({
  id, profile: 'default', file: 'memory', takenAt, hash: `h${id}`, author: 'other', sessionId: null, mtime: null, chars: 1100, added: 1, removed: 0, ...over
})

describe('lib/memoryTimeline', () => {
  it('groups versions by day and measures them against the limit', () => {
    const t = new Date(2026, 9, 13, 12, 0).getTime()
    const rows = versionRows([v(3, t), v(2, t - 3600_000), v(1, t - DAY)], 'memory')
    expect(rows.map((r) => r.newDay)).toEqual([true, false, true])
    expect(rows[0]!.pct).toBe(50)
    expect(versionRows([v(1, t)], 'soul')[0]!.pct).toBeNull()
    expect(limitOf('user')).toBe(1375)
  })

  it('labels authors and calls them guesses', () => {
    expect(authorView('agent', 'Scout', '#fff').label).toBe('Scout (agent)')
    expect(authorView('away', 'Scout', '#fff').label).toBe('while away')
    expect(authorView('other', 'Scout', '#fff').how).toContain('no memory tool call')
  })
})

type Fn = ReturnType<typeof vi.fn>
function stub(list: MemoryVersion[], texts: Record<number, string>) {
  const mc = {
    memory: {
      versions: vi.fn(async () => list),
      version: vi.fn(async (id: number) => (id in texts ? { ok: true, id, text: texts[id] } : { ok: false, error: 'not-found' })),
      clear: vi.fn(async () => 0)
    },
    agentCfg: { readFile: vi.fn(async () => ({ ok: true, file: { exists: true, text: 'server text', hash: 'a'.repeat(64), mtime: 1 } })) },
    settings: { set: vi.fn(async () => undefined) }
  }
  vi.stubGlobal('window', { mc })
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => undefined) } })
  return mc as unknown as { memory: Record<string, Fn>; agentCfg: Record<string, Fn> }
}

beforeEach(() => {
  useMemoryTimeline.getState().reset()
  useAgentCfg.setState({ drafts: {}, profile: null })
})
afterEach(() => vi.unstubAllGlobals())

describe('memory timeline actions', () => {
  it('loads versions and the two texts of the picked diff, once each', async () => {
    const mc = stub([v(3, 3), v(2, 2), v(1, 1)], { 3: 'c', 2: 'b', 1: 'a' })
    await loadVersions('default')
    expect(mc.memory.versions).toHaveBeenCalledWith('default', 'memory')
    expect(Object.keys(useMemoryTimeline.getState().texts).sort()).toEqual(['2', '3'])
    await pickVersion(1)
    expect(mc.memory.version).toHaveBeenCalledTimes(3)
    expect(useMemoryTimeline.getState().texts[1]).toEqual({ status: 'ok', text: 'a' })
  })

  it('a new version reloads only the file on screen and keeps an older pick', async () => {
    let list = [v(2, 2), v(1, 1)]
    const mc = stub(list, { 2: 'b', 1: 'a', 3: 'c' })
    useMemoryTimeline.getState().setTab('timeline')
    await loadVersions('default')
    await pickVersion(1)
    list = [v(3, 3), ...list]
    mc.memory.versions!.mockImplementation(async () => list)
    memoryChanged('default', 'user', 'default')
    memoryChanged('scout', 'memory', 'default')
    expect(mc.memory.versions).toHaveBeenCalledTimes(1)
    memoryChanged('default', 'memory', 'default')
    await vi.waitFor(() => {
      const e = useMemoryTimeline.getState().versions
      expect(e?.status === 'ok' ? e.list.length : 0).toBe(3)
    })
    expect(useMemoryTimeline.getState().picked).toBe(2)
  })

  it('restores a version into the editor as an unsaved edit and copies it', async () => {
    stub([v(2, 2), v(1, 1)], { 2: 'new', 1: 'old text' })
    await loadVersions('default')
    await pickVersion(1)
    await restoreVersion('default')
    expect(useUi.getState().settingsTab).toBe('agents')
    const d = useAgentCfg.getState().drafts['default:memory']!
    expect(d.text).toBe('old text')
    expect(d.baseText).toBe('server text')
    expect(d.notice).toContain('from the memory timeline')
    await copyVersion()
    expect(useMemoryTimeline.getState().note).toBe('Version copied.')
  })
})
