import { describe, expect, it } from 'vitest'
import { findSsh, knownHostsLine, pickLocalShell, sshArgs, sshConfigPath, terminalEnv } from '../../src/main/terminal/localShell'
import { TerminalService } from '../../src/main/terminal/service'
import type { PtyLike } from '../../src/main/terminal/pty'
import { IPC } from '@shared/channels'

const has = (...files: string[]) => (f: string): boolean => files.includes(f)

describe('pickLocalShell', () => {
  it('Windows: PowerShell 7 on the PATH, else Windows PowerShell, else cmd', () => {
    const env = { Path: 'C:\\Program Files\\PowerShell\\7;C:\\Windows\\System32', SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
    expect(pickLocalShell('win32', env, has('C:\\Program Files\\PowerShell\\7\\pwsh.exe'))).toEqual({ file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', args: ['-NoLogo'], label: 'pwsh' })
    const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    expect(pickLocalShell('win32', env, has(ps))).toEqual({ file: ps, args: ['-NoLogo'], label: 'powershell' })
    expect(pickLocalShell('win32', env, has())).toEqual({ file: 'C:\\Windows\\System32\\cmd.exe', args: [], label: 'cmd' })
  })
  it('macOS: the login shell of the user with -l; Linux: $SHELL', () => {
    expect(pickLocalShell('darwin', { SHELL: '/opt/homebrew/bin/fish' }, has('/opt/homebrew/bin/fish'))).toEqual({ file: '/opt/homebrew/bin/fish', args: ['-l'], label: 'fish' })
    expect(pickLocalShell('darwin', {}, has('/bin/zsh', '/bin/bash'))).toEqual({ file: '/bin/zsh', args: ['-l'], label: 'zsh' })
    expect(pickLocalShell('linux', { SHELL: '/usr/bin/zsh' }, has('/usr/bin/zsh'))).toEqual({ file: '/usr/bin/zsh', args: [], label: 'zsh' })
    expect(pickLocalShell('linux', { SHELL: 'zsh' }, has('/bin/bash'))).toEqual({ file: '/bin/bash', args: [], label: 'bash' })
  })
})

describe('system ssh', () => {
  const t = { host: 'vps.example.org', port: 2200, username: 'root', algo: 'ssh-ed25519', key: 'AAAAC3Nza' }
  it('finds the OpenSSH of Windows or the one on the PATH', () => {
    expect(findSsh('win32', { SystemRoot: 'C:\\Windows' }, has('C:\\Windows\\System32\\OpenSSH\\ssh.exe'))).toBe('C:\\Windows\\System32\\OpenSSH\\ssh.exe')
    expect(findSsh('linux', { PATH: '/usr/local/bin:/usr/bin' }, has('/usr/bin/ssh'))).toBe('/usr/bin/ssh')
    expect(findSsh('darwin', { PATH: '' }, has())).toBeNull()
  })
  it('pins the host key the user trusted in the app and never skips the check', () => {
    expect(knownHostsLine(t)).toBe('[vps.example.org]:2200 ssh-ed25519 AAAAC3Nza\n')
    expect(knownHostsLine({ ...t, port: 22 })).toBe('vps.example.org ssh-ed25519 AAAAC3Nza\n')
    const args = sshArgs(t, '/home/me/.config/Hermes Agent Mission Control/ssh_known_hosts')
    expect(args).toEqual([
      '-p', '2200',
      '-o', 'UserKnownHostsFile="/home/me/.config/Hermes Agent Mission Control/ssh_known_hosts"',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', 'UpdateHostKeys=no',
      '-l', 'root', '--', 'vps.example.org'
    ])
    expect(args.join(' ')).not.toMatch(/StrictHostKeyChecking=no|accept-new|password/i)
    expect(sshConfigPath('C:\\Users\\a%b\\x')).toBe('"C:/Users/a%%b/x"')
  })
  it('gives local terminals a colour TERM and drops Electron-only variables', () => {
    const env = terminalEnv({ PATH: '/bin', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--x', HOME: '/h', MC_NO_UPDATE: '1' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'HermesMissionControl' })
  })
})

function fakePty() {
  let onData: (d: string) => void = () => {}
  let onExit: (e: { exitCode: number }) => void = () => {}
  const p = {
    written: [] as string[],
    sizes: [] as number[][],
    killed: false,
    emit: (d: string) => onData(d),
    exit: (code: number) => onExit({ exitCode: code })
  }
  const pty: PtyLike = {
    onData: (cb) => (onData = cb),
    onExit: (cb) => (onExit = cb),
    write: (d) => p.written.push(d),
    resize: (c, r) => p.sizes.push([c, r]),
    kill: () => {
      p.killed = true
      onExit({ exitCode: 0 })
    }
  }
  return { p, pty }
}

describe('TerminalService with local terminals', () => {
  function service(o: { connected?: boolean; target?: boolean; via?: 'system' | 'builtin'; ssh?: boolean } = {}) {
    const sent: { channel: string; payload: unknown }[] = []
    const spawned: { file: string; args: string[]; cwd: string; env: Record<string, string> }[] = []
    const ptys: ReturnType<typeof fakePty>[] = []
    let known = ''
    const svc = new TerminalService({
      conn: {
        isConnected: () => o.connected ?? false,
        openShell: () => Promise.reject(new Error('no built-in shell in this test')),
        sshTarget: () => (o.target ? { host: 'vps', port: 22, username: 'root', algo: 'ssh-ed25519', key: 'KEY' } : null)
      },
      send: (channel, payload) => sent.push({ channel, payload }),
      flushMs: 1,
      local: {
        spawn: (file, args, opts) => {
          spawned.push({ file, args, cwd: opts.cwd, env: opts.env })
          const f = fakePty()
          ptys.push(f)
          return f.pty
        },
        platform: 'linux',
        env: { SHELL: '/bin/bash', PATH: '/usr/bin' },
        home: '/home/me',
        exists: has('/bin/bash', ...(o.ssh === false ? [] : ['/usr/bin/ssh'])),
        writeKnownHosts: (text) => {
          known = text
          return '/data/ssh_known_hosts'
        },
        problem: () => null
      },
      serverVia: () => o.via ?? 'system'
    })
    return { svc, sent, spawned, ptys, known: () => known }
  }

  it('starts the local shell in the home folder, without any connection, and passes keys and sizes', async () => {
    const { svc, sent, spawned, ptys } = service()
    const r = await svc.open({ cols: 90, rows: 20, kind: 'local' })
    expect(r).toMatchObject({ ok: true, via: 'local', label: 'bash' })
    expect(spawned[0]).toMatchObject({ file: '/bin/bash', args: [], cwd: '/home/me' })
    if (!r.ok) return
    ptys[0]!.p.emit('me@pc:~$ ')
    await new Promise((res) => setTimeout(res, 10))
    expect(sent).toContainEqual({ channel: IPC.evTermData, payload: { id: r.id, data: 'me@pc:~$ ' } })
    svc.write(r.id, 'ls\r')
    svc.resize(r.id, { cols: 100, rows: 30 })
    expect(ptys[0]!.p.written).toEqual(['ls\r'])
    expect(ptys[0]!.p.sizes).toEqual([[100, 30]])
    // the app's connection going away leaves local terminals alone
    svc.closeAll()
    expect(svc.count()).toBe(1)
    ptys[0]!.p.exit(0)
    expect(sent.at(-1)).toEqual({ channel: IPC.evTermExit, payload: { id: r.id, reason: 'exited', code: 0 } })
  })

  it('server tabs run the system ssh against the pinned key; built-in when asked or when there is no ssh', async () => {
    const a = service({ target: true })
    expect(await a.svc.open({ cols: 80, rows: 24, kind: 'server' })).toMatchObject({ ok: true, via: 'system-ssh', label: 'ssh' })
    expect(a.spawned[0]!.file).toBe('/usr/bin/ssh')
    expect(a.spawned[0]!.args).toContain('StrictHostKeyChecking=yes')
    expect(a.known()).toBe('vps ssh-ed25519 KEY\n')
    // nothing was typed for the user: no password, no command
    expect(a.ptys[0]!.p.written).toEqual([])
    for (const o of [{ target: true, via: 'builtin' as const }, { target: true, ssh: false }, { target: false }]) {
      const b = service(o)
      expect(await b.svc.open({ cols: 80, rows: 24, kind: 'server' })).toEqual({ ok: false, error: 'not-connected' })
      expect(b.spawned).toEqual([])
    }
  })

  it('kills every local terminal when the app quits', async () => {
    const { svc, ptys } = service()
    await svc.open({ cols: 80, rows: 24, kind: 'local' })
    await svc.open({ cols: 80, rows: 24, kind: 'local' })
    svc.killAll()
    expect(ptys.map((f) => f.p.killed)).toEqual([true, true])
    expect(svc.count()).toBe(0)
  })
})
