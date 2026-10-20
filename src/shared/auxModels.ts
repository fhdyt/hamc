import { MODEL_ID_RE, isHttpUrl } from './agentCfg'

/**
 * v2 auxiliary models: the side-jobs Hermes may run on another model than the agent's main one. Keys and order from
 * `hermes_cli/config_defaults.py` at tag v2026.8.31 (the docs still list `web_extract`, which the source removed).
 */
export const AUX_TASKS = [
  { key: 'vision', label: 'Vision', hint: 'Reads images when the main model cannot.' },
  { key: 'compression', label: 'Compression', hint: 'Summarises long context; a fast cheap model does it well.' },
  { key: 'skills_hub', label: 'Skills Hub', hint: 'hermes skills search.' },
  { key: 'approval', label: 'Approval', hint: 'Smart approvals decide on low-risk commands.' },
  { key: 'review', label: 'Review', hint: 'Reviews work before it is handed back.' },
  { key: 'mcp', label: 'MCP', hint: 'Routes MCP tool calls.' },
  { key: 'title_generation', label: 'Title generation', hint: 'Names sessions.' },
  { key: 'memory_query_rewrite', label: 'Memory query rewrite', hint: 'Rewrites questions before memory search.' },
  { key: 'tts_audio_tags', label: 'TTS audio tags', hint: 'Adds speech tags for text to speech.' },
  { key: 'triage_specifier', label: 'Triage specifier', hint: 'hermes kanban specify.' },
  { key: 'kanban_decomposer', label: 'Kanban decomposer', hint: 'Splits a triage task into child tasks.' },
  { key: 'profile_describer', label: 'Profile describer', hint: 'hermes profile describe --auto.' },
  { key: 'goal_judge', label: 'Goal judge', hint: 'Decides when a goal-mode task is done.' },
  { key: 'curator', label: 'Curator', hint: 'Reviews skill usage; can run for minutes.' },
  { key: 'monitor', label: 'Monitor', hint: 'Watches long runs.' },
  { key: 'background_review', label: 'Background review', hint: 'Reviews finished sessions in the background.' },
  { key: 'moa_reference', label: 'MoA reference', hint: 'Mixture-of-agents advisors.' },
  { key: 'moa_aggregator', label: 'MoA aggregator', hint: 'Mixture-of-agents final answer.' }
] as const
export type AuxTask = (typeof AUX_TASKS)[number]['key']
export const AUX_KEYS: readonly string[] = AUX_TASKS.map((t) => t.key)

/** One slot as the read script reports it; `hasKey` only says whether the slot has its own api_key. */
export interface AuxSlot {
  provider: string
  model: string
  baseUrl: string
  hasKey: boolean
}
export type AuxSlots = Record<AuxTask, AuxSlot>
export const AUTO_SLOT: AuxSlot = { provider: 'auto', model: '', baseUrl: '', hasKey: false }
export const isAuto = (s: AuxSlot): boolean => (s.provider === '' || s.provider === 'auto') && s.model === '' && s.baseUrl === ''

export type AuxChoice = { kind: 'auto' } | { kind: 'model'; provider: string; model: string; baseUrl?: string }
export const AUX_PROVIDER_RE = /^[a-z][a-z0-9_-]{0,40}$/

export type AuxReadResult = { ok: true; slots: AuxSlots } | { ok: false; error: 'not-connected' | 'bad-profile' | 'no-yaml' | 'failed'; detail?: string }
export type AuxSaveRequest = { profile: string; changes: { task: AuxTask; choice: AuxChoice }[] }
export type AuxSaveResult = { ok: true; slots: AuxSlots | null } | { ok: false; error: 'not-connected' | 'bad-request' | 'failed'; step?: number; detail: string }

/** The `config set` argument lists (after `hermes [-p P] config set`) for one slot, or an error. */
export function buildAuxPlan(task: string, choice: AuxChoice): { ok: true; steps: string[][] } | { ok: false; error: string } {
  if (!AUX_KEYS.includes(task)) return { ok: false, error: 'Unknown auxiliary task.' }
  const k = `auxiliary.${task}`
  if (choice.kind === 'auto') return { ok: true, steps: [[`${k}.provider`, 'auto'], [`${k}.model`, ''], [`${k}.base_url`, '']] }
  if (!AUX_PROVIDER_RE.test(choice.provider) || choice.provider === 'auto') return { ok: false, error: 'Choose a provider.' }
  if (!MODEL_ID_RE.test(choice.model)) return { ok: false, error: 'Choose or type a model ID.' }
  const base = (choice.baseUrl ?? '').trim()
  if (base && !isHttpUrl(base)) return { ok: false, error: 'Enter a Base URL that starts with http:// or https://.' }
  return { ok: true, steps: [[`${k}.provider`, choice.provider], [`${k}.model`, choice.model], [`${k}.base_url`, base]] }
}

/** All steps of a save, in order; null when one change is not acceptable. */
export function buildAuxSave(req: AuxSaveRequest): { ok: true; steps: string[][] } | { ok: false; error: string } {
  if (req.changes.length === 0 || req.changes.length > AUX_TASKS.length) return { ok: false, error: 'Nothing to save.' }
  const steps: string[][] = []
  for (const c of req.changes) {
    const p = buildAuxPlan(c.task, c.choice)
    if (!p.ok) return p
    steps.push(...p.steps)
  }
  return { ok: true, steps }
}

/** Every slot that is not on auto goes back to auto. */
export function resetAllChanges(slots: AuxSlots): AuxSaveRequest['changes'] {
  return AUX_TASKS.filter((t) => !isAuto(slots[t.key])).map((t) => ({ task: t.key, choice: { kind: 'auto' as const } }))
}

/** `hermes [-p P] config set <a> <b>` as the confirm shows it. */
export function auxCommandLines(profile: string, steps: string[][]): string {
  const p = profile === 'default' ? '' : `-p ${profile} `
  const q = (s: string): string => (s === '' ? "''" : /^[A-Za-z0-9._:/@%+=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)
  return steps.map((s) => `$ hermes ${p}config set ${s.map(q).join(' ')}`).join('\n')
}
