/** Settings → Agents: what both processes agree on (types, limits, paths, the model command plan). */

export type AgentFileKind = 'soul' | 'memory' | 'user'
export const FILE_KINDS: readonly AgentFileKind[] = ['soul', 'memory', 'user']

/** Hermes limits in characters; Soul has none that is documented. */
export const FILE_LIMITS: Record<AgentFileKind, number | null> = { soul: null, memory: 2200, user: 1375 }
/** What the app itself refuses to load or write. */
export const MAX_FILE_BYTES = 256 * 1024

export const FILE_REL: Record<AgentFileKind, string> = { soul: 'SOUL.md', memory: 'memories/MEMORY.md', user: 'memories/USER.md' }
export const FILE_LABEL: Record<AgentFileKind, string> = { soul: 'SOUL.md', memory: 'MEMORY.md', user: 'USER.md' }

export const PROFILE_RE = /^[A-Za-z0-9._-]{1,64}$/

/** The folder of a profile: the Hermes home itself for `default`, `<home>/profiles/<name>` otherwise. */
export const profileDir = (home: string, profile: string): string => {
  const h = home.replace(/\/+$/, '')
  return profile === 'default' ? h : `${h}/profiles/${profile}`
}

export const filePath = (home: string, profile: string, kind: AgentFileKind): string => `${profileDir(home, profile)}/${FILE_REL[kind]}`

export interface AgentFile {
  exists: boolean
  text: string
  /** SHA-256 of the bytes; null when the file does not exist. */
  hash: string | null
  /** Seconds since the epoch. */
  mtime: number | null
}

export type FileError = 'not-connected' | 'bad-profile' | 'too-large' | 'too-long' | 'failed'

export type FileReadResult = { ok: true; file: AgentFile } | { ok: false; error: FileError; detail?: string }

export type FileWriteResult =
  | { ok: true; file: AgentFile }
  /** The file changed on the server since the editor loaded it; nothing was written. */
  | { ok: false; error: 'conflict'; theirs: AgentFile }
  | { ok: false; error: FileError; detail?: string }

/** Characters as Hermes counts them (code points, not UTF-16 units). */
export const charCount = (s: string): number => {
  let n = 0
  for (const _ of s) n++
  return n
}

export const ENTRY_SEP = '§'

/** Memory and USER entries are separated by a line with only §. */
export function splitEntries(text: string): string[] {
  if (text.trim() === '') return []
  return text
    .split(/\r?\n[ \t]*§[ \t]*\r?\n/)
    .map((e) => e.replace(/^\s*§\s*\n?/, '').trim())
    .filter((e) => e !== '')
}

export const joinEntries = (entries: readonly string[]): string => entries.map((e) => e.trim()).filter((e) => e !== '').join(`\n${ENTRY_SEP}\n`)

/** A file is over its limit when it has one and the text is longer. */
export const overLimit = (kind: AgentFileKind, text: string): boolean => {
  const limit = FILE_LIMITS[kind]
  return limit !== null && charCount(text) > limit
}

// ---------------------------------------------------------------- model

export type CredState = 'key' | 'oauth' | 'none' | 'unknown'

export interface ProviderPreset {
  slug: string
  label: string
  baseUrl: string
  /** How the credential is given. */
  auth: 'key' | 'oauth' | 'none'
  /** Environment variable Hermes reads the key from (key providers). */
  envVar?: string
}

