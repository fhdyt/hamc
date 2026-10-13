import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mcpTestArgs, preview, profileCreateArgs, terminalCommands, toolsApplyArgs, toolsListArgs } from '@shared/agentOps'
import { redactConfig } from '../../src/main/agentops/redact'
import { crc32, makeZip } from '../../src/main/agentops/zip'
import { collectBackup, type BackupFs } from '../../src/main/agentops/backup'
import { pythonExe } from '../helpers/fixture'

describe('shared agentOps builders', () => {
  it('builds the read commands and refuses odd names', () => {
    expect(toolsListArgs('scout', 'telegram')).toEqual(['-p', 'scout', 'tools', 'list', '--platform', 'telegram'])
    expect(toolsListArgs('scout', '--all')).toBeNull()
    expect(mcpTestArgs('default', 'github')).toEqual(['mcp', 'test', 'github'])
    expect(mcpTestArgs('default', '-x')).toBeNull()
  })

  it('groups tool changes per action and platform, disables first', () => {
    expect(
      toolsApplyArgs('scout', [
        { toolset: 'web', platform: 'cli', enable: true },
        { toolset: 'browser', platform: 'cli', enable: true },
        { toolset: 'memory', platform: 'telegram', enable: false },
        { toolset: 'web', platform: 'cli', enable: true }
      ])
    ).toEqual([
      ['-p', 'scout', 'tools', 'disable', 'memory', '--platform', 'telegram'],
      ['-p', 'scout', 'tools', 'enable', 'web', 'browser', '--platform', 'cli']
    ])
    expect(toolsApplyArgs('scout', [])).toBeNull()
    expect(toolsApplyArgs('scout', [{ toolset: 'Web Search', platform: 'cli', enable: true }])).toBeNull()
  })

  it('creates a profile with the description as one argument and no wrapper unless asked', () => {
    expect(profileCreateArgs({ name: 'research-bot', description: '-x does research', cloneFrom: 'scout', noSkills: true, alias: false })).toEqual([
      'profile', 'create', 'research-bot', '--description=-x does research', '--clone-from', 'scout', '--no-skills', '--no-alias'
    ])
    expect(profileCreateArgs({ name: 'ab', noSkills: false, alias: true })).toEqual(['profile', 'create', 'ab'])
    for (const name of ['A', 'a', '1abc', 'a_b', 'x'.repeat(25), 'default']) expect(profileCreateArgs({ name, noSkills: false, alias: false })).toBeNull()
    expect(profileCreateArgs({ name: 'ok-name', description: 'two\nlines', noSkills: false, alias: false })).toBeNull()
    expect(preview(profileCreateArgs({ name: 'ok-name', description: 'Writes code', noSkills: false, alias: false }))).toBe("$ hermes profile create ok-name '--description=Writes code' --no-alias")
    expect(terminalCommands('scout').mcpRemove('github')).toBe('hermes -p scout mcp remove github')
  })
})

describe('redactConfig', () => {
  it('blanks env and headers values, secret-looking keys, inline maps and block scalars', () => {
    const src = [
      'model:',
      '  default: x/y',
      '  api_key: sk-123',
      'mcp_servers:',
      '  github:',
      '    url: https://api.example.com/mcp',
      '    headers:',
      '      Authorization: Bearer abc',
      '      X-Plain: also-hidden',
      '    env:',
      '      GITHUB_TOKEN: ghp_x',
      '  fs:',
      '    command: npx',
      '    args:',
      '      - -y',
      '    env: {HOME_TOKEN: t}',
      'providers:',
      '  custom:',
      '    secret_key: |',
      '      line one',
      '      line two',
      '    base_url: https://ok',
      '# token: not touched in comments'
    ].join('\n')
    const { text, blanked } = redactConfig(src)
    expect(text).not.toMatch(/sk-123|Bearer abc|also-hidden|ghp_x|HOME_TOKEN|line one|line two/)
    expect(text).toContain('default: x/y')
    expect(text).toContain('url: https://api.example.com/mcp')
    expect(text).toContain('- -y')
    expect(text).toContain('env: {}')
    expect(text).toContain('base_url: https://ok')
    expect(text).toContain('# token: not touched in comments')
    expect(blanked).toBeGreaterThanOrEqual(6)
  })
})

describe('makeZip', () => {
  it('writes a zip that Python reads back', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    const dir = mkdtempSync(join(tmpdir(), 'mc-zip-'))
    const path = join(dir, 'a.zip')
    writeFileSync(path, makeZip([{ name: 'a.txt', data: Buffer.from('hello') }, { name: 'dir/ü.md', data: Buffer.from('x'.repeat(5000)) }]))
    const r = spawnSync(pythonExe, ['-c', 'import sys, zipfile, json; z = zipfile.ZipFile(sys.argv[1]); print(json.dumps({n: len(z.read(n)) for n in z.namelist()})); z.testzip()', path], { encoding: 'utf8' })
    expect(JSON.parse(r.stdout)).toEqual({ 'a.txt': 5, 'dir/ü.md': 5000 })
  })
})

describe('collectBackup', () => {
  const files: Record<string, string> = {
    '/h/SOUL.md': 'soul',
    '/h/config.yaml': 'model:\n  api_key: sk-1\n',
    '/h/.env': 'SECRET=1',
    '/h/auth.json': '{}',
    '/h/memories/MEMORY.md': 'm',
    '/h/memories/.env': 'SECRET=2',
    '/h/skills/a/SKILL.md': 'skill',
    '/h/skills/a/node_modules/x.js': 'nope',
    '/h/state.db': 'db'
  }
  const dirs = new Set(['/h', '/h/memories', '/h/skills', '/h/skills/a', '/h/skills/a/node_modules'])
  const fs: BackupFs = {
    lstat: async (p) => (dirs.has(p) ? { size: 0, mtime: 1, isDir: true, isFile: false } : p in files ? { size: files[p]!.length, mtime: 1, isDir: false, isFile: true } : null),
    readdir: async (p) => [...new Set(Object.keys(files).concat([...dirs]).filter((f) => f.startsWith(p + '/') && !f.slice(p.length + 1).includes('/')).map((f) => f.slice(p.length + 1)))],
    readFile: async (p) => Buffer.from(files[p]!)
  }

  it('takes the listed parts, never secrets, and redacts config.yaml', async () => {
    const r = await collectBackup(fs, '/h', false)
    expect(r.entries.map((e) => e.name)).toEqual(['SOUL.md', 'memories/MEMORY.md', 'config.yaml', 'skills/a/SKILL.md'])
    expect(r.entries.find((e) => e.name === 'config.yaml')!.data.toString()).toBe('model:\n  api_key: ""\n')
    expect((await collectBackup(fs, '/h', true)).entries.map((e) => e.name)).toContain('state.db')
  })
})
