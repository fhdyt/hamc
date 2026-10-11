import { describe, expect, it } from 'vitest'
import { ASSUMED_FLAGS, canStream, limitedReason, parseChatHelp } from '../../src/main/chat/flags'
import { BLOCKED_MESSAGE, ChatLineParser } from '../../src/main/chat/parser'
import { attachmentBlock } from '../../src/main/chat/service'
import { chatPlainCmd, chatStreamCmd } from '../../src/main/connection/remote'
import { buildCommand } from '../../src/main/connection/quote'

const parse = (...lines: object[]): ReturnType<ChatLineParser['parse']> => {
  const p = new ChatLineParser(() => 1000)
  return lines.flatMap((l) => p.parse(JSON.stringify(l)))
}

describe('ChatLineParser', () => {
  it('reads the session id once, from the system event', () => {
    expect(parse({ type: 'system', session_id: 's-1' }, { type: 'system', session_id: 's-1' })).toEqual([{ kind: 'session', sessionId: 's-1' }])
    expect(parse({ type: 'system', sessionId: 's-2' })).toEqual([{ kind: 'session', sessionId: 's-2' }])
    expect(parse({ type: 'system', session: { id: 's-3' } })).toEqual([{ kind: 'session', sessionId: 's-3' }])
  })

  it('refuses a session id that is not a plain identifier', () => {
    expect(parse({ type: 'system', session_id: 'x; rm -rf ~' })).toEqual([])
    expect(parse({ type: 'system', session_id: '../etc' })).toEqual([])
  })

  it('turns text deltas into text events, whichever field carries them', () => {
    expect(parse({ type: 'text', text: 'Hel' }, { type: 'text', delta: 'lo' }, { type: 'text', content: [{ text: '!' }, { text: '?' }] })).toEqual([
      { kind: 'text', text: 'Hel' },
      { kind: 'text', text: 'lo' },
      { kind: 'text', text: '!?' }
    ])
    expect(parse({ type: 'text', text: '' })).toEqual([])
  })

  it('uses a whole assistant message only when no deltas came', () => {
    expect(parse({ type: 'assistant', message: { content: [{ type: 'text', text: 'All at once' }] } })).toEqual([{ kind: 'text', text: 'All at once' }])
    expect(parse({ type: 'text', text: 'a' }, { type: 'assistant', content: 'a' })).toEqual([{ kind: 'text', text: 'a' }])
  })

  it('follows a tool call from start to result and measures the time itself when none is given', () => {
    let now = 1000
    const p = new ChatLineParser(() => now)
    expect(p.parse(JSON.stringify({ type: 'tool_use', id: 'c1', name: 'web_search', input: { q: 'x' } }))).toEqual([{ kind: 'tool', id: 'c1', name: 'web_search', state: 'running' }])
    now = 3500
    expect(p.parse(JSON.stringify({ type: 'tool_result', id: 'c1', output: '3 results' }))).toEqual([{ kind: 'tool', id: 'c1', name: 'web_search', state: 'ok', ms: 2500 }])
    expect(parse({ type: 'tool_result', tool_use_id: 'z', name: 'shell', duration_ms: 12, output: 'x' })).toEqual([{ kind: 'tool', id: 'z', name: 'shell', state: 'ok', ms: 12 }])
  })

  it('marks a refused command and adds the approval notice', () => {
    const out = parse({ type: 'tool_result', id: 'c', name: 'shell', is_error: true, output: 'Command blocked by approval policy' })
    expect(out).toEqual([
      { kind: 'tool', id: 'c', name: 'shell', state: 'error' },
      { kind: 'notice', code: 'blocked', message: BLOCKED_MESSAGE }
    ])
    // an ordinary failure is an error chip without the notice
    expect(parse({ type: 'tool_result', id: 'c', name: 'shell', is_error: true, output: 'exit status 1' }).map((e) => e.kind)).toEqual(['tool'])
  })

  it('reads the result with exit code, duration and token counts', () => {
    expect(parse({ type: 'result', exit_code: 0, duration_ms: 1500, usage: { input_tokens: 12, output_tokens: 3 } })).toEqual([
      { kind: 'result', exitCode: 0, durationMs: 1500, inputTokens: 12, outputTokens: 3 }
    ])
    expect(parse({ type: 'result', exit_code: 130 })).toEqual([{ kind: 'result', exitCode: 130 }])
    expect(parse({ type: 'result' })).toEqual([{ kind: 'result', exitCode: null }])
  })

  it('reads errors, ignores unknown events and never throws on bad input', () => {
    expect(parse({ type: 'error', message: 'rate limited' })).toEqual([{ kind: 'error', message: 'rate limited' }])
    expect(parse({ type: 'heartbeat' }, { nothing: 1 })).toEqual([])
    const p = new ChatLineParser()
    for (const bad of ['', '   ', 'not json', '[1,2]', '42', 'null', '{"type":']) expect(() => p.parse(bad)).not.toThrow()
    expect(p.noise).toEqual(['not json', '{"type":'])
  })

  it('keeps hostile text as data', () => {
    const t = '"; $(rm -rf ~) `x` <script>'
    expect(parse({ type: 'text', text: t })).toEqual([{ kind: 'text', text: t }])
  })
})

