import { randomUUID } from 'node:crypto'
import type { ClientChannel } from 'ssh2'
import type { ChatEvent, ChatSendResult } from '@shared/ipc'
import { LineSplitter } from '../collector/lines'
import type { Execer } from '../connection/manager'
import { backendCmd, chatHelpCmd, chatPlainCmd, chatQuietFileCmd, chatStreamCmd, runSafe } from '../connection/remote'
import { ASSUMED_FLAGS, canStream, parseChatHelp, type ChatFlags } from './flags'
import { ChatLineParser } from './parser'

export interface UploadedFile {
  path: string
  name: string
  size: number
  mime: string
}

/** What the chat needs from the upload service: send the registered files and say where they went. */
export interface UploadPort {
  send(profile: string, attachmentIds: readonly string[]): Promise<{ ok: true; files: UploadedFile[] } | { ok: false; error: string }>
}

export interface ChatDeps {
  conn: Execer & { openStream(argv: readonly string[], stdin: string): Promise<ClientChannel>; isConnected(): boolean }
  hermesPath: () => string | null
  getSession: (profile: string) => string | null
  setSession: (profile: string, sessionId: string | null) => void
  emit: (e: ChatEvent) => void
  /** The sessions of this app for an agent, newest first, read from its state.db (used when the stream names no session). */
  recentSessions?: (profile: string, anySource: boolean) => Promise<{ id: string; startedAt: number | null }[]>
  uploads?: UploadPort
  log?: (msg: string) => void
  /** How long a stopped turn may take to end on its own before the channel is closed. */
  stopGraceMs?: number
}

export const MAX_MESSAGE = 100_000
const PROFILE = /^[A-Za-z0-9._-]{1,64}$/
const SESSION = /^[A-Za-z0-9._:-]{1,128}$/
/** The line `hermes chat -Q` prints after the answer, e.g. `session_id: 20261012_101500_ab12cd`. */
const SESSION_LINE = /^\s*session[ _-]?id\s*[:=]\s*(\S+)\s*$/i

interface Active {
  turn: string
  ch: ClientChannel
  stopped: boolean
  timer: NodeJS.Timeout | null
}

/**
 * ssh2's own `channel.signal()` refuses to send once stdin has been closed, and a chat message needs that EOF.
 * The protocol call underneath has no such rule (OpenSSH accepts the signal), so it is used here, and the
 * public method stays as the fallback. The channel is closed after a grace period if the process ignores INT.
 */
function interrupt(ch: ClientChannel): void {
  const c = ch as unknown as { outgoing?: { id: number; state: string }; _client?: { _protocol?: { signal?: (id: number, name: string) => void } } }
  try {
    if (c.outgoing && c._client?._protocol?.signal && c.outgoing.state !== 'closed' && c.outgoing.state !== 'closing') c._client._protocol.signal(c.outgoing.id, 'INT')
    else ch.signal('INT')
  } catch {
    /* the server may refuse signals; closing the channel is the fallback */
  }
}

const size = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** The line at the top of a message that tells the agent where its files are (F-CHAT-12). */
export function attachmentBlock(files: readonly UploadedFile[]): string {
  return files.map((f) => `[Attached: ${f.path} · ${size(f.size)} · ${f.mime}]`).join('\n')
}

/**
 * Runs one `hermes chat` per turn over SSH. The message goes over stdin (or as one quoted argument in the
 * plain fallback), never inside a shell string; nothing of it is stored here.
 */
export class ChatService {
  private active = new Map<string, Active>()
  /** Profiles that are uploading or starting; they count as busy before there is a channel. */
  private starting = new Set<string>()
  private flagsCache: ChatFlags | null = null

  constructor(private readonly d: ChatDeps) {}

  /** Forget what was learned about the server (called when the connection changes). */
  reset(): void {
    this.flagsCache = null
  }

  async flags(hermes: string): Promise<ChatFlags> {
    if (this.flagsCache) return this.flagsCache
    const r = await runSafe(this.d.conn, chatHelpCmd(hermes), 12_000)
    const parsed = r.code === 0 ? parseChatHelp(r.stdout || r.stderr) : null
    const known = parsed && (parsed.oneshot || parsed.queryFile || parsed.format || parsed.resume || parsed.source)
    this.flagsCache = known ? parsed : ASSUMED_FLAGS
    return this.flagsCache
  }

