import { create } from 'zustand'
import type { BackupResult, ToolChange } from '@shared/agentOps'

export type OpsEntry = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; text: string }
export interface ApplyResult {
  command: string
  ok: boolean
  output: string
}

export interface NewProfileForm {
  open: boolean
  name: string
  description: string
  cloneFrom: string
  noSkills: boolean
  alias: boolean
  confirm: boolean
  busy: boolean
  result: { ok: boolean; text: string } | null
}

interface AgentOpsState {
  mcp: Record<string, OpsEntry>
  /** `mcp test` answers by `profile:name`. */
  mcpTest: Record<string, OpsEntry>
  mcpAsk: { profile: string; name: string } | null
  fallback: Record<string, OpsEntry>
  tools: Record<string, Record<string, OpsEntry>>
  /** Held toolset changes per profile (shown orange until Apply). */
  changes: Record<string, ToolChange[]>
  applyAsk: string | null
  applying: string | null
  applied: Record<string, ApplyResult[] | { error: string }>
  backup: { includeStateDb: boolean; busy: boolean; result: BackupResult | null }
  newProfile: NewProfileForm
  set(patch: Partial<Omit<AgentOpsState, 'set' | 'reset'>>): void
  reset(): void
}

export const NEW_PROFILE_EMPTY: NewProfileForm = { open: false, name: '', description: '', cloneFrom: '', noSkills: false, alias: false, confirm: false, busy: false, result: null }

const EMPTY = {
  mcp: {},
  mcpTest: {},
  mcpAsk: null,
  fallback: {},
  tools: {},
  changes: {},
  applyAsk: null,
  applying: null,
  applied: {},
  backup: { includeStateDb: false, busy: false, result: null },
  newProfile: NEW_PROFILE_EMPTY
}

export const useAgentOps = create<AgentOpsState>()((set) => ({
  ...EMPTY,
  set: (patch) => set(patch),
  reset: () => set({ ...EMPTY })
}))
