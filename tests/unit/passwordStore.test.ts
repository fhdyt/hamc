import { describe, expect, it, vi } from 'vitest'
import {
  chromiumBackend,
  passwordStoreSwitch,
  secretServiceRunning,
  type PasswordStoreInput,
  type Run,
  type RunResult
} from '../../src/main/store/passwordStore'

describe('chromiumBackend', () => {
  // What Electron 44 picked for each environment in WSL on 2026-10-18 (KDE_FULL_SESSION alone is basic_text there).
  it.each([
    [{}, 'basic'],
    [{ XDG_CURRENT_DESKTOP: 'i3' }, 'basic'],
    [{ XDG_CURRENT_DESKTOP: 'sway' }, 'basic'],
    [{ XDG_CURRENT_DESKTOP: 'Hyprland' }, 'basic'],
    [{ XDG_CURRENT_DESKTOP: 'LXQt' }, 'basic'],
    [{ XDG_CURRENT_DESKTOP: 'MATE' }, 'basic'],
    [{ XDG_CURRENT_DESKTOP: 'gnome' }, 'basic'],
    [{ DESKTOP_SESSION: 'i3' }, 'basic'],
    [{ XDG_CURRENT_DESKTOP: 'GNOME' }, 'libsecret'],
    [{ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }, 'libsecret'],
    [{ XDG_CURRENT_DESKTOP: 'Budgie:GNOME' }, 'libsecret'],
    [{ XDG_CURRENT_DESKTOP: 'i3:GNOME' }, 'libsecret'],
    [{ XDG_CURRENT_DESKTOP: 'Unity' }, 'libsecret'],
    [{ XDG_CURRENT_DESKTOP: 'X-Cinnamon' }, 'libsecret'],
    [{ XDG_CURRENT_DESKTOP: 'Deepin' }, 'libsecret'],
    [{ XDG_CURRENT_DESKTOP: 'Pantheon' }, 'libsecret'],
    [{ XDG_CURRENT_DESKTOP: 'XFCE' }, 'libsecret'],
    [{ XDG_CURRENT_DESKTOP: 'UKUI' }, 'libsecret'],
    [{ XDG_CURRENT_DESKTOP: 'COSMIC' }, 'libsecret'],
    [{ XDG_CURRENT_DESKTOP: 'sway', DESKTOP_SESSION: 'gnome' }, 'libsecret'],
    [{ DESKTOP_SESSION: 'mate' }, 'libsecret'],
    [{ DESKTOP_SESSION: 'xubuntu' }, 'libsecret'],
    [{ DESKTOP_SESSION: 'xfce' }, 'libsecret'],
    [{ DESKTOP_SESSION: 'deepin' }, 'libsecret'],
    [{ DESKTOP_SESSION: 'ukui' }, 'libsecret'],
    [{ GNOME_DESKTOP_SESSION_ID: 'x' }, 'libsecret'],
    [{ XDG_CURRENT_DESKTOP: 'KDE' }, 'kwallet'],
    [{ XDG_CURRENT_DESKTOP: 'KDE', KDE_SESSION_VERSION: '6' }, 'kwallet'],
    [{ DESKTOP_SESSION: 'kde-plasma' }, 'kwallet'],
    [{ DESKTOP_SESSION: 'plasmawayland' }, 'kwallet'],
    [{ KDE_FULL_SESSION: 'true' }, 'kwallet']
  ])('%j -> %s', (env, backend) => {
    expect(chromiumBackend(env)).toBe(backend)
  })
})

describe('passwordStoreSwitch', () => {
  const input = (over: Partial<PasswordStoreInput> = {}): PasswordStoreInput => ({
    platform: 'linux',
    env: { XDG_CURRENT_DESKTOP: 'i3' },
    hasSwitch: false,
    secretServiceRunning: () => true,
    ...over
  })

  it('picks libsecret on an unknown desktop with a running Secret Service', () => {
    expect(passwordStoreSwitch(input())).toBe('gnome-libsecret')
  })

  it('leaves Chromium alone without a Secret Service owner', () => {
    expect(passwordStoreSwitch(input({ secretServiceRunning: () => false }))).toBeNull()
  })

  it('never overrides a switch the user gave', () => {
    const probe = vi.fn(() => true)
    expect(passwordStoreSwitch(input({ hasSwitch: true, secretServiceRunning: probe }))).toBeNull()
    expect(probe).not.toHaveBeenCalled()
  })

  it.each(['win32', 'darwin'])('does nothing on %s', (platform) => {
    expect(passwordStoreSwitch(input({ platform }))).toBeNull()
  })

  it.each([{ XDG_CURRENT_DESKTOP: 'GNOME' }, { XDG_CURRENT_DESKTOP: 'KDE' }, { KDE_FULL_SESSION: 'true' }])(
    'does not probe on a desktop Chromium already handles: %j',
    (env) => {
      const probe = vi.fn(() => true)
      expect(passwordStoreSwitch(input({ env, secretServiceRunning: probe }))).toBeNull()
      expect(probe).not.toHaveBeenCalled()
    }
  )
})

describe('secretServiceRunning', () => {
  const missing = (): RunResult => ({ error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), status: null, stdout: '' })
  const runner = (answers: Record<string, RunResult>): Run & { calls: string[] } => {
    const calls: string[] = []
    const run: Run = (cmd) => {
      calls.push(cmd)
      return answers[cmd] ?? missing()
    }
    return Object.assign(run, { calls })
  }

  it.each([
    ['dbus-send', '   boolean true\n', true],
    ['dbus-send', '   boolean false\n', false],
    ['gdbus', '(true,)\n', true],
    ['gdbus', '(false,)\n', false],
    ['busctl', 'b true\n', true],
    ['busctl', 'b false\n', false]
  ])('reads %s output %j', (tool, stdout, owned) => {
    expect(secretServiceRunning(runner({ [tool]: { status: 0, stdout } }))).toBe(owned)
  })

  it('stops at the first installed tool', () => {
    const run = runner({ gdbus: { status: 0, stdout: '(false,)' }, busctl: { status: 0, stdout: 'b true' } })
    expect(secretServiceRunning(run)).toBe(false)
    expect(run.calls).toEqual(['dbus-send', 'gdbus'])
  })

  it('says no for a failed or timed out call', () => {
    expect(secretServiceRunning(runner({ 'dbus-send': { status: 1, stdout: '' } }))).toBe(false)
    const timedOut = { error: Object.assign(new Error('spawnSync dbus-send ETIMEDOUT'), { code: 'ETIMEDOUT' }), status: null, stdout: 'true' }
    expect(secretServiceRunning(runner({ 'dbus-send': timedOut }))).toBe(false)
  })

  it('says no when no D-Bus client is installed', () => {
    const run = runner({})
    expect(secretServiceRunning(run)).toBe(false)
    expect(run.calls).toEqual(['dbus-send', 'gdbus', 'busctl'])
  })
})
