import type { ServerChannel } from 'ssh2'

/** What the fake server saw of interactive shells: tests check the app never types into one by itself. */
export interface FakeShellLog {
  /** One entry per `pty-req`. */
  ptys: { term: string; cols: number; rows: number }[]
  /** Every `window-change`. */
  resizes: { cols: number; rows: number }[]
  /** How many shells were started. */
  opened: number
  /** How many shells are running now. */
  running: number
  /** Every chunk of input, as it arrived. */
  input: string[]
}

export const newShellLog = (): FakeShellLog => ({ ptys: [], resizes: [], opened: 0, running: 0, input: [] })

const PROMPT = 'tester@fake:~$ '

/**
 * A tiny line-editing shell: echoes what is typed and runs `echo`, `stty size`, `seq N`, `color` and `exit`.
 * `size` is shared with the window-change handler so `stty size` answers the last size.
 */
export function runFakeShell(stream: ServerChannel, log: FakeShellLog, size: { cols: number; rows: number }): void {
  log.opened++
  log.running++
  let line = ''
  let ended = false
  const out = (s: string): void => {
    if (!ended) stream.write(s)
  }
  const end = (): void => {
    if (ended) return
    ended = true
    log.running--
    stream.exit(0)
    stream.end()
  }
  stream.on('close', () => {
    if (!ended) {
      ended = true
      log.running--
    }
  })
  const run = (cmd: string): void => {
    const [name, ...args] = cmd.trim().split(/\s+/)
    if (!name) return
    if (name === 'exit') {
      out('logout\r\n')
      return end()
    }
    if (name === 'echo') return out(args.join(' ') + '\r\n')
    if (name === 'stty' && args[0] === 'size') return out(`${size.rows} ${size.cols}\r\n`)
    if (name === 'seq') {
      const n = Math.min(20000, Number(args[0]) || 0)
      let s = ''
      for (let i = 1; i <= n; i++) s += `${i}\r\n`
      return out(s)
    }
    if (name === 'color') return out('\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m\r\n')
    out(`${name}: command not found\r\n`)
  }
  out('Fake shell for tests\r\n' + PROMPT)
  stream.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    log.input.push(text)
    for (const ch of text) {
      if (ended) return
      if (ch === '\r' || ch === '\n') {
        out('\r\n')
        const cmd = line
        line = ''
        run(cmd)
        if (!ended) out(PROMPT)
      } else if (ch === '\x7f' || ch === '\b') {
        if (line) {
          line = line.slice(0, -1)
          out('\b \b')
        }
      } else if (ch === '\x03') {
        line = ''
        out('^C\r\n' + PROMPT)
      } else if (ch >= ' ') {
        line += ch
        out(ch)
      }
    }
  })
}
