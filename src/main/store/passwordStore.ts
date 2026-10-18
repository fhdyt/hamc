import { spawnSync } from 'node:child_process'

type Env = Record<string, string | undefined>
export type ChromiumBackend = 'libsecret' | 'kwallet' | 'basic'

// XDG_CURRENT_DESKTOP values Chromium maps to libsecret. LXQt is recognised too but gets basic_text.
const LIBSECRET_DESKTOPS = new Set(['GNOME', 'Unity', 'X-Cinnamon', 'Deepin', 'Pantheon', 'XFCE', 'UKUI', 'COSMIC'])
const LIBSECRET_SESSIONS = new Set(['gnome', 'mate', 'deepin', 'ukui', 'xubuntu'])

/**
 * The safeStorage backend Chromium picks on Linux without `--password-store` (base/nix/xdg_util.cc and
 * components/os_crypt key_storage_util_linux.cc), checked against Electron 44 on 2026-10-18. KDE is matched more widely
 * than Chromium does (`plasma*`, `KDE_FULL_SESSION`), so the app never moves a KWallet user to another store.
 */
export function chromiumBackend(env: Env): ChromiumBackend {
  for (const raw of (env['XDG_CURRENT_DESKTOP'] ?? '').split(':')) {
    const v = raw.trim()
    if (v === 'KDE') return 'kwallet'
    if (v === 'LXQt') return 'basic'
    if (LIBSECRET_DESKTOPS.has(v)) return 'libsecret'
  }
  const session = env['DESKTOP_SESSION'] ?? ''
  if (LIBSECRET_SESSIONS.has(session) || session.includes('xfce')) return 'libsecret'
  if (/^(kde|plasma)/.test(session)) return 'kwallet'
  if (env['GNOME_DESKTOP_SESSION_ID'] !== undefined) return 'libsecret'
  if (env['KDE_FULL_SESSION'] !== undefined) return 'kwallet'
  return 'basic'
}

export interface PasswordStoreInput {
  platform: string
  env: Env
  /** The user gave `--password-store` themselves. */
  hasSwitch: boolean
  /** Only asked when the switch would help, because it runs a process. */
  secretServiceRunning: () => boolean
}

/**
 * The `password-store` switch to add before the app is ready, or null. On a desktop Chromium does not know (i3, sway,
 * Hyprland, a bare X session) it picks basic_text even with a Secret Service (GNOME Keyring, KeePassXC) on the session
 * bus, and SecretStore refuses basic_text. The switch is added only when the name already has an owner: libsecret then
 * fails fast without one, but a merely activatable gnome-keyring would be started and its keyring prompt would block the
 * main process on the first safeStorage call.
 */
export function passwordStoreSwitch(i: PasswordStoreInput): 'gnome-libsecret' | null {
  if (i.platform !== 'linux' || i.hasSwitch) return null
  if (chromiumBackend(i.env) !== 'basic') return null
  return i.secretServiceRunning() ? 'gnome-libsecret' : null
}

export interface RunResult {
  error?: NodeJS.ErrnoException
  status: number | null
  stdout: string
}
export type Run = (cmd: string, args: string[]) => RunResult

const NAME = 'org.freedesktop.secrets'

// NameHasOwner through whichever D-Bus client is installed; the next one is tried only when a tool is missing.
const PROBES: Array<[string, string[]]> = [
  ['dbus-send', ['--session', '--print-reply=literal', '--dest=org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus.NameHasOwner', `string:${NAME}`]],
  ['gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.NameHasOwner', NAME]],
  ['busctl', ['--user', 'call', 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'NameHasOwner', 's', NAME]]
]

const spawnRun: Run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] })
  return { error: r.error as NodeJS.ErrnoException | undefined, status: r.status, stdout: r.stdout ?? '' }
}

/** True when something owns org.freedesktop.secrets on the session bus right now (about 10 ms). */
export function secretServiceRunning(run: Run = spawnRun): boolean {
  for (const [cmd, args] of PROBES) {
    const r = run(cmd, args)
    if (r.error?.code === 'ENOENT') continue
    return !r.error && r.status === 0 && /\btrue\b/.test(r.stdout)
  }
  return false
}
