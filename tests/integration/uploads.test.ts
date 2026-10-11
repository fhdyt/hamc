import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '@shared/channels'
import type { ChatEvent, ConnectRequest, UploadProgress } from '@shared/ipc'
import { loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { MissionSession } from '../../src/main/session'
import { dayStamp } from '../../src/main/uploads/names'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, snapshotTree, type FixtureDirs } from '../helpers/fixture'
import { removeDir, waitFor } from '../helpers/wait'

const secrets = {
  status: () => ({ available: true, reason: null }),
  encrypt: (s: string) => Buffer.from('enc:' + s),
  decrypt: (b: Buffer) => (b.toString().startsWith('enc:') ? b.toString().slice(4) : null)
}
const script = loadCollectorScript('collector/mc_collector.py')

let dir: string
let fx: FixtureDirs
let srv: FakeSsh
let local: string
const live: MissionSession[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-up-'))
  fx = buildFixture(join(dir, 'fx'))
  local = join(dir, 'local')
  mkdirSync(local)
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
  removeDir(dir)
})

const upDir = (): string => join(fx.root, 'home', 'hermes-uploads')
const file = (name: string, content: string | Buffer): string => {
  const p = join(local, name)
  writeFileSync(p, content)
  return p
}

async function setup() {
  srv = await startFakeSsh({ fixture: fx })
  const store = new SettingsStore(':memory:')
  const chat: ChatEvent[] = []
  const progress: UploadProgress[] = []
  const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) }, 5000)
  const session = new MissionSession({
    manager,
    store,
    secrets,
    collectorScript: script,
    send: (channel, payload) => {
      if (channel === IPC.evChat) chat.push(payload as ChatEvent)
      if (channel === IPC.evUpload) progress.push(payload as UploadProgress)
    },
    backoff: () => 50,
    latencyIntervalMs: 500,
    chatStopGraceMs: 400
  })
  live.push(session)
  store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
  const req: ConnectRequest = { host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', remember: true }
  expect((await session.connect(req)).ok).toBe(true)
  return { session, store, chat, progress, ended: (n = 1): boolean => chat.filter((e) => e.kind === 'end').length >= n }
}

