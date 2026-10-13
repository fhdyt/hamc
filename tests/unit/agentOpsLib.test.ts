import { describe, expect, it } from 'vitest'
import { cellState, parseFallback, parseMcpList, parseToolsList, toggleChange, toolPlatforms } from '../../src/renderer/lib/agentOps'

const MCP = `
  MCP Servers:

  Name             Transport                      Tools        Status    
  ──────────────── ────────────────────────────── ──────────── ──────────
  github           https://api.githubcopilot.c... all          ✓ enabled
  filesystem       npx -y @modelcontext/serv...   3 selected   ✗ disabled
`

describe('agentOps parsers', () => {
  it('reads the MCP table and the empty message', () => {
    expect(parseMcpList(MCP).rows).toEqual([
      { name: 'github', transport: 'https://api.githubcopilot.c...', tools: 'all', enabled: true },
      { name: 'filesystem', transport: 'npx -y @modelcontext/serv...', tools: '3 selected', enabled: false }
    ])
    expect(parseMcpList('\n  No MCP servers configured.\n')).toEqual({ rows: [], empty: true })
  })

  it('reads toolset rows with their keys', () => {
    expect(parseToolsList('Built-in toolsets (cli):\n  ✓ enabled  web  Web search\n  ✗ disabled  browser  Browser\n\nPlugin toolsets (cli):\n  ✓ enabled  my_plugin  Mine')).toEqual([
      { key: 'web', label: 'Web search', enabled: true },
      { key: 'browser', label: 'Browser', enabled: false },
      { key: 'my_plugin', label: 'Mine', enabled: true }
    ])
  })

  it('reads the fallback chain', () => {
    expect(parseFallback('  Primary:   x/y  (via openrouter)\n\n  Fallback chain (2 entries):\n    1. a  (via b)\n    2. c  (via d)  [https://e]\n')).toEqual({
      primary: 'x/y  (via openrouter)',
      chain: ['a  (via b)', 'c  (via d)  [https://e]'],
      empty: false
    })
    expect(parseFallback('\n  No fallback providers configured.\n').empty).toBe(true)
  })

  it('holds and drops toolset changes and lists platforms', () => {
    let c = toggleChange([], 'web', 'cli', true)
    expect(c).toEqual([{ toolset: 'web', platform: 'cli', enable: false }])
    expect(cellState(c, 'web', 'cli', true)).toEqual({ on: false, held: true })
    c = toggleChange(c, 'web', 'cli', true)
    expect(c).toEqual([])
    expect(toolPlatforms(['telegram', 'Discord', 'cli', 'bad name'])).toEqual(['cli', 'cron', 'telegram', 'discord'])
  })
})