describe('chat flags', () => {
  it('reads the options from the help text', () => {
    const f = parseChatHelp('  --oneshot\n  --query-file F\n  --format {text,json,stream-json}\n  --resume ID\n  --source S\n  -Q, --quiet')
    expect(f).toMatchObject({ oneshot: true, queryFile: true, format: true, streamJson: true, resume: true, source: true, quiet: true, assumed: false })
    expect(canStream(f)).toBe(true)
  })

  it('falls back to plain output when stream-json or the query file is missing', () => {
    const f = parseChatHelp('usage: hermes chat [-q QUERY] [--resume ID]')
    expect(canStream(f)).toBe(false)
    expect(f.resume).toBe(true)
    expect(limitedReason(f)).toContain('--oneshot')
    expect(limitedReason(f)).toContain('--format stream-json')
    expect(parseChatHelp('--oneshot --query-file --format {text,json}')).toMatchObject({ format: true, streamJson: false })
    expect(canStream(ASSUMED_FLAGS)).toBe(true)
  })
})

describe('chat commands', () => {
  it('builds the PRD command with the message kept out of it', () => {
    expect(chatStreamCmd('/h/hermes', 'default', null)).toEqual(['/h/hermes', 'chat', '--oneshot', '--query-file', '-', '--format', 'stream-json', '--source', 'mission-control'])
    expect(chatStreamCmd('/h/hermes', 'scout', 's-1')).toEqual(['/h/hermes', '-p', 'scout', 'chat', '--oneshot', '--query-file', '-', '--format', 'stream-json', '--source', 'mission-control', '--resume', 's-1'])
  })

  it('quotes a hostile message as one argument in the plain fallback', () => {
    const msg = "it's $(whoami); rm -rf ~ `x` \"q\""
    const cmd = chatPlainCmd('/h/hermes', 'scout', msg, true, true)
    expect(cmd).toEqual(['/h/hermes', '-p', 'scout', 'chat', '-q', msg, '-Q', '--source', 'mission-control'])
    expect(buildCommand(cmd)).toContain("'it'\\''s $(whoami); rm -rf ~ `x` \"q\"'")
    expect(chatPlainCmd('/h/hermes', 'default', 'hi', false, false)).toEqual(['/h/hermes', 'chat', '-q', 'hi'])
  })
})

describe('attachmentBlock', () => {
  it('lists every file with its path, size and type', () => {
    expect(
      attachmentBlock([
        { path: '/home/u/hermes-uploads/atlas/20261010/report.pdf', name: 'report.pdf', size: 2.1 * 1024 * 1024, mime: 'application/pdf' },
        { path: '/home/u/hermes-uploads/atlas/20261010/a.txt', name: 'a.txt', size: 12, mime: 'text/plain' }
      ])
    ).toBe('[Attached: /home/u/hermes-uploads/atlas/20261010/report.pdf · 2.1 MB · application/pdf]\n[Attached: /home/u/hermes-uploads/atlas/20261010/a.txt · 12 B · text/plain]')
  })
})
