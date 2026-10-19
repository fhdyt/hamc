import { describe, expect, it } from 'vitest'
import { formatAge, formatBytes, formatPct, formatRate, formatUptime, loadColor, textBar } from '../../src/renderer/lib/format'
import { padLeft, pushWindow } from '../../src/renderer/lib/window'
import { stepZoom, zoomPercent } from '../../src/renderer/lib/zoom'
import { ariaSort, sortProcs } from '../../src/renderer/lib/procs'
import { validateConnectForm } from '../../src/renderer/lib/connectForm'
import { launchOutcome, startupPct } from '../../src/renderer/lib/launchOutcome'
import { agentColor, initials } from '../../src/renderer/lib/agentColor'
import { NAV, routeForShortcut } from '../../src/renderer/shell/nav'

describe('format', () => {
  it('formats byte sizes in binary units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1536)).toBe('1.5 KiB')
    expect(formatBytes(6.1 * 1024 ** 3)).toBe('6.1 GiB')
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(NaN)).toBe('0 B')
  })

  it('formats rates in decimal units like the mockup', () => {
    expect(formatRate(0)).toBe('0 B/s')
    expect(formatRate(340_000)).toBe('340 KB/s')
    expect(formatRate(1_200_000)).toBe('1.2 MB/s')
  })

  it('formats uptime', () => {
    expect(formatUptime(1_038_240)).toBe('12d 00h')
    expect(formatUptime(4 * 3600 + 125)).toBe('4h 02m')
    expect(formatUptime(125)).toBe('2m 05s')
    expect(formatUptime(9)).toBe('9s')
  })

  it('formats the age of data', () => {
    expect(formatAge(0.4)).toBe('just now')
    expect(formatAge(12)).toBe('12s ago')
    expect(formatAge(185)).toBe('3m ago')
    expect(formatAge(7300)).toBe('2h ago')
    expect(formatAge(200000)).toBe('2d ago')
  })

  it('rounds percentages and colours load', () => {
    expect(formatPct(33.6)).toBe('34%')
    expect(loadColor(10)).toBe('#50FA7B')
    expect(loadColor(50)).toBe('#FFB86C')
    expect(loadColor(80)).toBe('#FF5555')
  })

  it('draws text bars', () => {
    expect(textBar(50, 10)).toBe('■■■■■·····')
    expect(textBar(0, 4)).toBe('····')
    expect(textBar(150, 4)).toBe('■■■■')
  })
})

