import { overLimit, type AgentFile, type AgentFileKind } from '@shared/agentCfg'
import { hasConflictMarkers, merge3 } from '@shared/textDiff'

/** One editor's state. Everything lives in memory only (F-CFG-18): nothing is written to disk. */
export interface Draft {
  profile: string
  kind: AgentFileKind
  loaded: boolean
  /** The file as the editor opened it; `baseHash` is what the save must find on the server. */
  baseExists: boolean
  baseText: string
  baseHash: string | null
  mtime: number | null
  /** What is in the editor. */
  text: string
  saving: boolean
  /** The file changed on the server and nothing was written. */
  conflict: AgentFile | null
  /** The file changed on the server while the draft has edits (shown as a notice, Save finds it as a conflict). */
  serverChanged: AgentFile | null
  /** Texts from before each save in this session, newest last (F-CFG-15). */
  undo: string[]
  notice: string | null
  error: string | null
}

export const draftKey = (profile: string, kind: AgentFileKind): string => `${profile}:${kind}`
const UNDO_DEPTH = 10

export const emptyDraft = (profile: string, kind: AgentFileKind): Draft => ({
  profile,
  kind,
  loaded: false,
  baseExists: false,
  baseText: '',
  baseHash: null,
  mtime: null,
  text: '',
  saving: false,
  conflict: null,
  serverChanged: null,
  undo: [],
  notice: null,
  error: null
})

export const isDirty = (d: Draft): boolean => d.loaded && d.text !== d.baseText
export const anyDirty = (drafts: Record<string, Draft>): boolean => Object.values(drafts).some(isDirty)

/** The server's file becomes the base and the editor text (a first load, a refresh, or "Take theirs"). */
export function withFile(d: Draft, f: AgentFile, notice: string | null = null): Draft {
  return { ...d, loaded: true, baseExists: f.exists, baseText: f.text, baseHash: f.hash, mtime: f.mtime, text: f.text, conflict: null, serverChanged: null, error: null, notice }
}

export const withEdit = (d: Draft, text: string): Draft => ({ ...d, text, notice: null })

export function withSaved(d: Draft, f: AgentFile, previous: string): Draft {
  const undo = previous === f.text ? d.undo : [...d.undo, previous].slice(-UNDO_DEPTH)
  return { ...d, saving: false, loaded: true, baseExists: f.exists, baseText: f.text, baseHash: f.hash, mtime: f.mtime, text: f.text, conflict: null, serverChanged: null, undo, error: null, notice: 'Saved. Changes apply to new sessions.' }
}

export const withConflict = (d: Draft, theirs: AgentFile): Draft => ({ ...d, saving: false, conflict: theirs, error: null })

/** The file changed on the server: a clean draft follows it, a dirty one only gets a notice. */
export function withServerChange(d: Draft, f: AgentFile): Draft {
  if (!isDirty(d)) return withFile(d, f, 'Updated from the server.')
  return { ...d, serverChanged: f }
}

/** Throws away my edits and takes what is on the server. */
export const takeTheirs = (d: Draft): Draft => (d.conflict ?? d.serverChanged ? withFile(d, (d.conflict ?? d.serverChanged)!, 'Took the version from the server.') : d)

/** Keeps my text, but treats the server's file as the base, so the next save (after its diff) overwrites it. */
export function keepMine(d: Draft): Draft {
  const t = d.conflict ?? d.serverChanged
  if (!t) return d
  return { ...d, baseExists: t.exists, baseText: t.text, baseHash: t.hash, mtime: t.mtime, conflict: null, serverChanged: null, notice: 'Your text replaces the server’s version when you save.' }
}

/** Three-way merge of my edits and theirs into the editor. Overlapping edits come with markers that block Save. */
export function mergeTheirs(d: Draft): Draft {
  const t = d.conflict ?? d.serverChanged
  if (!t) return d
  const m = merge3(d.baseText, d.text, t.text)
  return {
    ...d,
    baseExists: t.exists,
    baseText: t.text,
    baseHash: t.hash,
    mtime: t.mtime,
    text: m.text,
    conflict: null,
    serverChanged: null,
    notice: m.conflicts ? `${m.conflicts} place${m.conflicts === 1 ? '' : 's'} could not be merged. Fix the marked lines, then save.` : 'Merged the server’s changes into your text.'
  }
}

/** Puts the text from before the last save into the editor; saving it is a normal save with its diff. */
export function withRevert(d: Draft): Draft {
  const prev = d.undo.at(-1)
  if (prev === undefined) return d
  return { ...d, text: prev, undo: d.undo.slice(0, -1), notice: null }
}

export type SaveBlock = 'clean' | 'too-long' | 'markers' | 'saving' | 'offline' | null

export function saveBlock(d: Draft, connected: boolean): SaveBlock {
  if (!isDirty(d)) return 'clean'
  if (!connected) return 'offline'
  if (d.saving) return 'saving'
  if (overLimit(d.kind, d.text)) return 'too-long'
  if (hasConflictMarkers(d.text)) return 'markers'
  return null
}

export const SAVE_BLOCK_TEXT: Record<Exclude<SaveBlock, null>, string> = {
  clean: 'Nothing to save',
  'too-long': 'Over the character limit',
  markers: 'Fix the conflict markers first',
  saving: 'Saving…',
  offline: 'Not connected'
}
