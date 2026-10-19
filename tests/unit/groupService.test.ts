import { describe, expect, it } from 'vitest'
import type { GroupEvent } from '@shared/groups'
import type { ChatEvent } from '@shared/ipc'
import { GroupService, type MemberTurnReq, type MemberTurnStart } from '../../src/main/groups/service'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { waitFor } from '../helpers/wait'

type Script = string | 'FAIL-START' | 'SLOW' | 'ERROR'

function setup(opts: { profiles?: string[]; available?: boolean } = {}) {
  const store = new SettingsStore(':memory:')
  store.upsertConnection({ name: 'vps', host: '10.0.0.1', port: 22, username: 'hermes', remember: true })
  const scripts: Record<string, Script[]> = {}
  const prompts: { profile: string; message: string; saved: string | null; title: string }[] = []
  const events: GroupEvent[] = []
  const logs: string[] = []
  let n = 0
  const runTurn = async (r: MemberTurnReq): Promise<MemberTurnStart> => {
    prompts.push({ profile: r.profile, message: r.message, saved: r.saved, title: r.title })
    const next = scripts[r.profile]?.shift() ?? '(pass)'
    if (next === 'FAIL-START') return { ok: false, error: 'failed-to-start', detail: 'no session' }
    const ev = (e: Record<string, unknown>): void => r.emit({ turn: r.turn, profile: r.profile, ...e } as ChatEvent)
    r.onSession(`s-${r.profile}`)
    ev({ kind: 'start', mode: 'gateway' })
    let finish: () => void = () => {}
    const done = new Promise<void>((res) => (finish = res))
    let stopped = false
    const end = (): void => {
      ev({ kind: 'end', exitCode: stopped ? null : 0, stopped })
      finish()
    }
    if (next === 'SLOW') {
      return { ok: true, cancel: () => ((stopped = true), setTimeout(end, 5)), approve: () => false, done }
    }
    setTimeout(() => {
      if (next === 'ERROR') ev({ kind: 'error', message: 'Hermes reported an error.' })
      else ev({ kind: 'text', text: next })
      end()
    }, 2 + n++)
    return { ok: true, cancel: () => (stopped = true), approve: () => true, done }
  }
  const names = { ada: 'Ada', bo: 'Bo', cy: 'Cy', di: 'Di', ed: 'Ed', fu: 'Fu' }
  const svc = new GroupService({
    store: store.groups,
    runTurn,
    available: () => (opts.available === false ? { ok: false, reason: 'The Hermes TUI gateway is turned off.' } : { ok: true }),
    isConnected: () => true,
    profiles: () => opts.profiles ?? ['ada', 'bo', 'cy', 'di', 'ed', 'fu'],
    names: () => names,
    emit: (e) => events.push(e),
    log: (m) => logs.push(m)
  })
  const ended = () => events.find((e) => e.kind === 'run-end') as Extract<GroupEvent, { kind: 'run-end' }> | undefined
  const room = (members: string[]) => {
    const r = svc.create('Ops', members)
    if ('error' in r) throw new Error(r.error)
    return r.id
  }
  return { store, svc, scripts, prompts, events, logs, ended, room }
}