describe('rolling window', () => {
  it('appends and keeps only the last n values', () => {
    expect(pushWindow([1, 2, 3], 4, 3)).toEqual([2, 3, 4])
    expect(pushWindow([], 1, 3)).toEqual([1])
  })
  it('does not mutate its input', () => {
    const a = [1, 2]
    pushWindow(a, 3, 5)
    expect(a).toEqual([1, 2])
  })
  it('pads on the left with zeros to a fixed width', () => {
    expect(padLeft([5, 6], 4)).toEqual([0, 0, 5, 6])
    expect(padLeft([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5])
  })
})

describe('zoom', () => {
  it('steps by 10% without float drift and clamps to 70%-150%', () => {
    let z = 1
    for (let i = 0; i < 3; i++) z = stepZoom(z, 1)
    expect(z).toBe(1.3)
    for (let i = 0; i < 6; i++) z = stepZoom(z, -1)
    expect(z).toBe(0.7)
    expect(stepZoom(0.7, -1)).toBe(0.7)
    expect(stepZoom(1.5, 1)).toBe(1.5)
    expect(zoomPercent(1.1)).toBe('110%')
  })
})

const p = (pid: number, cpu: number, mem: number, hermes = false) => ({ pid, user: 'u', cpu, mem, rss: mem * 1e6, cmd: `c${pid}`, hermes })

describe('procs', () => {
  const list = [p(3, 1, 9), p(1, 9, 1, true), p(2, 5, 5, true)]
  it('sorts and filters without mutating the input', () => {
    const copy = [...list]
    expect(sortProcs(list, 'cpu', false).map((x) => x.pid)).toEqual([1, 2, 3])
    expect(sortProcs(list, 'mem', false).map((x) => x.pid)).toEqual([3, 2, 1])
    expect(sortProcs(list, 'pid', false).map((x) => x.pid)).toEqual([1, 2, 3])
    expect(sortProcs(list, 'cpu', true).map((x) => x.pid)).toEqual([1, 2])
    expect(list).toEqual(copy)
  })
  it('reports the sorted column only', () => {
    expect(ariaSort('cpu', 'cpu')).toBe('descending')
    expect(ariaSort('pid', 'pid')).toBe('ascending')
    expect(ariaSort('cpu', 'mem')).toBe('none')
  })
})

describe('validateConnectForm', () => {
  const base = {
    host: '203.0.113.42',
    port: '22',
    username: 'root',
    auth: 'password' as const,
    password: 'x',
    keyPath: null,
    keyEncrypted: false,
    passphrase: '',
    hasSavedSecret: false,
    sameTarget: false,
    sameKey: false
  }
  it('accepts a complete form', () => {
    expect(validateConnectForm(base)).toEqual({ ok: true, port: 22 })
  })
  it('rejects bad hosts, ports and missing fields', () => {
    expect(validateConnectForm({ ...base, host: '  ' })).toMatchObject({ ok: false, field: 'host' })
    expect(validateConnectForm({ ...base, host: 'my host' })).toMatchObject({ ok: false, field: 'host' })
    expect(validateConnectForm({ ...base, host: 'ssh://h' })).toMatchObject({ ok: false, field: 'host' })
    for (const port of ['', '0', '65536', 'abc', '22.5']) expect(validateConnectForm({ ...base, port })).toMatchObject({ ok: false, field: 'port' })
    expect(validateConnectForm({ ...base, username: '' })).toMatchObject({ ok: false, field: 'username' })
    expect(validateConnectForm({ ...base, password: '' })).toMatchObject({ ok: false, field: 'password' })
  })
  it('allows an empty password only for the same saved target', () => {
    expect(validateConnectForm({ ...base, password: '', hasSavedSecret: true, sameTarget: true })).toEqual({ ok: true, port: 22 })
    expect(validateConnectForm({ ...base, password: '', hasSavedSecret: true, sameTarget: false })).toMatchObject({ ok: false, field: 'password' })
  })
  it('key sign-in needs a key file, and the passphrase of an encrypted key unless it is saved for that key', () => {
    const key = { ...base, auth: 'key' as const, password: '' }
    expect(validateConnectForm(key)).toEqual({ ok: false, field: 'key', message: 'Choose the key file.' })
    expect(validateConnectForm({ ...key, keyPath: '/k' })).toEqual({ ok: true, port: 22 })
    expect(validateConnectForm({ ...key, keyPath: '/k', keyEncrypted: true })).toEqual({ ok: false, field: 'passphrase', message: 'Enter the passphrase of this key.' })
    expect(validateConnectForm({ ...key, keyPath: '/k', keyEncrypted: true, passphrase: 'pp' })).toEqual({ ok: true, port: 22 })
    expect(validateConnectForm({ ...key, keyPath: '/k', keyEncrypted: true, hasSavedSecret: true, sameKey: true })).toEqual({ ok: true, port: 22 })
    expect(validateConnectForm({ ...key, keyPath: '/k', keyEncrypted: true, hasSavedSecret: true, sameKey: false })).toMatchObject({ ok: false, field: 'passphrase' })
  })
})

describe('launchOutcome', () => {
  it.each([
    ['unreachable', 'dashboard-offline'],
    ['timeout', 'dashboard-offline'],
    ['auth', 'connect-edit'],
    ['hostkey-changed', 'connect-hostkey'],
    ['hostkey-unverified', 'connect-hostkey'],
    ['hermes-missing', 'connect-error'],
    ['unknown', 'connect-error']
  ] as const)('%s -> %s', (kind, expected) => {
    expect(launchOutcome(kind)).toBe(expected)
  })
  it('computes startup progress', () => {
    expect(startupPct([{ state: 'done' }, { state: 'done' }, { state: 'running' }, { state: 'pending' }, { state: 'pending' }])).toBe(40)
    expect(startupPct([])).toBe(0)
  })
})

describe('agent colours and initials', () => {
  it('is stable per profile and picks from the palette', () => {
    expect(agentColor('scout')).toBe(agentColor('scout'))
    expect(agentColor('scout')).toMatch(/^#[0-9A-F]{6}$/)
  })
  it('builds initials', () => {
    expect(initials('Scout')).toBe('SC')
    expect(initials('Scout Prime')).toBe('SP')
    expect(initials('  ')).toBe('?')
    expect(initials('data-miner')).toBe('DM')
  })
})

describe('NAV', () => {
  it('follows the sidebar order from the spec', () => {
    expect(NAV.map((n) => n.label)).toEqual(['Dashboard', 'Chat', 'Live feed', 'Sessions', 'Kanban', 'Usage', 'Skills', 'Logs', 'Second brain', 'Server'])
    expect(NAV.filter((n) => n.sepBefore).map((n) => n.label)).toEqual(['Sessions', 'Skills'])
  })
  it('maps Ctrl+1..9 then Ctrl+0 to the menu in order', () => {
    expect(routeForShortcut('1')).toBe('dashboard')
    expect(routeForShortcut('3')).toBe('feed')
    expect(routeForShortcut('9')).toBe('brain')
    expect(routeForShortcut('0')).toBe('server')
    expect(routeForShortcut('x')).toBeNull()
  })
})
