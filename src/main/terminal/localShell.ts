import { posix, win32 } from 'node:path'

/* Which programs a Terminal tab starts on this computer. Pure: the platform, the environment and a file check come in,
   so every system can be tested anywhere. */

export interface Program {
  file: string
  args: string[]
  /** The short name on the tab. */
  label: string
}

/** What the system ssh needs to reach the server the app is connected to, with the host key the user trusted. */
export interface SshTarget {
  host: string
  port: number
  username: string
  /** The key type (`ssh-ed25519`…) and the key in base64, as in a known_hosts line. */
  algo: string
  key: string
}

type Env = Record<string, string | undefined>
type Exists = (file: string) => boolean

function pathDirs(platform: NodeJS.Platform, env: Env): string[] {
  const raw = (platform === 'win32' ? (env['Path'] ?? env['PATH']) : env['PATH']) ?? ''
  return raw.split(platform === 'win32' ? ';' : ':').filter(Boolean)
}

/** The first `name` on the PATH, or null. */
export function onPath(platform: NodeJS.Platform, env: Env, exists: Exists, name: string): string | null {
  const join = platform === 'win32' ? win32.join : posix.join
  for (const dir of pathDirs(platform, env)) {
    const f = join(dir, name)
    if (exists(f)) return f
  }
  return null
}

/**
 * The shell a local tab starts, like the VS Code terminal: PowerShell on Windows (PowerShell 7 when installed), the
 * user's login shell on macOS (`-l`, so the PATH of the user's profile is there even when the app was opened from the
 * Dock), and `$SHELL` on Linux.
 */
export function pickLocalShell(platform: NodeJS.Platform, env: Env, exists: Exists): Program {
  if (platform === 'win32') {
    const pwsh = onPath(platform, env, exists, 'pwsh.exe')
    if (pwsh) return { file: pwsh, args: ['-NoLogo'], label: 'pwsh' }
    const root = env['SystemRoot'] ?? env['SYSTEMROOT'] ?? 'C:\\Windows'
    const ps = win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (exists(ps)) return { file: ps, args: ['-NoLogo'], label: 'powershell' }
    const cmd = env['ComSpec'] ?? env['COMSPEC'] ?? win32.join(root, 'System32', 'cmd.exe')
    return { file: cmd, args: [], label: 'cmd' }
  }
  const fallbacks = platform === 'darwin' ? ['/bin/zsh', '/bin/bash', '/bin/sh'] : ['/bin/bash', '/bin/sh']
  const own = env['SHELL']
  const file = own && own.startsWith('/') && exists(own) ? own : (fallbacks.find(exists) ?? '/bin/sh')
  return { file, args: platform === 'darwin' ? ['-l'] : [], label: posix.basename(file) }
}

/** The system ssh client: OpenSSH on the PATH, or the one Windows 10 and 11 ship in System32\OpenSSH. */
export function findSsh(platform: NodeJS.Platform, env: Env, exists: Exists): string | null {
  if (platform === 'win32') {
    const root = env['SystemRoot'] ?? env['SYSTEMROOT'] ?? 'C:\\Windows'
    const builtIn = win32.join(root, 'System32', 'OpenSSH', 'ssh.exe')
    if (exists(builtIn)) return builtIn
    return onPath(platform, env, exists, 'ssh.exe')
  }
  return onPath(platform, env, exists, 'ssh') ?? (['/usr/bin/ssh', '/usr/local/bin/ssh'].find(exists) ?? null)
}

/** The known_hosts line of the key the user trusted in Mission Control (`[host]:port` when the port is not 22). */
export function knownHostsLine(t: SshTarget): string {
  const host = t.port === 22 ? t.host : `[${t.host}]:${t.port}`
  return `${host} ${t.algo} ${t.key}\n`
}

/**
 * A path as an ssh option value: ssh splits values at spaces and expands `%` tokens, and the app's folder has spaces
 * ("…/Hermes Agent Mission Control"), so it is quoted, `%` is doubled and Windows backslashes become slashes.
 */
export function sshConfigPath(p: string): string {
  return `"${p.replace(/\\/g, '/').replace(/%/g, '%%')}"`
}

/**
 * Arguments of the system ssh for a server tab. It checks the server against the key the user already trusted here
 * (a file of the app, so ~/.ssh/known_hosts is neither read for this nor changed) and refuses a different key. The
 * password, if the server asks for one, is typed by the user: the app never types it.
 */
export function sshArgs(t: SshTarget, knownHostsFile: string): string[] {
  return [
    '-p',
    String(t.port),
    '-o',
    `UserKnownHostsFile=${sshConfigPath(knownHostsFile)}`,
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'UpdateHostKeys=no',
    '-l',
    t.username,
    '--',
    t.host
  ]
}

/** The environment of a local terminal: the app's own, without what only Electron needs, as a colour terminal. */
export function terminalEnv(env: Env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue
    if (k.startsWith('ELECTRON_') || k === 'MC_NO_UPDATE' || k === 'NODE_OPTIONS' || k === 'CHROME_DESKTOP') continue
    out[k] = v
  }
  out['TERM'] = 'xterm-256color'
  out['COLORTERM'] = 'truecolor'
  out['TERM_PROGRAM'] = 'HermesMissionControl'
  return out
}