describe('attachments', () => {
  it('registers files, marks the ones that cannot be sent, and keeps local paths out of the result', async () => {
    const { session, store } = await setup()
    store.setSetting('chat.maxUploadMb', 1)
    const small = file('notes.txt', 'hello')
    const big = file('big.bin', Buffer.alloc(1024 * 1024 + 10))
    const empty = file('empty.txt', '')
    const att = await session.chatAttach([small, big, empty, join(local, 'missing.txt'), local])
    expect(att.map((a) => [a.name, a.problem ?? null])).toEqual([
      ['notes.txt', null],
      ['big.bin', 'Larger than 1 MB'],
      ['empty.txt', 'The file is empty']
    ])
    expect(att[0]).toMatchObject({ size: 5, mime: 'text/plain' })
    expect(JSON.stringify(att)).not.toContain(local)
    expect(att[0]!.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('sends nothing to the server until Send, and detach forgets a file', async () => {
    const { session } = await setup()
    const [a] = session.chatAttach([file('a.txt', 'aaa')])
    expect(srv.sftpLog).toEqual([])
    session.chatDetach(a!.id)
    const r = await session.chatSend({ profile: 'default', text: 'see attached', attachmentIds: [a!.id] })
    expect(r).toMatchObject({ ok: false, error: 'attachment-missing' })
    expect(srv.sftpLog).toEqual([])
  })
})

describe('uploading with a message', () => {
  it('uploads to <home>/hermes-uploads/<agent>/<date>/, tells the agent where, and uses safe modes', async () => {
    const { session, progress, chat, ended } = await setup()
    const [a, b] = session.chatAttach([file('report.pdf', 'pdf bytes here'), file('.env', 'SECRET=1')])
    const r = await session.chatSend({ profile: 'default', text: 'please read these', attachmentIds: [a!.id, b!.id] })
    expect(r.ok).toBe(true)
    await waitFor(() => ended(), { label: 'chat ended', timeout: 25_000 })
    const day = dayStamp(new Date())
    const target = join(upDir(), 'default', day)
    expect(readdirSync(target).sort()).toEqual(['_env', 'report.pdf'])
    expect(readFileSync(join(target, 'report.pdf'), 'utf8')).toBe('pdf bytes here')
    // permissions asked for: folders 0700, files 0600
    expect(srv.sftpLog.filter((o) => o.op === 'mkdir').every((o) => o.mode === 0o700)).toBe(true)
    expect(srv.sftpLog.filter((o) => o.op === 'mkdir').map((o) => o.path)).toEqual(['/home/hermes/hermes-uploads', '/home/hermes/hermes-uploads/default', `/home/hermes/hermes-uploads/default/${day}`])
    expect(srv.sftpLog.filter((o) => o.op === 'open').every((o) => o.mode === 0o600)).toBe(true)
    // progress ended in done with the remote path
    const done = progress.filter((p) => p.state === 'done')
    expect(done.map((p) => p.remotePath)).toEqual([`/home/hermes/hermes-uploads/default/${day}/report.pdf`, `/home/hermes/hermes-uploads/default/${day}/_env`])
    expect(progress.some((p) => p.state === 'uploading')).toBe(true)
    // the message the agent got starts with the attachment lines
    const sessions = await session.chatSessions('default')
    const preview = sessions.ok ? (sessions.data.sessions[0]?.preview ?? '') : ''
    expect(preview.startsWith(`[Attached: /home/hermes/hermes-uploads/default/${day}/report.pdf`)).toBe(true)
    expect(chat.some((e) => e.kind === 'error')).toBe(false)
  })

  it('does not overwrite: a second file with the same name gets -1', async () => {
    const { session, ended } = await setup()
    const [a] = session.chatAttach([file('same.txt', 'one')])
    await session.chatSend({ profile: 'default', text: 'first', attachmentIds: [a!.id] })
    await waitFor(() => ended(1), { label: 'first', timeout: 25_000 })
    const [b] = session.chatAttach([file('same.txt', 'two')])
    await session.chatSend({ profile: 'default', text: 'second', attachmentIds: [b!.id] })
    await waitFor(() => ended(2), { label: 'second', timeout: 25_000 })
    const target = join(upDir(), 'default', dayStamp(new Date()))
    expect(readdirSync(target).sort()).toEqual(['same-1.txt', 'same.txt'])
    expect(readFileSync(join(target, 'same.txt'), 'utf8')).toBe('one')
    expect(readFileSync(join(target, 'same-1.txt'), 'utf8')).toBe('two')
  })

  it('refuses a file over the size limit and writes nothing', async () => {
    const { session, store } = await setup()
    store.setSetting('chat.maxUploadMb', 1)
    const [big] = session.chatAttach([file('big.bin', Buffer.alloc(1024 * 1024 + 1))])
    const r = await session.chatSend({ profile: 'default', text: 'too big', attachmentIds: [big!.id] })
    expect(r).toMatchObject({ ok: false, error: 'upload-failed', detail: expect.stringContaining('Larger than 1 MB') })
    expect(srv.sftpLog).toEqual([])
    expect(existsSync(upDir())).toBe(false)
    expect(srv.execLog.some((a) => a.includes('chat') && !a.includes('--help'))).toBe(false)
  })

  it('does not start the chat when the upload fails, and removes what was half sent', async () => {
    const { session } = await setup()
    const [a, b] = session.chatAttach([file('ok.txt', 'fine'), file('gone.txt', 'will vanish')])
    const { unlinkSync } = await import('node:fs')
    unlinkSync(join(local, 'gone.txt'))
    const r = await session.chatSend({ profile: 'default', text: 'x', attachmentIds: [a!.id, b!.id] })
    expect(r).toMatchObject({ ok: false, error: 'upload-failed' })
    const target = join(upDir(), 'default', dayStamp(new Date()))
    expect(existsSync(join(target, 'ok.txt'))).toBe(false)
    expect(srv.execLog.some((a) => a.includes('chat') && !a.includes('--help'))).toBe(false)
    expect(await session.chatSend({ profile: 'default', text: 'again', attachmentIds: [] })).toMatchObject({ ok: true })
  })

  it('cancelling an upload stops it, and nothing partial stays', async () => {
    const { session, progress } = await setup()
    const [a] = session.chatAttach([file('huge.bin', Buffer.alloc(8 * 1024 * 1024))])
    const sending = session.chatSend({ profile: 'default', text: 'cancel me', attachmentIds: [a!.id] })
    await waitFor(() => progress.some((p) => p.state === 'uploading'), { label: 'uploading', timeout: 15_000, interval: 5 })
    session.uploadsCancel(a!.id)
    const r = await sending
    expect(r).toMatchObject({ ok: false, error: 'upload-failed' })
    expect(progress.some((p) => p.state === 'cancelled')).toBe(true)
    const target = join(upDir(), 'default', dayStamp(new Date()))
    expect(existsSync(join(target, 'huge.bin'))).toBe(false)
    expect(await session.chatSend({ profile: 'default', text: 'after cancel', attachmentIds: [] })).toMatchObject({ ok: true })
  })
})

describe('listing and deleting uploads', () => {
  it('lists the uploaded files and deletes one only inside the uploads folder', async () => {
    const { session, ended } = await setup()
    const [a] = session.chatAttach([file('keep.txt', 'k'), ])
    const [b] = session.chatAttach([file('drop.txt', 'd')])
    await session.chatSend({ profile: 'default', text: 'files', attachmentIds: [a!.id, b!.id] })
    await waitFor(() => ended(), { label: 'end', timeout: 25_000 })
    const day = dayStamp(new Date())
    const list = await session.uploadsList()
    expect(list.ok).toBe(true)
    if (!list.ok) return
    expect(list.data.dir).toBe('/home/hermes/hermes-uploads')
    expect(list.data.files.map((f) => `${f.agent}/${f.date}/${f.name}`).sort()).toEqual([`default/${day}/drop.txt`, `default/${day}/keep.txt`])
    const drop = list.data.files.find((f) => f.name === 'drop.txt')!
    expect(drop.path).toBe(`/home/hermes/hermes-uploads/default/${day}/drop.txt`)

    // refused: outside the uploads folder, a folder level, parent segments
    for (const bad of ['/home/hermes/.hermes/state.db', `/home/hermes/hermes-uploads/default/${day}`, `/home/hermes/hermes-uploads/default/${day}/../../../.hermes/state.db`, '/etc/passwd']) {
      expect(await session.uploadsRemove(bad)).toMatchObject({ ok: false })
    }
    expect(srv.sftpLog.filter((o) => o.op === 'remove')).toEqual([])
    expect(await session.uploadsRemove(drop.path)).toEqual({ ok: true })
    expect(existsSync(join(upDir(), 'default', day, 'drop.txt'))).toBe(false)
    expect(existsSync(join(upDir(), 'default', day, 'keep.txt'))).toBe(true)
    const after = await session.uploadsList()
    expect(after.ok && after.data.files.map((f) => f.name)).toEqual(['keep.txt'])
  })

  it('reports an empty list when nothing was uploaded', async () => {
    const { session } = await setup()
    const list = await session.uploadsList()
    expect(list.ok && list.data.files).toEqual([])
    expect(list.ok && list.data.exists).toBe(false)
  })
})

describe('uploads and the Zero-Change rule', () => {
  it('writes only inside the uploads folder, only after Send, and touches nothing else of the server', async () => {
    const { session, ended } = await setup()
    const vaultBefore = snapshotTree(join(fx.root, 'home', 'vault'))
    const hermesBefore = Object.keys(snapshotTree(fx.home)).filter((k) => !k.endsWith('state.db') && !k.includes('state.db'))
    const [a] = session.chatAttach([file('x.txt', 'x')])
    expect(srv.sftpLog).toEqual([])
    await session.chatSend({ profile: 'default', text: 'x', attachmentIds: [a!.id] })
    await waitFor(() => ended(), { label: 'end', timeout: 25_000 })
    for (const op of srv.sftpLog) expect(op.path.startsWith('/home/hermes/hermes-uploads')).toBe(true)
    expect(snapshotTree(join(fx.root, 'home', 'vault'))).toEqual(vaultBefore)
    expect(Object.keys(snapshotTree(fx.home)).filter((k) => !k.includes('state.db'))).toEqual(hermesBefore)
  })
})
