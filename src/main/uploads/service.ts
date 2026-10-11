import { randomUUID } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { basename } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import type { Attachment, UploadProgress } from '@shared/ipc'
import type { Execer } from '../connection/manager'
import { homeDirCmd, runSafe } from '../connection/remote'
import type { UploadedFile, UploadPort } from '../chat/service'
import { dayStamp, isImage, isUploadedFile, mimeOf, resolveUploadDir, sanitizeName, uniqueName } from './names'

export interface UploadDeps {
  conn: Execer & { sftp(): Promise<SFTPWrapper>; isConnected(): boolean }
  /** `chat.uploadDir` and `chat.maxUploadMb` from the settings. */
  uploadDir: () => string
  maxMb: () => number
  emit: (p: UploadProgress) => void
  /** The native file picker (returns local paths). */
  showOpen?: () => Promise<string[]>
  /** A small data: URL for an image, or undefined. */
  makeThumb?: (path: string) => string | undefined
  now?: () => Date
}

interface Registered {
  path: string
  name: string
  size: number
  mime: string
  problem?: string
}

const MAX_FILES = 20

const sftpCall = <T>(fn: (cb: (err: Error | null | undefined, v?: T) => void) => void): Promise<T | undefined> =>
  new Promise((resolve, reject) => fn((err, v) => (err ? reject(err) : resolve(v))))

/**
 * Registers the files the user picked and sends them over SFTP when they press Send. The local path never leaves
 * the main process: the renderer only gets ids. Nothing is written on the server before Send.
 */
export class UploadService implements UploadPort {
  private files = new Map<string, Registered>()
  private cancelled = new Set<string>()
  private running = new Map<string, () => void>()
  private homeCache: string | null = null

  constructor(private readonly d: UploadDeps) {}

  reset(): void {
    this.homeCache = null
  }

  async pick(): Promise<Attachment[]> {
    const paths = (await this.d.showOpen?.()) ?? []
    return this.register(paths)
  }

  /** Registers local files; unreadable ones and folders are skipped, too large ones are marked. */
  register(paths: readonly string[]): Attachment[] {
    const out: Attachment[] = []
    const limit = this.d.maxMb() * 1024 * 1024
    for (const p of paths.slice(0, MAX_FILES)) {
      let size: number
      try {
        const st = statSync(p)
        if (!st.isFile()) continue
        size = st.size
      } catch {
        continue
      }
      const name = sanitizeName(basename(p))
      const mime = mimeOf(name)
      const id = randomUUID()
      const problem = size > limit ? `Larger than ${this.d.maxMb()} MB` : size === 0 ? 'The file is empty' : undefined
      this.files.set(id, { path: p, name, size, mime, ...(problem ? { problem } : {}) })
      const thumb = isImage(mime) && size <= 8 * 1024 * 1024 ? this.d.makeThumb?.(p) : undefined
      out.push({ id, name, size, mime, ...(thumb ? { thumb } : {}), ...(problem ? { problem } : {}) })
    }
    return out
  }

  detach(id: string): void {
    this.running.get(id)?.()
    this.files.delete(id)
  }

  cancel(id: string): void {
    this.cancelled.add(id)
    this.running.get(id)?.()
  }

  private async home(): Promise<string> {
    if (this.homeCache) return this.homeCache
    const r = await runSafe(this.d.conn, homeDirCmd(), 10_000)
    const h = r.code === 0 ? r.stdout.trim() : ''
    if (!h.startsWith('/')) throw new Error('The home folder of the SSH user could not be read.')
    this.homeCache = h
    return h
  }

  /** The upload folder on the server. */
  async baseDir(): Promise<string> {
    return resolveUploadDir(this.d.uploadDir(), await this.home())
  }

