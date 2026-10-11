import { closeSync, existsSync, mkdirSync, openSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { utils, type SFTPWrapper } from 'ssh2'

export interface SftpOp {
  op: 'mkdir' | 'open' | 'remove'
  path: string
  /** The permission bits the client asked for. */
  mode?: number
}

const S = utils.sftp.STATUS_CODE

/** A small SFTP server over a local folder: just what uploads use (stat, mkdir, create and write, remove). */
export function attachSftp(sftp: SFTPWrapper, toLocal: (remote: string) => string, log: SftpOp[]): void {
  const handles = new Map<number, { fd: number; path: string }>()
  let next = 1
  const buf = (n: number): Buffer => {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(n)
    return b
  }
  const handleOf = (h: Buffer): { fd: number; path: string } | undefined => handles.get(h.readUInt32BE(0))

  sftp.on('REALPATH', (id, path) => sftp.name(id, [{ filename: path, longname: path, attrs: {} as never }]))
  const stat = (id: number, path: string): void => {
    // the folders above the fake home exist on a real server
    if (path === '/' || path === '/home') return sftp.attrs(id, { mode: 0o40755, size: 0, uid: 0, gid: 0, atime: 0, mtime: 0 })
    try {
      const st = statSync(toLocal(path))
      sftp.attrs(id, { mode: st.mode, size: st.size, uid: 0, gid: 0, atime: Math.floor(st.atimeMs / 1000), mtime: Math.floor(st.mtimeMs / 1000) })
    } catch {
      sftp.status(id, S.NO_SUCH_FILE)
    }
  }
  sftp.on('STAT', stat)
  sftp.on('LSTAT', stat)
  sftp.on('MKDIR', (id, path, attrs) => {
    try {
      mkdirSync(toLocal(path))
      log.push({ op: 'mkdir', path, ...(attrs.mode !== undefined ? { mode: attrs.mode & 0o777 } : {}) })
      sftp.status(id, S.OK)
    } catch {
      sftp.status(id, S.FAILURE)
    }
  })
  sftp.on('OPEN', (id, path, flags, attrs) => {
    const local = toLocal(path)
    const f = utils.sftp.flagsToString(flags) ?? 'w'
    if (f.includes('x') && existsSync(local)) return sftp.status(id, S.FAILURE)
    try {
      const fd = openSync(local, f)
      const h = next++
      handles.set(h, { fd, path })
      log.push({ op: 'open', path, ...(attrs.mode !== undefined ? { mode: attrs.mode & 0o777 } : {}) })
      sftp.handle(id, buf(h))
    } catch {
      sftp.status(id, S.FAILURE)
    }
  })
  sftp.on('WRITE', (id, h, offset, data) => {
    const hd = handleOf(h)
    if (!hd) return sftp.status(id, S.FAILURE)
    writeSync(hd.fd, data, 0, data.length, offset)
    sftp.status(id, S.OK)
  })
  sftp.on('CLOSE', (id, h) => {
    const hd = handleOf(h)
    if (hd) {
      closeSync(hd.fd)
      handles.delete(h.readUInt32BE(0))
    }
    sftp.status(id, S.OK)
  })
  sftp.on('REMOVE', (id, path) => {
    try {
      unlinkSync(toLocal(path))
      log.push({ op: 'remove', path })
      sftp.status(id, S.OK)
    } catch {
      sftp.status(id, S.NO_SUCH_FILE)
    }
  })
  sftp.on('OPENDIR', (id) => sftp.status(id, S.FAILURE))
  sftp.on('READDIR', (id) => sftp.status(id, S.EOF))
}
