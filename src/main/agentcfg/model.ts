import {
  PROFILE_RE,
  buildModelPlan,
  isHttpUrl,
  redact,
  stepPreview,
  type FetchModelsResult,
  type ModelReadResult,
  type ModelSaveRequest,
  type ModelState,
  type RestartResult,
  type SaveModelResult,
  type TestModelResult
} from '@shared/agentCfg'
import type { Execer, ExecResult } from '../connection/manager'
import { chatPlainCmd } from '../connection/remote'
import { FETCH_MODELS_PY } from './fetchScript'
import { parseEffort, parseFetchOutput, parseModelConfig, parseStatus, supportsStdinFlag } from './parse'

export interface ModelDeps {
  conn: Execer
  /** Paths found by the preflight; null until the connection is ready. */
  hermes: () => { path: string; python: string } | null
  isConnected: () => boolean
  log?: (m: string) => void
}

const profileArgs = (profile: string): string[] => (profile === 'default' ? [] : ['-p', profile])
const text = (r: ExecResult): string => (r.stderr.trim() || r.stdout.trim() || `exit code ${r.code}`).slice(0, 600)

async function run(conn: Execer, argv: string[], opts: { stdin?: string; timeoutMs?: number } = {}): Promise<ExecResult> {
  try {
    return await conn.exec(argv, { timeoutMs: opts.timeoutMs ?? 20_000, ...(opts.stdin !== undefined ? { stdin: opts.stdin } : {}) })
  } catch (e) {
    return { code: -1, stdout: '', stderr: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Everything the Model tab does on the server. Only `hermes config get/set`, `hermes status`, a model test chat and
 * a gateway restart are ever run, and every command is built here from validated data: the renderer sends choices,
 * not commands. The API key is never read; it goes to Hermes once and is masked in everything that comes back.
 */
export class ModelService {
  private keyModeCache: 'stdin' | 'argument' | null = null

  constructor(private readonly d: ModelDeps) {}

  reset(): void {
    this.keyModeCache = null
  }

  private ready(profile: string): { hermes: string; python: string } | 'not-connected' | 'bad-profile' {
    if (!PROFILE_RE.test(profile)) return 'bad-profile'
    const h = this.d.hermes()
    return h && this.d.isConnected() ? { hermes: h.path, python: h.python } : 'not-connected'
  }

  async read(profile: string): Promise<ModelReadResult> {
    const h = this.ready(profile)
    if (h === 'not-connected' || h === 'bad-profile') return { ok: false, error: h }
    const pa = profileArgs(profile)
    const [model, effort, status] = await Promise.all([
      run(this.d.conn, [h.hermes, ...pa, 'config', 'get', 'model', '--json']),
      run(this.d.conn, [h.hermes, ...pa, 'config', 'get', 'agent.reasoning_effort', '--json']),
      run(this.d.conn, [h.hermes, ...pa, 'status'])
    ])
    if (model.code !== 0) return { ok: false, error: 'failed', detail: text(model) }
    const m = parseModelConfig(model.stdout)
    const state: ModelState = {
      provider: m?.provider ?? null,
      model: m?.model ?? null,
      baseUrl: m?.baseUrl ?? null,
      effort: effort.code === 0 ? parseEffort(effort.stdout) : null,
      creds: status.code === 0 ? parseStatus(status.stdout) : {}
    }
    return { ok: true, state }
  }

  /** GET {base}/models from the server. The key (when given) goes over stdin. */
  async fetchModels(req: { baseUrl: string; apiKey?: string }): Promise<FetchModelsResult> {
    const h = this.d.hermes()
    if (!h || !this.d.isConnected()) return { ok: false, error: 'not-connected' }
    const baseUrl = req.baseUrl.trim()
    if (!isHttpUrl(baseUrl)) return { ok: false, error: 'bad-request', detail: 'Enter a Base URL that starts with http:// or https://.' }
    const key = (req.apiKey ?? '').trim()
    if (/[\r\n\u0000]/.test(key)) return { ok: false, error: 'bad-request', detail: 'The API key must be one line.' }
    const r = await run(this.d.conn, [h.python, '-c', FETCH_MODELS_PY, baseUrl], { stdin: `${key}\n`, timeoutMs: 30_000 })
    if (r.code !== 0 && r.stdout.trim() === '') return { ok: false, error: 'network', detail: redact(text(r), key) }
    const p = parseFetchOutput(r.stdout)
    if (p.ok) return p
    const known = ['bad-request', 'http', 'network', 'invalid', 'timeout'] as const
    const error = known.find((k) => k === p.error) ?? 'network'
    return { ok: false, error, ...(p.status !== undefined ? { status: p.status } : {}), ...(p.detail ? { detail: redact(p.detail, key) } : {}) }
  }

  /** Whether `config set` can take the value on stdin; probed once from its help text. */
  private async keyMode(hermes: string): Promise<'stdin' | 'argument'> {
    if (this.keyModeCache) return this.keyModeCache
    const r = await run(this.d.conn, [hermes, 'config', 'set', '--help'], { timeoutMs: 15_000 })
    this.keyModeCache = r.code === 0 && supportsStdinFlag(r.stdout + r.stderr) ? 'stdin' : 'argument'
    return this.keyModeCache
  }

  /** Whether a key would travel as a command argument (visible in the process list for a moment). */
  async keyTravelsAsArgument(): Promise<boolean> {
    const h = this.d.hermes()
    return h ? (await this.keyMode(h.path)) === 'argument' : true
  }

  async save(req: ModelSaveRequest): Promise<SaveModelResult> {
    const h = this.ready(req.profile)
    if (h === 'not-connected') return { ok: false, error: 'not-connected', detail: 'Not connected to the server.' }
    if (h === 'bad-profile') return { ok: false, error: 'bad-request', detail: 'Unknown agent.' }
    const plan = buildModelPlan(req)
    if (!plan.ok) return { ok: false, error: 'bad-request', detail: plan.error }
    const secret = (req.apiKey ?? '').trim() || undefined
    const pa = profileArgs(req.profile)
    const mode = plan.steps.some((s) => s.secretAt !== undefined) ? await this.keyMode(h.hermes) : 'argument'

    for (const [i, step] of plan.steps.entries()) {
      const isSecret = step.secretAt !== undefined
      const argv =
        isSecret && mode === 'stdin'
          ? [h.hermes, ...pa, 'config', 'set', '--stdin', step.args[0]!]
          : [h.hermes, ...pa, 'config', 'set', ...step.args]
      this.d.log?.(`model: ${stepPreview(step, req.profile)}`)
      const r = await run(this.d.conn, argv, isSecret && mode === 'stdin' ? { stdin: `${step.args[1]}\n` } : {})
      if (r.code !== 0) {
        return { ok: false, error: 'failed', step: i, detail: redact(text(r), secret) }
      }
    }

    const after = await this.read(req.profile)
    const warnings: string[] = []
    if (!after.ok) return { ok: true, state: { provider: null, model: null, baseUrl: null, effort: null, creds: {} }, warnings: ['Saved, but the new settings could not be read back to verify them.'] }
    if (after.state.model !== req.model) warnings.push(`Hermes reports the model as ${after.state.model ?? 'unset'}, not ${req.model}.`)
    if (after.state.provider !== null && after.state.provider !== plan.slug) warnings.push(`Hermes reports the provider as ${after.state.provider}, not ${plan.slug}.`)
    return { ok: true, state: after.state, warnings }
  }

  /** Asks the agent to say OK with its saved model. Success is exit code 0 and an answer. */
  async test(profile: string): Promise<TestModelResult> {
    const h = this.ready(profile)
    if (h === 'not-connected' || h === 'bad-profile') return { ok: false, detail: h === 'bad-profile' ? 'Unknown agent.' : 'Not connected to the server.', ms: 0 }
    const t0 = Date.now()
    const r = await run(this.d.conn, chatPlainCmd(h.hermes, profile, 'Reply with OK', true, false), { timeoutMs: 90_000 })
    const ms = Date.now() - t0
    const answer = r.stdout.trim()
    if (r.code === 0 && answer !== '') return { ok: true, ms, answer: answer.slice(0, 200) }
    return { ok: false, ms, detail: r.code === 0 ? 'The model gave no answer.' : text(r) }
  }

  async restartGateway(profile: string): Promise<RestartResult> {
    const h = this.ready(profile)
    if (h === 'not-connected' || h === 'bad-profile') return { ok: false, detail: h === 'bad-profile' ? 'Unknown agent.' : 'Not connected to the server.' }
    this.d.log?.(`gateway restart: ${profile}`)
    const r = await run(this.d.conn, [h.hermes, ...profileArgs(profile), 'gateway', 'restart'], { timeoutMs: 60_000 })
    return r.code === 0 ? { ok: true, output: r.stdout.trim().slice(0, 400) } : { ok: false, detail: text(r) }
  }
}