  async send(profile: string, ids: readonly string[]): Promise<{ ok: true; files: UploadedFile[] } | { ok: false; error: string }> {
    const items: [string, Registered][] = []
    for (const id of ids) {
      const f = this.files.get(id)
      if (!f) return { ok: false, error: 'attachment-missing' }
      if (f.problem) return { ok: false, error: `${f.name}: ${f.problem}` }
      items.push([id, f])
    }
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(profile)) return { ok: false, error: 'bad-profile' }
    let sftp: SFTPWrapper | null = null
    const sent: UploadedFile[] = []
    const made: string[] = []
    try {
      const base = await this.baseDir()
      sftp = await this.d.conn.sftp()
      const dir = `${base}/${profile}/${dayStamp((this.d.now ?? (() => new Date()))())}`
      await this.mkdirs(sftp, dir)
      for (const [id, f] of items) {
        if (this.cancelled.has(id)) throw new Error('Upload cancelled.')
        const name = await uniqueName(f.name, (c) => this.exists(sftp!, `${dir}/${c}`))
        if (!name) throw new Error(`Too many files named ${f.name}.`)
        const remote = `${dir}/${name}`
        made.push(remote)
        await this.put(sftp, id, f, remote)
        sent.push({ path: remote, name, size: f.size, mime: f.mime })
      }
      return { ok: true, files: sent }
    } catch (e) {
      // A failed Send leaves nothing half-written behind.
      for (const p of made) await sftpCall<void>((cb) => sftp?.unlink(p, cb)).catch(() => {})
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      sftp?.end()
      for (const [id] of items) this.cancelled.delete(id)
    }
  }

  private async exists(sftp: SFTPWrapper, path: string): Promise<boolean> {
    return new Promise((resolve) => sftp.stat(path, (err) => resolve(!err)))
  }

  /** mkdir -p, with mode 0700; folders that exist already are left as they are. */
  private async mkdirs(sftp: SFTPWrapper, dir: string): Promise<void> {
    const parts = dir.split('/').filter(Boolean)
    let cur = ''
    for (const p of parts) {
      cur += `/${p}`
      if (await this.exists(sftp, cur)) continue
      await sftpCall<void>((cb) => sftp.mkdir(cur, { mode: 0o700 }, cb))
    }
  }

  private put(sftp: SFTPWrapper, id: string, f: Registered, remote: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const rs = createReadStream(f.path)
      const ws = sftp.createWriteStream(remote, { flags: 'wx', mode: 0o600 })
      let sent = 0
      let last = 0
      const emit = (state: UploadProgress['state'], extra: Partial<UploadProgress> = {}): void => this.d.emit({ id, state, sent, total: f.size, ...extra })
      let finished = false
      const done = (err?: Error): void => {
        if (finished) return
        finished = true
        this.running.delete(id)
        if (err) {
          emit(this.cancelled.has(id) ? 'cancelled' : 'error', { error: err.message })
          reject(err)
        } else {
          emit('done', { sent: f.size, remotePath: remote })
          resolve()
        }
      }
      const stop = (): void => {
        rs.destroy()
        ws.destroy()
        done(new Error('Upload cancelled.'))
      }
      this.running.set(id, stop)
      rs.on('data', (c: Buffer | string) => {
        sent += c.length
        const now = Date.now()
        if (now - last > 80) {
          last = now
          emit('uploading')
        }
      })
      rs.on('error', done)
      ws.on('error', done)
      ws.on('close', () => done())
      emit('uploading', { sent: 0 })
      rs.pipe(ws)
    })
  }

  /** Deletes one uploaded file, after the user confirmed. Anything that is not <base>/<agent>/<date>/<name> is refused. */
  async remove(path: string): Promise<{ ok: true } | { ok: false; error: string }> {
    let sftp: SFTPWrapper | null = null
    try {
      const base = await this.baseDir()
      if (!isUploadedFile(path, base)) return { ok: false, error: 'This file is not in the uploads folder.' }
      sftp = await this.d.conn.sftp()
      await sftpCall<void>((cb) => sftp!.unlink(path, cb))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      sftp?.end()
    }
  }
}
