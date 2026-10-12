import type { AgentFileKind, FileError } from '@shared/agentCfg'
import { draftKey, isDirty, withConflict, withFile, withSaved, withServerChange, type Draft } from './lib/agentCfg'
import { useAgentCfg } from './stores/agentCfg'

export const FILE_ERROR_TEXT: Record<FileError, string> = {
  'not-connected': 'Not connected to the server.',
  'bad-profile': 'This agent name cannot be used.',
  'too-large': 'The file is larger than 256 KB, so it is not opened here.',
  'too-long': 'The text is over the character limit.',
  failed: 'The server could not read or write the file.'
}

const draft = (profile: string, kind: AgentFileKind): Draft | undefined => useAgentCfg.getState().drafts[draftKey(profile, kind)]
const patch = (profile: string, kind: AgentFileKind, fn: (d: Draft) => Draft): void => useAgentCfg.getState().patchDraft(profile, kind, fn)

const failText = (error: FileError, detail?: string): string => (detail ? `${FILE_ERROR_TEXT[error]} (${detail})` : FILE_ERROR_TEXT[error])

/** Opens a file in its editor: reads it unless the editor already has it. */
export async function loadFile(profile: string, kind: AgentFileKind, force = false): Promise<void> {
  if (!force && draft(profile, kind)?.loaded) return
  const res = await window.mc.agentCfg.readFile(profile, kind)
  if (res.ok) patch(profile, kind, (d) => (isDirty(d) && !force ? d : withFile(d, res.file)))
  else patch(profile, kind, (d) => ({ ...d, error: failText(res.error, res.detail) }))
}

/** The 5 s check (F-CFG-16): a clean editor follows the server, a dirty one only learns that the file changed. */
export async function refreshFile(profile: string, kind: AgentFileKind): Promise<void> {
  const d = draft(profile, kind)
  if (!d?.loaded || d.saving) return
  const res = await window.mc.agentCfg.readFile(profile, kind)
  if (!res.ok) return
  const now = draft(profile, kind)
  if (!now || now.saving || res.file.hash === now.baseHash) return
  if (now.serverChanged?.hash === res.file.hash) return
  patch(profile, kind, (x) => withServerChange(x, res.file))
}

/** Writes the editor text. The server refuses (conflict) when the file changed since the editor loaded it. */
export async function saveFile(profile: string, kind: AgentFileKind): Promise<boolean> {
  const d = draft(profile, kind)
  if (!d || d.saving) return false
  patch(profile, kind, (x) => ({ ...x, saving: true, error: null }))
  const res = await window.mc.agentCfg.writeFile({ profile, kind, text: d.text, baseHash: d.baseHash })
  if (res.ok) {
    patch(profile, kind, (x) => withSaved(x, res.file, d.baseText))
    return true
  }
  if (res.error === 'conflict') patch(profile, kind, (x) => withConflict(x, res.theirs))
  else patch(profile, kind, (x) => ({ ...x, saving: false, error: failText(res.error, 'detail' in res ? res.detail : undefined) }))
  return false
}