describe('GroupService', () => {
  it('validates new rooms', () => {
    const { svc } = setup({ profiles: ['ada', 'bo'] })
    expect(svc.create('  ', ['ada', 'bo'])).toEqual({ error: 'The room needs a name of 1 to 60 characters.' })
    expect(svc.create('Ops', ['ada'])).toEqual({ error: 'A room has 2 to 6 agents.' })
    expect(svc.create('Ops', ['ada', 'ada'])).toEqual({ error: 'A room has 2 to 6 agents.' })
    expect(svc.create('Ops', ['ada', 'zed'])).toEqual({ error: 'zed is not an agent on this server.' })
    const r = svc.create('Ops', ['ada', 'bo'])
    expect('id' in r && r.members).toEqual(['ada', 'bo'])
  })

  it('lets everyone answer, then settles when a round is silent', async () => {
    const t = setup()
    const id = t.room(['ada', 'bo'])
    t.scripts['ada'] = ['Ada here']
    t.scripts['bo'] = ['Bo here']
    expect(await t.svc.send(id, 'hello room')).toEqual({ ok: true })
    await waitFor(() => !!t.ended(), { label: 'run end' })
    expect(t.ended()).toMatchObject({ reason: 'settled', replies: 2, needsYou: null })
    const log = t.store.groups.entries(id)
    // in round two bo has nothing new to read, so only ada is asked, and passes
    expect(log.map((e) => `${e.author}:${e.status}`)).toEqual(['user:ok', 'ada:ok', 'bo:ok', 'ada:pass'])
    // each member is titled by the room and sees only what is new to it, never its own replies
    expect(t.prompts[0]!.title).toBe(`Group: ${id}`)
    expect(t.prompts[0]!.message).toContain('  User (user): hello room')
    expect(t.prompts[1]!.message).toContain('  Ada: Ada here')
    expect(t.prompts[1]!.message).not.toContain('Bo (you)')
    expect(t.prompts[2]!.profile).toBe('ada')
    expect(t.prompts[2]!.message).toContain('  Bo: Bo here')
    expect(t.prompts[2]!.message).not.toContain('hello room')
    // the session each member got is kept for the next send
    expect(t.store.groups.members(id).map((m) => m.sessionId)).toEqual(['s-ada', 's-bo'])
    expect(t.prompts[2]!.saved).toBe('s-ada')
    expect(t.svc.running(id)).toBe(false)
  })

  it('lets only the mentioned member answer, and a reply can pull another one in', async () => {
    const t = setup()
    const id = t.room(['ada', 'bo', 'cy'])
    t.scripts['bo'] = ['ok, @cy can you check?', '(pass)']
    t.scripts['cy'] = ['checked']
    await t.svc.send(id, '@bo please start')
    await waitFor(() => !!t.ended(), { label: 'run end' })
    // round 1: bo; round 2: cy (pulled in) then bo; round 3: nobody has anything new
    expect(t.prompts.map((p) => p.profile)).toEqual(['bo', 'cy', 'bo'])
    expect(t.ended()).toMatchObject({ reason: 'settled', replies: 2 })
  })

  it('stops at ten replies or three rounds', async () => {
    const t = setup()
    const id = t.room(['ada', 'bo', 'cy', 'di', 'ed', 'fu'])
    for (const p of ['ada', 'bo', 'cy', 'di', 'ed', 'fu']) t.scripts[p] = ['one', 'two', 'three']
    await t.svc.send(id, 'go')
    await waitFor(() => !!t.ended(), { label: 'run end' })
    expect(t.ended()).toMatchObject({ reason: 'cap', replies: 10 })

    const u = setup()
    const id2 = u.room(['ada', 'bo'])
    u.scripts['ada'] = ['a1', 'a2', 'a3', 'a4']
    u.scripts['bo'] = ['b1', 'b2', 'b3', 'b4']
    await u.svc.send(id2, 'go')
    await waitFor(() => !!u.ended(), { label: 'run end' })
    // a member is only asked when something is new to it: a1 b1 | a2 | b2, then three rounds are over
    expect(u.ended()).toMatchObject({ reason: 'cap', replies: 4 })
  })

  it('records failures and missing agents and goes on', async () => {
    const t = setup({ profiles: ['ada', 'bo'] })
    const id = t.room(['ada', 'bo'])
    t.store.groups.update(id, { members: ['ada', 'bo', 'cy'] })
    t.scripts['ada'] = ['FAIL-START']
    t.scripts['bo'] = ['ERROR']
    await t.svc.send(id, 'hi')
    await waitFor(() => !!t.ended(), { label: 'run end' })
    const log = t.store.groups.entries(id)
    expect(log.slice(1, 4).map((e) => `${e.author}:${e.status}:${e.text}`)).toEqual(['ada:failed:no session', 'bo:failed:Hermes reported an error.', 'cy:failed:Not on the server any more.'])
    expect(t.ended()).toMatchObject({ reason: 'settled', replies: 0 })
  })

  it('marks a room that needs the user', async () => {
    const t = setup()
    const id = t.room(['ada', 'bo'])
    t.scripts['ada'] = ['@user which one?']
    await t.svc.send(id, 'pick a plan')
    await waitFor(() => !!t.ended(), { label: 'run end' })
    expect(t.ended()).toMatchObject({ needsYou: 'ada' })
    expect(t.store.groups.get(id)?.needsYou).toBe(true)
    await t.svc.send(id, 'plan A')
    expect(t.store.groups.get(id)?.needsYou).toBe(false)
  })

  it('refuses a second send while running, and stops a run', async () => {
    const t = setup()
    const id = t.room(['ada', 'bo'])
    t.scripts['ada'] = ['SLOW']
    await t.svc.send(id, 'take your time')
    await waitFor(() => t.prompts.length === 1, { label: 'turn' })
    expect(t.svc.running(id)).toBe(true)
    expect(await t.svc.send(id, 'again')).toEqual({ ok: false, error: 'busy' })
    t.svc.stop(id)
    await waitFor(() => !!t.ended(), { label: 'run end' })
    expect(t.ended()).toMatchObject({ reason: 'stopped' })
    expect(t.store.groups.entries(id).map((e) => `${e.author}:${e.status}`)).toEqual(['user:ok', 'ada:stopped'])
    expect(t.prompts).toHaveLength(1)
  })

  it('writes nothing more for a room deleted while it runs', async () => {
    const t = setup()
    const id = t.room(['ada', 'bo'])
    t.scripts['ada'] = ['SLOW']
    await t.svc.send(id, 'hi')
    await waitFor(() => t.prompts.length === 1, { label: 'turn' })
    t.svc.remove(id)
    await waitFor(() => !!t.ended(), { label: 'run end' })
    expect(t.store.groups.entries(id)).toEqual([])
    expect(t.store.groups.lastSeq(id)).toBe(0)
  })

  it('needs the gateway and checks the message', async () => {
    const t = setup({ available: false })
    const id = t.room(['ada', 'bo'])
    expect(await t.svc.send(id, 'hi')).toEqual({ ok: false, error: 'no-gateway', detail: 'The Hermes TUI gateway is turned off.' })
    expect(await t.svc.send(id, '   ')).toEqual({ ok: false, error: 'empty' })
    expect(await t.svc.send('mc-zzzzzzzzzz', 'hi')).toEqual({ ok: false, error: 'not-found' })
    expect(t.svc.list()).toMatchObject({ running: [], gateway: { ok: false } })
    expect(t.store.groups.entries(id)).toEqual([])
  })

  it('ends a run as stopped when the connection goes', async () => {
    const t = setup()
    const id = t.room(['ada', 'bo'])
    t.scripts['ada'] = ['SLOW']
    await t.svc.send(id, 'secretword')
    await waitFor(() => t.prompts.length === 1, { label: 'turn' })
    t.svc.dispose()
    await waitFor(() => !!t.ended(), { label: 'run end' })
    expect(t.ended()).toMatchObject({ reason: 'stopped' })
    expect(t.logs.join(' ')).not.toContain('secretword')
  })
})
