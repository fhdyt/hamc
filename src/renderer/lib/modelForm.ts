import {
  CUSTOM_SLUG,
  PRESETS,
  buildModelPlan,
  stepPreview,
  type CredState,
  type FetchModelsResult,
  type ModelSaveRequest,
  type ModelState,
  type PlanResult,
  type ProviderPreset
} from '@shared/agentCfg'

/** What the Model tab edits. The API key is only kept while the tab is open. */
export interface ModelForm {
  provider: string
  customName: string
  baseUrl: string
  apiKey: string
  model: string
  effort: string | null
}

export const presetOf = (slug: string): ProviderPreset | undefined => PRESETS.find((p) => p.slug === slug)

/** The form that matches what Hermes has now. */
export function formFromState(s: ModelState | null): ModelForm {
  const preset = s?.provider ? presetOf(s.provider) : undefined
  const custom = !!s?.provider && !preset
  const provider = preset ? preset.slug : custom ? CUSTOM_SLUG : 'openrouter'
  return {
    provider,
    customName: custom ? s!.provider! : '',
    baseUrl: s?.baseUrl ?? preset?.baseUrl ?? PRESETS[0]!.baseUrl,
    apiKey: '',
    model: s?.model ?? '',
    effort: s?.effort ?? null
  }
}

/** Choosing another provider fills its default Base URL (F-CFG-2). */
export function withProvider(f: ModelForm, slug: string): ModelForm {
  const p = presetOf(slug)
  return { ...f, provider: slug, baseUrl: p ? p.baseUrl : slug === CUSTOM_SLUG ? '' : f.baseUrl, apiKey: '' }
}

export const formDirty = (f: ModelForm, initial: ModelForm): boolean =>
  f.provider !== initial.provider || f.customName !== initial.customName || f.baseUrl !== initial.baseUrl || f.model !== initial.model || f.effort !== initial.effort || f.apiKey !== ''

/** The request for Save: the preset's own URL is not written unless it differs (a proxy) or the provider is local. */
export function requestOf(profile: string, f: ModelForm): ModelSaveRequest {
  const preset = presetOf(f.provider)
  const writeBaseUrl = f.provider === CUSTOM_SLUG || f.provider === 'ollama' || (!!preset && f.baseUrl.trim() !== preset.baseUrl)
  return {
    profile,
    provider: f.provider,
    ...(f.provider === CUSTOM_SLUG ? { customName: f.customName.trim() } : {}),
    baseUrl: f.baseUrl.trim(),
    ...(f.apiKey.trim() ? { apiKey: f.apiKey.trim() } : {}),
    model: f.model.trim(),
    effort: f.effort,
    writeBaseUrl
  }
}

export interface Preview {
  plan: PlanResult
  /** One line per `hermes config set`, the key masked. */
  commands: string
}

export function previewOf(profile: string, f: ModelForm): Preview {
  const plan = buildModelPlan(requestOf(profile, f))
  return { plan, commands: plan.ok ? plan.steps.map((s) => stepPreview(s, profile)).join('\n') : '' }
}

/** What the credential line of a provider says. */
export function credLabel(slug: string, creds: Record<string, CredState>): { text: string; ok: boolean } {
  const p = presetOf(slug)
  if (p?.auth === 'none') return { text: 'no key needed', ok: true }
  const c = creds[slug]
  if (c === 'key') return { text: 'key saved ✓', ok: true }
  if (c === 'oauth') return { text: 'oauth ✓', ok: true }
  if (c === 'none') return { text: p?.auth === 'oauth' ? 'not signed in' : 'needs key', ok: false }
  return { text: p?.auth === 'oauth' ? 'oauth' : 'no status', ok: false }
}

/** The model and settings as lines, for the before/after diff of Save. */
export function summaryLines(provider: string | null, model: string | null, baseUrl: string | null, effort: string | null): string {
  return [`provider: ${provider ?? '(not set)'}`, `model: ${model ?? '(not set)'}`, `base url: ${baseUrl ?? '(default)'}`, `reasoning: ${effort ?? '(default)'}`].join('\n')
}

export function fetchErrorText(r: Extract<FetchModelsResult, { ok: false }>, hadKey: boolean): string {
  switch (r.error) {
    case 'not-connected':
      return 'Not connected to the server.'
    case 'bad-request':
      return r.detail ?? 'The Base URL or key cannot be used.'
    case 'http':
      return r.status === 401 || r.status === 403
        ? hadKey
          ? `The server answered ${r.status}: the key was refused. Check it, or type the model ID yourself.`
          : `The server answered ${r.status}: it needs a key. Enter the key to list models, or type the model ID yourself.`
        : `The endpoint answered HTTP ${r.status ?? '?'}${r.detail ? ` (${r.detail})` : ''}. You can type the model ID yourself.`
    case 'timeout':
      return 'The endpoint did not answer in time. You can type the model ID yourself.'
    case 'invalid':
      return 'The endpoint answered, but not with a model list. You can type the model ID yourself.'
    default:
      return `The server could not reach the endpoint${r.detail ? ` (${r.detail})` : ''}. You can type the model ID yourself.`
  }
}