export const PRESETS: readonly ProviderPreset[] = [
  { slug: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', auth: 'key', envVar: 'OPENROUTER_API_KEY' },
  { slug: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', auth: 'key', envVar: 'ANTHROPIC_API_KEY' },
  { slug: 'nous', label: 'Nous Portal', baseUrl: 'https://inference-api.nousresearch.com/v1', auth: 'oauth' },
  { slug: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', auth: 'none' }
]

export const CUSTOM_SLUG = 'custom'
export const EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'ultra'] as const

export const CUSTOM_NAME_RE = /^[a-z][a-z0-9-]{1,23}$/
export const MODEL_ID_RE = /^[^\s\u0000-\u001f]{1,200}$/
export const EFFORT_RE = /^[a-z0-9-]{1,16}$/

/** `my-proxy` → `MY_PROXY_API_KEY`. */
export const customEnvVar = (name: string): string => `${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`

export const isHttpUrl = (s: string): boolean => {
  try {
    const u = new URL(s)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '' && !/\s/.test(s)
  } catch {
    return false
  }
}

export interface ModelState {
  provider: string | null
  model: string | null
  baseUrl: string | null
  effort: string | null
  /** Per provider slug as far as `hermes status` shows it. */
  creds: Record<string, CredState>
}

export type ModelReadResult = { ok: true; state: ModelState } | { ok: false; error: 'not-connected' | 'bad-profile' | 'failed'; detail?: string }

/** What the user chose in the Model tab. The key is only here while Save runs. */
export interface ModelSaveRequest {
  profile: string
  /** A preset slug, or `custom`. */
  provider: string
  /** Only for `custom`. */
  customName?: string
  baseUrl: string
  /** Empty or absent: keep the key Hermes has. */
  apiKey?: string
  model: string
  effort?: string | null
  /** Write model.base_url even for a preset (a proxy or a local endpoint). */
  writeBaseUrl: boolean
}

export interface PlanStep {
  /** The arguments after `hermes [-p P] config set`. */
  args: string[]
  /** Index in `args` of the value that must not be shown or logged. */
  secretAt?: number
}

export type PlanResult = { ok: true; steps: PlanStep[]; slug: string; envVar: string | null } | { ok: false; error: string }

/** The `hermes config set` calls for a request, in order. Pure, so the renderer previews exactly what main runs. */
export function buildModelPlan(r: ModelSaveRequest): PlanResult {
  const preset = PRESETS.find((p) => p.slug === r.provider)
  const custom = r.provider === CUSTOM_SLUG
  if (!preset && !custom) return { ok: false, error: 'Unknown provider.' }
  if (!MODEL_ID_RE.test(r.model)) return { ok: false, error: 'Choose or type a model ID.' }
  if (r.effort != null && !EFFORT_RE.test(r.effort)) return { ok: false, error: 'Invalid reasoning effort.' }
  const baseUrl = r.baseUrl.trim()
  const steps: PlanStep[] = []
  let slug = r.provider
  let envVar: string | null = preset?.auth === 'key' ? (preset.envVar ?? null) : null

  if (custom) {
    const name = r.customName ?? ''
    if (!CUSTOM_NAME_RE.test(name)) return { ok: false, error: 'The provider name needs 2-24 lowercase letters, digits or dashes, starting with a letter.' }
    if (!isHttpUrl(baseUrl)) return { ok: false, error: 'Enter a Base URL that starts with http:// or https://.' }
    slug = name
    envVar = customEnvVar(name)
    steps.push({ args: [`providers.${name}.api`, baseUrl] }, { args: [`providers.${name}.key_env`, envVar] })
  } else if (r.writeBaseUrl && !isHttpUrl(baseUrl)) {
    return { ok: false, error: 'Enter a Base URL that starts with http:// or https://.' }
  }

  const key = (r.apiKey ?? '').trim()
  if (key !== '') {
    if (!envVar) return { ok: false, error: 'This provider does not use an API key.' }
    if (/[\r\n\u0000]/.test(key)) return { ok: false, error: 'The API key must be one line.' }
    steps.push({ args: [envVar, key], secretAt: 1 })
  }
  steps.push({ args: ['model.provider', slug] }, { args: ['model.default', r.model] })
  if (custom || r.writeBaseUrl) steps.push({ args: ['model.base_url', baseUrl] })
  if (r.effort != null && r.effort !== '') steps.push({ args: ['agent.reasoning_effort', r.effort] })
  return { ok: true, steps, slug, envVar }
}

export const MASK = '••••'

/** A step as text for the preview, with the secret masked. */
export const stepPreview = (s: PlanStep, profile: string): string =>
  ['hermes', ...(profile === 'default' ? [] : ['-p', profile]), 'config', 'set', ...s.args.map((a, i) => (i === s.secretAt ? MASK : /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`))].join(' ')

/** Removes every occurrence of the secret from text that came back from Hermes. */
export const redact = (text: string, secret: string | undefined): string => (secret && secret.length >= 4 ? text.split(secret).join(MASK) : text)

export interface RemoteModel {
  id: string
  ctx: number | null
}

export type FetchModelsResult =
  | { ok: true; models: RemoteModel[] }
  | { ok: false; error: 'not-connected' | 'bad-request' | 'http' | 'network' | 'invalid' | 'timeout'; status?: number; detail?: string }

export type SaveModelResult =
  | { ok: true; state: ModelState; warnings: string[] }
  | { ok: false; error: 'not-connected' | 'bad-request' | 'failed'; detail: string; step?: number }

export type TestModelResult = { ok: true; ms: number; answer: string } | { ok: false; detail: string; ms: number }

export type RestartResult = { ok: true; output: string } | { ok: false; detail: string }
