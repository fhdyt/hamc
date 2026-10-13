import { describe, expect, it } from 'vitest'
import { commandPreview, curatorStatusArgs, skillActionArgs, skillInspectArgs, validHubId, validSkillPath } from '@shared/skills'
import { SkillActionService, INSTALL_TIMEOUT_MS, ACTION_TIMEOUT_MS } from '../../src/main/skills/actions'
import type { ExecResult } from '../../src/main/connection/manager'

describe('skillActionArgs', () => {
  it('builds curator commands by skill name and install with --yes, never --force', () => {
    expect(skillActionArgs({ action: 'pin', profile: 'default', name: 'arxiv-digest' })).toEqual(['curator', 'pin', 'arxiv-digest'])
    expect(skillActionArgs({ action: 'restore', profile: 'scout', name: 'retired' })).toEqual(['-p', 'scout', 'curator', 'restore', 'retired'])
    expect(skillActionArgs({ action: 'install', profile: 'default', id: 'official/migration/openclaw' })).toEqual(['skills', 'install', 'official/migration/openclaw', '--yes'])
    expect(skillActionArgs({ action: 'install', profile: 'scout', id: 'https://example.com/x/SKILL.md', category: 'web' })).toEqual([
      '-p', 'scout', 'skills', 'install', 'https://example.com/x/SKILL.md', '--category', 'web', '--yes'
    ])
    for (const a of ['pin', 'unpin', 'archive', 'restore', 'install'] as const) {
      expect(skillActionArgs({ action: a, profile: 'default', name: 'x', id: 'a/b' })).not.toContain('--force')
    }
  })

  it('refuses arguments that could be flags, paths or other commands', () => {
    expect(skillActionArgs({ action: 'pin', profile: 'default', name: '-rf' })).toBeNull()
    expect(skillActionArgs({ action: 'pin', profile: 'default', name: '../x' })).toBeNull()
    expect(skillActionArgs({ action: 'pin', profile: 'default' })).toBeNull()
    expect(skillActionArgs({ action: 'pin', profile: '..', name: 'x' })).toBeNull()
    expect(skillActionArgs({ action: 'install', profile: 'default', id: '--force' })).toBeNull()
    expect(skillActionArgs({ action: 'install', profile: 'default', id: 'a/../b' })).toBeNull()
    expect(skillActionArgs({ action: 'install', profile: 'default', id: 'http://plain.example/x' })).toBeNull()
    expect(skillActionArgs({ action: 'install', profile: 'default', id: 'a/b', category: '-x' })).toBeNull()
    expect(skillActionArgs({ action: 'uninstall' as never, profile: 'default', name: 'x' })).toBeNull()
  })

  it('read-only commands and the preview', () => {
    expect(skillInspectArgs('default', 'a/b')).toEqual(['skills', 'inspect', 'a/b'])
    expect(skillInspectArgs('default', '-x')).toBeNull()
    expect(curatorStatusArgs('scout')).toEqual(['-p', 'scout', 'curator', 'status'])
    expect(commandPreview(skillActionArgs({ action: 'archive', profile: 'scout', name: 'old' }))).toBe('$ hermes -p scout curator archive old')
    expect(commandPreview(null)).toBeNull()
    expect(validHubId('skills-sh/owner/repo@main')).toBe(true)
    expect(validSkillPath('.archive/retired')).toBe(true)
    expect(validSkillPath('a/../b')).toBe(false)
  })
})

function service(result: ExecResult = { code: 0, stdout: "\u001b[32mPinned 'x'.\u001b[0m\n", stderr: '' }, connected = true) {
  const calls: { argv: string[]; timeoutMs: number | undefined }[] = []
  const logs: string[] = []
  const svc = new SkillActionService({
    conn: { exec: async (argv: string[], o?: { timeoutMs?: number }) => (calls.push({ argv, timeoutMs: o?.timeoutMs }), result) } as never,
    hermes: () => ({ path: '/usr/bin/hermes' }),
    isConnected: () => connected,
    log: (m) => logs.push(m)
  })
  return { svc, calls, logs }
}

describe('SkillActionService', () => {
  it('runs the shared command with the real path and logs without content', async () => {
    const { svc, calls, logs } = service()
    expect(await svc.run({ action: 'pin', profile: 'default', name: 'x' })).toEqual({ ok: true, output: "Pinned 'x'." })
    expect(calls[0]).toEqual({ argv: ['/usr/bin/hermes', 'curator', 'pin', 'x'], timeoutMs: ACTION_TIMEOUT_MS })
    await svc.run({ action: 'install', profile: 'default', id: 'a/secret-skill' })
    expect(calls[1]!.timeoutMs).toBe(INSTALL_TIMEOUT_MS)
    expect(logs).toEqual(['skills pin default exit 0', 'skills install default exit 0'])
  })

  it('reports Hermes refusals and refuses bad input or no connection without running anything', async () => {
    const red = service({ code: 1, stdout: 'Not installed: the security scan blocked it\n', stderr: '' })
    expect(await red.svc.run({ action: 'install', profile: 'default', id: 'a/b' })).toEqual({ ok: false, error: 'failed', detail: 'Not installed: the security scan blocked it' })
    const { svc, calls } = service(undefined, false)
    expect(await svc.run({ action: 'pin', profile: 'default', name: 'x' })).toEqual({ ok: false, error: 'not-connected' })
    expect(await svc.run({ action: 'pin', profile: 'default', name: '-x' })).toEqual({ ok: false, error: 'bad-input' })
    expect(await svc.inspect('default', '--force')).toEqual({ ok: false, error: 'bad-input' })
    expect(calls).toEqual([])
  })

  it('returns the text of inspect and curator status', async () => {
    const { svc, calls } = service({ code: 0, stdout: 'Name: x\n', stderr: '' })
    expect(await svc.inspect('scout', 'a/b')).toEqual({ ok: true, text: 'Name: x\n' })
    expect(await svc.curatorStatus('default')).toEqual({ ok: true, text: 'Name: x\n' })
    expect(calls.map((c) => c.argv.slice(1))).toEqual([['-p', 'scout', 'skills', 'inspect', 'a/b'], ['curator', 'status']])
  })
})
