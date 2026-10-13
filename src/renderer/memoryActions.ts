import type { AgentFileKind } from '@shared/agentCfg'
import { loadFile } from './agentCfgActions'
import { withEdit } from './lib/agentCfg'
import { versionWhen } from './lib/memoryTimeline'
import { useAgentCfg } from './stores/agentCfg'
import { useMemoryTimeline } from './stores/memoryTimeline'
import { useUi } from './stores/ui'

let seq = 0
const keyOf = (profile: string, file: AgentFileKind): string => `${profile}:${file}`

/** Versions of the chosen file, then the texts the picked version's diff needs. */
export async function loadVersions(profile: string, quiet = false): Promise<void> {
  const { file } = useMemoryTimeline.getState()
  const key = keyOf(profile, file)
  const my = ++seq
  const st = useMemoryTimeline.getState()
  if (!quiet || st.versions?.key !== key) st.setVersions({ key, status: 'loading' })
  const list = await window.mc.memory.versions(profile, file)
  if (my !== seq) return
  useMemoryTimeline.getState().setVersions({ key, status: 'ok', list })
  await loadTexts()
}

/** Reads the picked version and the one before it (for the diff), each once. */
export async function loadTexts(): Promise<void> {
  const st = useMemoryTimeline.getState()
  if (st.versions?.status !== 'ok') return
  const ids = [st.versions.list[st.picked]?.id, st.versions.list[st.picked + 1]?.id].filter((x): x is number => x !== undefined && !st.texts[x])
  await Promise.all(
    ids.map(async (id) => {
      useMemoryTimeline.getState().setText(id, { status: 'loading' })
      const r = await window.mc.memory.version(id)
      useMemoryTimeline.getState().setText(id, r.ok ? { status: 'ok', text: r.text } : { status: 'error', message: r.error === 'not-found' ? 'This version is no longer stored.' : 'Not connected.' })
    })
  )
}

export function pickVersion(i: number): Promise<void> {
  useMemoryTimeline.getState().pick(i)
  return loadTexts()
}

/** A collector event added a version: read the list again when it is the file on screen. */
export function memoryChanged(profile: string, file: AgentFileKind, current: string | null): void {
  const st = useMemoryTimeline.getState()
  if (st.tab === 'timeline' && current === profile && st.file === file) void loadVersions(profile, true)
}

/**
 * F-MEMT-5: opens Settings → Agents on this file with the version as an unsaved edit. Saving goes through the normal
 * diff and hash check; nothing is written here.
 */
export async function restoreVersion(profile: string): Promise<void> {
  const st = useMemoryTimeline.getState()
  const v = st.versions?.status === 'ok' ? st.versions.list[st.picked] : undefined
  const t = v ? st.texts[v.id] : undefined
  if (!v || t?.status !== 'ok') return
  const cfg = useAgentCfg.getState()
  cfg.selectProfile(profile)
  cfg.setTab(st.file)
  useUi.getState().openSettings('agents')
  await loadFile(profile, st.file)
  useAgentCfg.getState().patchDraft(profile, st.file, (d) => ({
    ...withEdit(d, t.text),
    notice: `Loaded the version of ${versionWhen(v.takenAt)} from the memory timeline. Review the changes, then Save.`
  }))
}

export async function copyVersion(): Promise<void> {
  const st = useMemoryTimeline.getState()
  const v = st.versions?.status === 'ok' ? st.versions.list[st.picked] : undefined
  const t = v ? st.texts[v.id] : undefined
  if (!v || t?.status !== 'ok') return
  try {
    await navigator.clipboard.writeText(t.text)
    useMemoryTimeline.getState().setNote('Version copied.')
  } catch {
    useMemoryTimeline.getState().setNote('Could not copy.')
  }
}
