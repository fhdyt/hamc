import { writeFile } from 'node:fs/promises'
import type { SFTPWrapper } from 'ssh2'
import {
  fallbackListArgs,
  mcpListArgs,
  mcpTestArgs,
  preview,
  profileCreateArgs,
  toolsApplyArgs,
  toolsListArgs,
  type BackupRequest,
  type BackupResult,
  type NewProfileRequest,
  type OpsApply,
  type OpsText,
  type ToolChange
} from '@shared/agentOps'
import type { Execer, ExecResult } from '../connection/manager'
import { stripAnsi } from '../cron/actions'
import type { SaveDialog } from '../sessions/export'
import { collectBackup, README, type BackupFs } from './backup'
import { makeZip } from './zip'

export interface AgentOpsDeps {
  conn: Execer & { sftp(): Promise<SFTPWrapper> }
  hermes: () => { path: string } | null
  home: () => string | null
  isConnected: () => boolean
  log?: (m: string) => void
}

const TEXT_MAX = 40_000

/** SFTP calls as promises, `lstat` so a symlink is never followed into somewhere else. */
export function sftpFs(sftp: SFTPWrapper): BackupFs {
  const call = <T>(fn: (cb: (err: Error | null | undefined, v?: T) => void) => void): Promise<T | undefined> =>
    new Promise((resolve, reject) => fn((err, v) => (err ? reject(err) : resolve(v))))
  return {
    lstat: async (p) => {
      try {
        const st = (await call<{ size: number; mtime: number; isDirectory(): boolean; isFile(): boolean }>((cb) => sftp.lstat(p, cb as never)))!
        return { size: st.size, mtime: st.mtime, isDir: st.isDirectory(), isFile: st.isFile() }
      } catch {
        return null
      }
    },
    readdir: async (p) => ((await call<{ filename: string }[]>((cb) => sftp.readdir(p, cb as never))) ?? []).map((e) => e.filename),
    readFile: async (p) => (await call<Buffer>((cb) => sftp.readFile(p, cb as never))) ?? Buffer.alloc(0)
  }
}

/**
 * Settings → Agents → MCP, Toolsets, Fallback, Backup and New profile (F-CFG-19..26). Reads run `hermes … list`;
 * writes (`mcp test`, `tools enable|disable`, `profile create`) run only after the user confirmed the exact command;
 * the backup is an SFTP download into a zip the user saves locally.
 */
export class AgentOpsService {
  constructor(private readonly d: AgentOpsDeps) {}

  private async exec(argv: string[], timeoutMs: number): Promise<ExecResult> {
    try {
      return await this.d.conn.exec(argv, { timeoutMs })
    } catch (e) {
      return { code: -1, stdout: '', stderr: e instanceof Error ? e.message : String(e) }
    }
  }

  private async text(args: string[] | null, timeoutMs = 30_000, logAs?: string, profile?: string): Promise<OpsText> {
    if (!args) return { ok: false, error: 'bad-input' }
    const h = this.d.hermes()
    if (!h || !this.d.isConnected()) return { ok: false, error: 'not-connected' }
    const r = await this.exec([h.path, ...args], timeoutMs)
    if (logAs) this.d.log?.(`agentops ${logAs} ${profile ?? ''} exit ${r.code}`)
    const out = stripAnsi(r.stdout).slice(0, TEXT_MAX)
    if (r.code === 0) return { ok: true, text: out }
    return { ok: false, error: 'failed', detail: (stripAnsi(r.stderr).trim() || out.trim() || `exit code ${r.code}`).slice(0, 4000) }
  }

  mcpList(profile: string): Promise<OpsText> {
    return this.text(mcpListArgs(profile))
  }

  /** Starts the server once (an explicit action). */
  mcpTest(profile: string, name: string): Promise<OpsText> {
    return this.text(mcpTestArgs(profile, name), 90_000, 'mcp-test', profile)
  }

  fallbackList(profile: string): Promise<OpsText> {
    return this.text(fallbackListArgs(profile))
  }

  async toolsList(profile: string, platforms: string[]): Promise<Record<string, OpsText>> {
    const out: Record<string, OpsText> = {}
    await Promise.all(platforms.slice(0, 24).map(async (p) => void (out[p] = await this.text(toolsListArgs(profile, p)))))
    return out
  }

  /** The held toolset changes, one command per action and platform, run one after the other. */
  async toolsApply(profile: string, changes: ToolChange[]): Promise<OpsApply> {
    const cmds = toolsApplyArgs(profile, changes)
    if (!cmds) return { ok: false, error: 'bad-input' }
    const h = this.d.hermes()
    if (!h || !this.d.isConnected()) return { ok: false, error: 'not-connected' }
    const results: { command: string; ok: boolean; output: string }[] = []
    for (const args of cmds) {
      const r = await this.exec([h.path, ...args], 60_000)
      this.d.log?.(`agentops tools-${args.includes('enable') ? 'enable' : 'disable'} ${profile} exit ${r.code}`)
      results.push({ command: preview(args)!, ok: r.code === 0, output: (stripAnsi(r.stdout).trim() || stripAnsi(r.stderr).trim()).slice(0, 2000) })
    }
    return { ok: true, results }
  }

  async profileCreate(req: NewProfileRequest): Promise<OpsText> {
    return this.text(profileCreateArgs(req), 120_000, 'profile-create', req.name)
  }

  /** Downloads the profile's parts over SFTP and writes a zip to the path the user picks. Nothing is written remotely. */
  async backup(req: BackupRequest, pick: (defaultPath: string) => ReturnType<SaveDialog>): Promise<BackupResult> {
    const home = this.d.home()
    if (!home || !this.d.isConnected()) return { failed: 'Not connected.' }
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(req.profile) || req.profile === '.' || req.profile === '..') return { failed: 'Bad profile.' }
    const root = req.profile === 'default' ? home.replace(/\/+$/, '') : `${home.replace(/\/+$/, '')}/profiles/${req.profile}`
    const day = new Date().toISOString().slice(0, 10)
    const res = await pick(`hermes-${req.profile}-${day}.zip`)
    if (res.canceled || !res.filePath) return { canceled: true }
    try {
      const sftp = await this.d.conn.sftp()
      const { entries, skipped, bytes } = await collectBackup(sftpFs(sftp), root, req.includeStateDb)
      const zip = makeZip([{ name: 'README.txt', data: Buffer.from(README(req.profile, req.includeStateDb)) }, ...entries])
      await writeFile(res.filePath, zip)
      this.d.log?.(`agentops backup ${req.profile} files ${entries.length}`)
      return { saved: res.filePath, files: entries.length, bytes, skipped }
    } catch (e) {
      return { failed: e instanceof Error ? e.message : String(e) }
    }
  }
}