  async backend(profile: string): Promise<string | null> {
    const hermes = this.d.hermesPath()
    if (!hermes || !PROFILE.test(profile) || !this.d.conn.isConnected()) return null
    const r = await runSafe(this.d.conn, backendCmd(hermes, profile), 10_000)
    if (r.code !== 0) return null
    const v = r.stdout.trim().split('\n')[0]?.trim().replace(/^["']|["']$/g, '')
    return v ? v.slice(0, 40) : null
  }

  isBusy(profile: string): boolean {
    return this.active.has(profile) || this.starting.has(profile)
  }

  setSession(profile: string, sessionId: string | null): void {
    if (!PROFILE.test(profile) || (sessionId !== null && !SESSION.test(sessionId))) return
    this.d.setSession(profile, sessionId)
  }

  async send(req: { profile: string; text: string; attachmentIds: readonly string[] }): Promise<ChatSendResult> {
    const { profile, attachmentIds } = req
    const text = req.text.trim()
    if (!PROFILE.test(profile)) return { ok: false, error: 'bad-profile' }
    if (!this.d.conn.isConnected()) return { ok: false, error: 'not-connected' }
    if (text === '' && attachmentIds.length === 0) return { ok: false, error: 'empty' }
    if (text.length > MAX_MESSAGE) return { ok: false, error: 'too-long' }
    if (this.isBusy(profile)) return { ok: false, error: 'busy' }
    const hermes = this.d.hermesPath()
    if (!hermes) return { ok: false, error: 'hermes-missing' }

    // Claim the profile at once, so a second Send during the upload cannot start a second turn.
    this.starting.add(profile)
    try {
      let message = text
      if (attachmentIds.length > 0) {
        if (!this.d.uploads) return { ok: false, error: 'upload-failed', detail: 'Uploads are not available.' }
        const up = await this.d.uploads.send(profile, attachmentIds)
        if (!up.ok) return { ok: false, error: up.error === 'attachment-missing' ? 'attachment-missing' : 'upload-failed', detail: up.error }
        message = `${attachmentBlock(up.files)}${text ? `\n\n${text}` : ''}`
      }
      const flags = await this.flags(hermes)
      const stream = canStream(flags)
      const resume = flags.resume ? this.d.getSession(profile) : null
      // plain output can still take the message on stdin when --query-file exists (no length limit, nothing in the command)
      const viaStdin = stream || flags.queryFile
      const argv = stream ? chatStreamCmd(hermes, profile, resume) : viaStdin ? chatQuietFileCmd(hermes, profile, flags, resume) : chatPlainCmd(hermes, profile, message, flags.quiet, flags.source, resume)
      let ch: ClientChannel
      try {
        ch = await this.d.conn.openStream(argv, viaStdin ? message : '')
      } catch (e) {
        return { ok: false, error: 'failed-to-start', detail: e instanceof Error ? e.message : String(e) }
      }
      const turn = randomUUID()
      const act: Active = { turn, ch, stopped: false, timer: null }
      this.active.set(profile, act)
      this.run(profile, act, stream, resume !== null)
      this.d.emit({
        turn,
        profile,
        kind: 'start',
        mode: stream ? 'stream-json' : 'plain',
        ...(stream && flags.assumed ? { note: 'The chat options of this Hermes could not be checked.' } : {})
      })
      return { ok: true, turn }
    } finally {
      this.starting.delete(profile)
    }
  }

  private run(profile: string, act: Active, stream: boolean, resumed: boolean): void {
    const { turn, ch } = act
    const startedAt = Date.now() / 1000
    let sawSession = resumed
    const emit = (e: { kind: ChatEvent['kind'] } & Record<string, unknown>): void => this.d.emit({ turn, profile, ...e } as ChatEvent)
    const parser = new ChatLineParser()
    const lines = new LineSplitter()
    let stderr = ''
    let exitCode: number | null = null
    let sawResult = false
    let sawError = false
    ch.setEncoding('utf8')
    ch.stderr.setEncoding('utf8')
    // plain output: whole lines only, so that the session line of -Q can be taken out of the answer
    let tail = ''
    const plainLine = (line: string): void => {
      const m = SESSION_LINE.exec(line)
      if (m && SESSION.test(m[1]!)) {
        if (!sawSession) {
          sawSession = true
          this.d.setSession(profile, m[1]!)
          emit({ kind: 'session', sessionId: m[1]! })
        }
        return
      }
      emit({ kind: 'text', text: `${line}\n` })
    }
    const flushPlain = (): void => {
      if (tail === '') return
      const m = SESSION_LINE.exec(tail)
      if (m) plainLine(tail)
      else emit({ kind: 'text', text: tail })
      tail = ''
    }
    ch.on('data', (chunk: string) => {
      if (!stream) {
        tail += chunk
        const cut = tail.lastIndexOf('\n')
        if (cut < 0) return
        const whole = tail.slice(0, cut)
        tail = tail.slice(cut + 1)
        for (const line of whole.split('\n')) plainLine(line)
        return
      }
      for (const line of lines.push(chunk)) {
        for (const ev of parser.parse(line)) {
          if (ev.kind === 'session') {
            sawSession = true
            this.d.setSession(profile, ev.sessionId)
          }
          if (ev.kind === 'result') sawResult = true
          if (ev.kind === 'error') sawError = true
          emit(ev)
        }
      }
    })
    ch.stderr.on('data', (d: string) => {
      stderr = (stderr + d).slice(-4000)
    })
    ch.on('exit', (code: number | null) => {
      exitCode = typeof code === 'number' ? code : null
    })
    ch.on('close', () => {
      if (!stream) flushPlain()
      if (act.timer) clearTimeout(act.timer)
      if (this.active.get(profile) === act) this.active.delete(profile)
      if (!act.stopped && !sawResult && !sawError && (exitCode === null || exitCode !== 0)) {
        const tail = stderr.trim().split('\n').filter(Boolean).slice(-3).join(' ') || parser.noise.slice(-2).join(' ')
        emit({ kind: 'error', message: (tail || `Hermes ended with exit code ${exitCode ?? 'unknown'}`).slice(0, 500) })
      }
      emit({ kind: 'end', exitCode, stopped: act.stopped })
      if (!sawSession) void this.adoptSession(profile, startedAt, emit)
    })
  }

  /**
   * Plain output and some stream formats name no session. The new conversation is then found in the agent's own
   * state.db (newest session of this app that started with this turn), so the next message can continue it.
   */
  private async adoptSession(profile: string, startedAt: number, emit: (e: { kind: ChatEvent['kind'] } & Record<string, unknown>) => void): Promise<void> {
    if (!this.d.recentSessions || this.d.getSession(profile) !== null || !this.d.conn.isConnected()) return
    try {
      const list = await this.d.recentSessions(profile, this.flagsCache?.source === false)
      // the server clock may differ from this one, so the window is wide
      const mine = list.find((s) => s.startedAt !== null && s.startedAt >= startedAt - 300 && SESSION.test(s.id))
      if (!mine || this.d.getSession(profile) !== null) return
      this.d.setSession(profile, mine.id)
      emit({ kind: 'session', sessionId: mine.id })
    } catch (e) {
      this.d.log?.(`chat: could not find the session of the turn: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** Interrupts the running turn: INT first, and the channel is closed if Hermes does not finish on its own. */
  stop(turn: string): void {
    for (const act of this.active.values()) {
      if (act.turn !== turn || act.stopped) continue
      act.stopped = true
      interrupt(act.ch)
      act.timer = setTimeout(() => act.ch.close(), this.d.stopGraceMs ?? 3000)
      act.timer.unref()
    }
  }

  /** Ends every running turn (the connection is going away). */
  dispose(): void {
    for (const act of this.active.values()) {
      if (act.timer) clearTimeout(act.timer)
      act.ch.close()
    }
    this.active.clear()
    this.starting.clear()
    this.reset()
  }
}
