import type { AgentModels } from '@shared/ipc'
import type { Execer } from '../connection/manager'
import { modelCmd, runSafe } from '../connection/remote'

type Model = { provider: string | null; model: string | null }

export function parseModelJson(stdout: string): Model | null {
  let v: unknown
  try {
    v = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const root = v as Record<string, unknown>
  if (typeof root.model === 'string') {
    return { provider: typeof root.provider === 'string' ? root.provider : null, model: root.model }
  }
  const m = (root.model && typeof root.model === 'object' ? root.model : root) as Record<string, unknown>
  const provider = typeof m.provider === 'string' ? m.provider : null
  const model = typeof m.default === 'string' ? m.default : typeof m.name === 'string' ? m.name : null
  return provider || model ? { provider, model } : null
}

const RETRY_AFTER_MS = 60_000
const CONCURRENCY = 3

interface Entry {
  mtime: number | null
  value: Model | null
  at: number
}

export class ModelResolver {
  private cache = new Map<string, Entry>()
  private busy = false

  constructor(
    private readonly conn: Execer,
    private readonly hermesPath: string | null,
    private readonly onChange: (m: AgentModels) => void,
    private readonly now: () => number = Date.now
  ) {}

  snapshot(): AgentModels {
    const out: AgentModels = {}
    for (const [k, v] of this.cache) out[k] = v.value
    return out
  }

  async update(agents: { profile: string; configMtime: number | null }[]): Promise<void> {
    const hermes = this.hermesPath
    if (!hermes || this.busy) return
    this.busy = true
    try {
      let changed = false
      const names = new Set(agents.map((a) => a.profile))
      for (const k of [...this.cache.keys()]) {
        if (!names.has(k)) {
          this.cache.delete(k)
          changed = true
        }
      }
      const stale = agents.filter((a) => {
        const hit = this.cache.get(a.profile)
        if (!hit) return true
        if (hit.mtime !== a.configMtime) return true
        return hit.value === null && this.now() - hit.at >= RETRY_AFTER_MS
      })
      let next = 0
      const worker = async (): Promise<void> => {
        for (;;) {
          const a = stale[next++]
          if (!a) return
          const r = await runSafe(this.conn, modelCmd(hermes, a.profile))
          this.cache.set(a.profile, { mtime: a.configMtime, value: r.code === 0 ? parseModelJson(r.stdout) : null, at: this.now() })
          changed = true
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, stale.length) }, worker))
      if (changed) this.onChange(this.snapshot())
    } finally {
      this.busy = false
    }
  }
}
