import { describe, expect, it } from 'vitest'
import { approvalOptions, turnTokens } from '../../src/main/chat/gateway'
import { gatewayCmd, gatewayProbeCmd } from '../../src/main/connection/remote'
import { buildCommand } from '../../src/main/connection/quote'

describe('gateway helpers', () => {
  it('labels the approval choices; only deny is a Deny, and junk is dropped', () => {
    expect(approvalOptions(['once', 'session', 'always', 'deny'])).toEqual([
      { id: 'once', name: 'Allow once', kind: 'allow' },
      { id: 'session', name: 'Allow for this session', kind: 'allow' },
      { id: 'always', name: 'Always allow', kind: 'allow' },
      { id: 'deny', name: 'Deny', kind: 'deny' }
    ])
    expect(approvalOptions(['once', 'x; rm -rf /', 42]).map((o) => o.id)).toEqual(['once'])
    expect(approvalOptions(undefined).map((o) => o.id)).toEqual(['once', 'deny'])
  })

  it('works out the tokens of one turn from the session totals', () => {
    expect(turnTokens({ input: 0, output: 0 }, { input: 100, output: 20 })).toEqual({ inputTokens: 100, outputTokens: 20, next: { input: 100, output: 20 } })
    expect(turnTokens({ input: 100, output: 20 }, { input: 250, output: 45 })).toMatchObject({ inputTokens: 150, outputTokens: 25 })
    // unknown start (a resumed session) or totals that went down (compression): no numbers, but the totals are kept
    expect(turnTokens(null, { input: 500, output: 50 })).toEqual({ next: { input: 500, output: 50 } })
    expect(turnTokens({ input: 900, output: 90 }, { input: 300, output: 10 })).toEqual({ next: { input: 300, output: 10 } })
    expect(turnTokens({ input: 1, output: 1 }, { prompt: 5, completion: 3 })).toMatchObject({ inputTokens: 4, outputTokens: 2 })
    expect(turnTokens({ input: 1, output: 1 }, 'nope')).toEqual({ next: { input: 1, output: 1 } })
  })

  it('builds the gateway command from quoted arguments, without yolo and with the startup sweep off', () => {
    const argv = gatewayCmd('/home/u/.hermes/hermes-agent/venv/bin/python', "/home/u/my hermes")
    expect(argv).toEqual(['env', 'HERMES_HOME=/home/u/my hermes', 'HERMES_TUI_SESSION_TTL_S=0', '/home/u/.hermes/hermes-agent/venv/bin/python', '-P', '-m', 'tui_gateway.entry'])
    expect(buildCommand(argv)).toBe("'env' 'HERMES_HOME=/home/u/my hermes' 'HERMES_TUI_SESSION_TTL_S=0' '/home/u/.hermes/hermes-agent/venv/bin/python' '-P' '-m' 'tui_gateway.entry'")
    expect(argv.join(' ')).not.toMatch(/yolo/i)
    expect(gatewayProbeCmd('/usr/bin/python3').slice(0, 3)).toEqual(['/usr/bin/python3', '-P', '-c'])
    expect(gatewayProbeCmd('/usr/bin/python3')[3]).toMatch(/find_spec\('tui_gateway.entry'\)/)
  })
})
