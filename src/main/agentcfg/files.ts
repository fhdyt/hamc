import { createHash, randomBytes } from 'node:crypto'
import type { SFTPWrapper } from 'ssh2'
import {
  FILE_LIMITS,
  MAX_FILE_BYTES,
  PROFILE_RE,
  filePath,
  overLimit,
  type AgentFile,
  type AgentFileKind,
  type FileReadResult,
  type FileWriteResult
} from '@shared/agentCfg'

export interface FileDeps {
  conn: { sftp(): Promise<SFTPWrapper>; isConnected(): boolean }
  /** The Hermes home on the server (from the preflight), or null before the connection is ready. */
  home: () => string | null
  random?: () => string
  log?: (m: string) => void
}

interface Raw {
  file: AgentFile
  mode: number | null
}

const NO_SUCH_FILE = 2

const call = <T>(fn: (cb: (err: Error | null | undefined, v?: T) => void) => void): Promise<T | undefined> =>
  new Promise((resolve, reject) => fn((err, v) => (err ? reject(err) : resolve(v))))

const isMissing = (e: unknown): boolean => (e as { code?: number } | null)?.code === NO_SUCH_FILE

export const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')

const dirOf = (p: string): string => p.slice(0, p.lastIndexOf('/'))
const nameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

/**
 * Reads and writes SOUL.md, MEMORY.md and USER.md of a profile over SFTP. A write checks the hash the editor
 * started from, goes to a temp file in the same folder and is renamed over the original, so a reader never sees
 * half a file. The original permission bits are kept. The renderer names the profile and the file kind, never a path.
 */
export class AgentFileService {
  constructor(private readonly d: FileDeps) {}

  private target(profile: string, kind: AgentFileKind): { path: string } | { error: 'not-connected' | 'bad-profile' } {
    if (!PROFILE_RE.test(profile)) return { error: 'bad-profile' }
    const home = this.d.home()
    if (!home || !this.d.conn.isConnected()) return { error: 'not-connected' }
    return { path: filePath(home, profile, kind) }
  }

  private async readRaw(sftp: SFTPWrapper, path: string): Promise<Raw | 'too-large'> {
    let st: { size: number; mtime: number; mode: number }
    try {
      st = (await call<{ size: number; mtime: number; mode: number }>((cb) => sftp.stat(path, cb as never)))!
    } catch (e) {
      if (isMissing(e)) return { file: { exists: false, text: '', hash: null, mtime: null }, mode: null }
      throw e
    }
    if (st.size > MAX_FILE_BYTES) return 'too-large'
    const buf = (await call<Buffer>((cb) => sftp.readFile(path, cb as never))) ?? Buffer.alloc(0)
    if (buf.length > MAX_FILE_BYTES) return 'too-large'
    return { file: { exists: true, text: buf.toString('utf8'), hash: sha256(buf), mtime: st.mtime }, mode: st.mode & 0o777 }
  }

  async read(profile: string, kind: AgentFileKind): Promise<FileReadResult> {
    const t = this.target(profile, kind)
    if ('error' in t) return { ok: false, error: t.error }
    let sftp: SFTPWrapper | null = null
    try {
      sftp = await this.d.conn.sftp()
      const raw = await this.readRaw(sftp, t.path)
      return raw === 'too-large' ? { ok: false, error: 'too-large' } : { ok: true, file: raw.file }
    } catch (e) {
      return { ok: false, error: 'failed', detail: e instanceof Error ? e.message : String(e) }
    } finally {
      sftp?.end()
    }
  }

  async write(profile: string, kind: AgentFileKind, text: string, baseHash: string | null): Promise<FileWriteResult> {
    const t = this.target(profile, kind)
    if ('error' in t) return { ok: false, error: t.error }
    if (overLimit(kind, text)) return { ok: false, error: 'too-long', detail: `The limit is ${FILE_LIMITS[kind]} characters.` }
    const data = Buffer.from(text, 'utf8')
    if (data.length > MAX_FILE_BYTES) return { ok: false, error: 'too-large' }
    let sftp: SFTPWrapper | null = null
    let tmp: string | null = null
    try {
      sftp = await this.d.conn.sftp()
      const cur = await this.readRaw(sftp, t.path)
      if (cur === 'too-large') return { ok: false, error: 'too-large' }
      if (cur.file.hash !== baseHash) return { ok: false, error: 'conflict', theirs: cur.file }
      if (cur.file.hash === sha256(data)) return { ok: true, file: cur.file }

      const dir = dirOf(t.path)
      await this.ensureDir(sftp, dir)
      const mode = cur.mode ?? 0o600
      tmp = `${dir}/.${nameOf(t.path)}.mc-${(this.d.random ?? (() => randomBytes(6).toString('hex')))()}`
      await this.put(sftp, tmp, data, mode)
      await call<void>((cb) => sftp!.chmod(tmp!, mode, cb as never))
      await this.rename(sftp, tmp, t.path)
      tmp = null
      const after = await this.readRaw(sftp, t.path)
      if (after === 'too-large') return { ok: false, error: 'too-large' }
      this.d.log?.(`agent file saved: ${profile} ${kind} (${data.length} bytes)`)
      return { ok: true, file: after.file }
    } catch (e) {
      if (tmp && sftp) await call<void>((cb) => sftp!.unlink(tmp!, cb as never)).catch(() => {})
      return { ok: false, error: 'failed', detail: e instanceof Error ? e.message : String(e) }
    } finally {
      sftp?.end()
    }
  }

  /** `memories/` may not exist yet on a fresh profile; the profile folder itself must. */
  private async ensureDir(sftp: SFTPWrapper, dir: string): Promise<void> {
    try {
      await call<unknown>((cb) => sftp.stat(dir, cb as never))
    } catch (e) {
      if (!isMissing(e) || nameOf(dir) !== 'memories') throw e
      await call<void>((cb) => sftp.mkdir(dir, { mode: 0o755 }, cb as never))
    }
  }

  private put(sftp: SFTPWrapper, path: string, data: Buffer, mode: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = sftp.createWriteStream(path, { flags: 'wx', mode })
      ws.on('error', reject)
      ws.on('close', () => resolve())
      ws.end(data)
    })
  }

  /** POSIX rename when the server offers it (atomic over an existing file); else rename, removing the target if it blocks. */
  private async rename(sftp: SFTPWrapper, from: string, to: string): Promise<void> {
    try {
      await call<void>((cb) => sftp.ext_openssh_rename(from, to, cb as never))
      return
    } catch {
      /* the server has no posix-rename: use the plain one */
    }
    try {
      await call<void>((cb) => sftp.rename(from, to, cb as never))
    } catch {
      await call<void>((cb) => sftp.unlink(to, cb as never))
      await call<void>((cb) => sftp.rename(from, to, cb as never))
    }
  }
}
