import { redactConfig } from './redact'

/** What the backup needs from SFTP; `lstat` so symlinks are never followed. */
export interface BackupFs {
  lstat(path: string): Promise<{ size: number; mtime: number; isDir: boolean; isFile: boolean } | null>
  readdir(path: string): Promise<string[]>
  readFile(path: string): Promise<Buffer>
}

export const BACKUP_MAX_BYTES = 100 * 1024 * 1024
const NEVER = new Set(['.env', 'auth.json', 'mcp-tokens'])
const SKIP_DIRS = new Set(['.git', '.venv', 'venv', 'node_modules', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'site-packages', '.locks'])

export interface BackupEntry {
  name: string
  data: Buffer
  mtime: Date
}

/**
 * Reads the parts of one profile that F-CFG-23 lists, read-only over SFTP: SOUL.md, memories/, profile.yaml,
 * config.yaml (secrets blanked here, before anything is stored), cron/jobs.json, skills/ and, when asked, state.db.
 * `.env`, `auth.json` and `mcp-tokens/` are never opened, wherever they appear.
 */
export async function collectBackup(fs: BackupFs, root: string, includeStateDb: boolean): Promise<{ entries: BackupEntry[]; skipped: string[]; bytes: number }> {
  const entries: BackupEntry[] = []
  const skipped: string[] = []
  let bytes = 0
  const add = (name: string, data: Buffer, mtime: number): boolean => {
    if (bytes + data.length > BACKUP_MAX_BYTES) {
      skipped.push(`${name} (the backup would pass 100 MB)`)
      return false
    }
    bytes += data.length
    entries.push({ name, data, mtime: new Date(mtime * 1000) })
    return true
  }
  const file = async (rel: string, transform?: (b: Buffer) => Buffer): Promise<void> => {
    const st = await fs.lstat(`${root}/${rel}`)
    if (!st || !st.isFile) return
    if (bytes + st.size > BACKUP_MAX_BYTES) {
      skipped.push(`${rel} (the backup would pass 100 MB)`)
      return
    }
    const raw = await fs.readFile(`${root}/${rel}`)
    add(rel, transform ? transform(raw) : raw, st.mtime)
  }
  const tree = async (rel: string, depth = 0): Promise<void> => {
    if (depth > 12) return
    const st = await fs.lstat(`${root}/${rel}`)
    if (!st?.isDir) return
    for (const name of (await fs.readdir(`${root}/${rel}`)).sort()) {
      if (NEVER.has(name) || SKIP_DIRS.has(name)) continue
      const child = `${rel}/${name}`
      const cs = await fs.lstat(`${root}/${child}`)
      if (!cs) continue
      if (cs.isDir) await tree(child, depth + 1)
      else if (cs.isFile) await file(child)
    }
  }
  await file('SOUL.md')
  await tree('memories')
  await file('profile.yaml')
  await file('config.yaml', (b) => Buffer.from(redactConfig(b.toString('utf8')).text, 'utf8'))
  await file('cron/jobs.json')
  await tree('skills')
  if (includeStateDb) await file('state.db')
  return { entries, skipped, bytes }
}

export const README = (profile: string, includeStateDb: boolean): string =>
  [
    `Backup of the Hermes profile "${profile}" made by Hermes Agent Mission Control.`,
    '',
    'Included: SOUL.md, memories/, profile.yaml, config.yaml (values under env: and headers:, and of keys that look like',
    `secrets, were blanked before saving), cron/jobs.json, skills/${includeStateDb ? ' and state.db (copied while Hermes may be writing it)' : ''}.`,
    'Never included: .env, auth.json, mcp-tokens/.',
    '',
    'Restore by copying the files back by hand, or with `hermes import` in a terminal. Put your API keys back with',
    '`hermes config set <ENV_VAR>` or `hermes setup`.',
    ''
  ].join('\n')
