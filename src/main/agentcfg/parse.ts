import type { CredState, RemoteModel } from '@shared/agentCfg'

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

export interface ParsedModel {
  provider: string | null
  model: string | null
  baseUrl: string | null
}

/**
 * `hermes config get model --json`. The shape is not documented, so this takes the ones that are plausible: the
 * model block itself (`{provider, default, base_url}`), the whole config with a `model` block, a bare model name
 * as JSON string, or plain text.
 */
export function parseModelConfig(stdout: string): ParsedModel | null {
  const text = stdout.trim()
  if (text === '') return null
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    const first = text.split('\n')[0]!.trim()
    return /^[^\s{}[\]]{1,200}$/.test(first) ? { provider: null, model: first, baseUrl: null } : null
  }
  if (typeof v === 'string') return str(v) ? { provider: null, model: str(v), baseUrl: null } : null
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const root = v as Record<string, unknown>
  const block = root.model && typeof root.model === 'object' && !Array.isArray(root.model) ? (root.model as Record<string, unknown>) : root
  const model = str(block.default) ?? str(block.model) ?? str(block.name) ?? str(block.id) ?? (typeof root.model === 'string' ? str(root.model) : null)
  const provider = str(block.provider) ?? str(root.provider)
  const baseUrl = str(block.base_url) ?? str(block.baseUrl) ?? str(block.api)
  return provider || model || baseUrl ? { provider, model, baseUrl } : null
}

/** `config get agent.reasoning_effort --json`: `"high"`, `high`, or `{"value": "high"}`. */
export function parseEffort(stdout: string): string | null {
  const text = stdout.trim()
  if (text === '' || text === 'null') return null
  try {
    const v: unknown = JSON.parse(text)
    if (typeof v === 'string') return str(v)
    if (v && typeof v === 'object') return str((v as Record<string, unknown>).value) ?? str((v as Record<string, unknown>).reasoning_effort)
    return null
  } catch {
    return /^[A-Za-z0-9-]{1,16}$/.test(text) ? text : null
  }
}

const ANSI = /\u001b\[[0-9;]*m/g
const NEGATIVE = /(not\s+(configured|set|logged|authenticated|found)|missing|no\s+(api\s+)?key|unset|\bnone\b|disabled|✗|✘|❌)/i
const POSITIVE = /(✓|✔|✅|configured|logged\s+in|authenticated|\bset\b|\bok\b|enabled|\bactive\b|\byes\b|\bpresent\b)/i

/**
 * `hermes status` is free text. A provider line says it has a credential only when it carries a positive marker
 * and no negative one; anything else is left out, so the UI says "unknown" instead of a wrong tick.
 */
export function parseStatus(stdout: string): Record<string, CredState> {
  const out: Record<string, CredState> = {}
  for (const raw of stdout.replace(ANSI, '').split('\n')) {
    const m = /^[^A-Za-z0-9]*([A-Za-z][A-Za-z0-9_.-]{1,40})\s*[:\-–—=|]?\s*(.*)$/.exec(raw.trim())
    if (!m) continue
    const name = m[1]!.toLowerCase()
    const rest = m[2]!
    if (NEGATIVE.test(rest)) out[name] = 'none'
    else if (POSITIVE.test(rest)) out[name] = /oauth|logged\s+in|login/i.test(rest) ? 'oauth' : 'key'
  }
  return out
}

/** `hermes config set --help`: does it take the value on stdin? */
export const supportsStdinFlag = (help: string): boolean => /--stdin\b/.test(help)

/** The one JSON line the fetch script prints. */
export function parseFetchOutput(stdout: string): { ok: true; models: RemoteModel[] } | { ok: false; status?: number; error: string; detail?: string } {
  let v: unknown
  try {
    v = JSON.parse(stdout.trim().split('\n').filter(Boolean).at(-1) ?? '')
  } catch {
    return { ok: false, error: 'invalid' }
  }
  if (!v || typeof v !== 'object') return { ok: false, error: 'invalid' }
  const o = v as Record<string, unknown>
  if (o.ok !== true) {
    return { ok: false, error: typeof o.error === 'string' ? o.error : 'network', ...(typeof o.status === 'number' ? { status: o.status } : {}), ...(typeof o.detail === 'string' ? { detail: o.detail.slice(0, 300) } : {}) }
  }
  const list = Array.isArray(o.models) ? o.models : []
  const models: RemoteModel[] = []
  for (const m of list) {
    if (!m || typeof m !== 'object') continue
    const id = str((m as Record<string, unknown>).id)
    if (!id) continue
    const ctx = (m as Record<string, unknown>).ctx
    models.push({ id, ctx: typeof ctx === 'number' && Number.isFinite(ctx) && ctx > 0 ? Math.round(ctx) : null })
  }
  models.sort((a, b) => a.id.localeCompare(b.id))
  return { ok: true, models }
}
