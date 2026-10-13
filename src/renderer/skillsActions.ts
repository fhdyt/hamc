import type { SkillAction } from '@shared/skills'
import type { SkillLedgerEntry } from '@shared/events'
import { ledgerDiffFile, skillKey } from './lib/skills'
import { describeQueryError } from './lib/queryError'
import { useSkills } from './stores/skills'

let seq = 0
const ACTION_ERRORS = { 'bad-input': 'Mission Control refused the request.', 'not-connected': 'Not connected. Reconnect and try again.', failed: 'Hermes refused the command.' } as const

/** Reads every profile's skills. `quiet` is the timer's refresh: nothing flips to loading and a failure keeps the list. */
export async function loadSkills(quiet = false): Promise<void> {
  const my = ++seq
  const st = useSkills.getState()
  if (!quiet && !st.list) st.setStatus('loading')
  const res = await window.mc.skills.list({ profiles: [] })
  if (my !== seq) return
  if (res.ok) useSkills.getState().applyList(res.data)
  else useSkills.getState().setError(describeQueryError(res.error, res.detail))
}

/** The SKILL.md of a skill, read once per selection (again after an action changed it). */
export async function loadDoc(profile: string, path: string, force = false): Promise<void> {
  const key = `${profile}:${path}`
  const st = useSkills.getState()
  if (!force && st.docs[key] && st.docs[key].status !== 'error') return
  st.setDoc(key, { status: 'loading' })
  const res = await window.mc.skills.read({ profile, path })
  useSkills.getState().setDoc(key, res.ok ? { status: 'ok', text: res.data.text, truncated: res.data.truncated } : { status: 'error', message: describeQueryError(res.error, res.detail) })
}

export function selectSkill(key: string): Promise<void> {
  useSkills.getState().select(key)
  const s = useSkills.getState().list?.skills.find((k) => skillKey(k) === key)
  return s ? loadDoc(s.profile, s.path) : Promise.resolve()
}

export function askSkillAction(action: Exclude<SkillAction, 'install'>): void {
  const key = useSkills.getState().selected
  if (key) useSkills.getState().openAsk(key, action)
}

/** Runs the confirmed curator command, keeps Hermes's answer next to the skill and reads the list again. */
export async function confirmSkillAction(): Promise<void> {
  const st = useSkills.getState()
  const ask = st.ask
  const skill = st.list?.skills.find((k) => skillKey(k) === ask?.key)
  if (!ask || !skill) return
  st.closeAsk()
  st.setNote(ask.key, null)
  st.setPending(ask.key)
  const res = await window.mc.skills.action({ action: ask.action, profile: skill.profile, name: skill.name }).catch((e: unknown) => ({
    ok: false as const,
    error: 'failed' as const,
    detail: e instanceof Error ? e.message : String(e)
  }))
  useSkills.getState().setPending(null)
  const note = res.ok ? { ok: true, title: 'Done', detail: res.output || null } : { ok: false, title: ACTION_ERRORS[res.error], detail: res.detail ?? null }
  await loadSkills(true)
  // the skill may have moved (archive, restore); the note follows it to its new key
  const now = useSkills.getState()
  const moved = now.list?.skills.find((k) => k.profile === skill.profile && k.name === skill.name)
  now.setNote(moved ? skillKey(moved) : ask.key, note)
  if (moved) await loadDoc(moved.profile, moved.path, true)
}

export function openInstall(profile: string): void {
  useSkills.getState().patchInstall({ open: true, profile, inspect: null, note: null, confirm: false })
}

export const closeInstall = (): void => useSkills.getState().patchInstall({ open: false, confirm: false, inspect: null })

/** `hermes skills inspect <id>`: read-only, shown before anything is written. */
export async function inspectHub(): Promise<void> {
  const { id, profile } = useSkills.getState().install
  useSkills.getState().patchInstall({ inspect: { status: 'loading' }, note: null })
  const res = await window.mc.skills.inspect(profile, id.trim())
  useSkills.getState().patchInstall({ inspect: res.ok ? { status: 'ok', text: res.text } : { status: 'error', message: res.detail ? `${ACTION_ERRORS[res.error]} ${res.detail}` : ACTION_ERRORS[res.error] } })
}

/** The confirmed install (with `--yes`, never `--force`); Hermes's scan still decides. */
export async function installHub(): Promise<void> {
  const { id, profile, category } = useSkills.getState().install
  useSkills.getState().patchInstall({ busy: true, confirm: false, note: null })
  const res = await window.mc.skills.action({ action: 'install', profile, id: id.trim(), ...(category.trim() ? { category: category.trim() } : {}) })
  useSkills.getState().patchInstall({
    busy: false,
    note: res.ok ? { ok: true, title: 'Installed', detail: res.output || null } : { ok: false, title: ACTION_ERRORS[res.error], detail: res.detail ?? null }
  })
  if (res.ok) await loadSkills(true)
}

/** The ledger of each profile shown on the Changes tab, and the curator status when one agent is chosen. */
export async function loadChanges(profiles: string[], withStatus: boolean): Promise<void> {
  await Promise.all(
    profiles.map(async (profile) => {
      const st = useSkills.getState()
      if (!st.ledgers[profile] || st.ledgers[profile].status === 'error') st.setLedger(profile, { status: 'loading' })
      const res = await window.mc.skills.ledger({ profile, limit: 200 })
      useSkills.getState().setLedger(profile, res.ok ? { status: 'ok', entries: res.data.entries, exists: res.data.exists, truncated: res.data.truncated } : { status: 'error', message: describeQueryError(res.error, res.detail) })
    })
  )
  if (withStatus && profiles.length === 1) {
    const profile = profiles[0]!
    useSkills.getState().setCurator(profile, { status: 'loading' })
    const res = await window.mc.skills.curatorStatus(profile)
    useSkills.getState().setCurator(profile, res.ok ? { status: 'ok', text: res.text } : { status: 'error', message: res.detail ?? ACTION_ERRORS[res.error] })
  }
}

/** Opens or closes the diff of a ledger entry, reading its blobs once. */
export async function toggleLedgerDiff(profile: string, e: SkillLedgerEntry): Promise<void> {
  useSkills.getState().toggleDiff(`${profile}:${e.id}`)
  if (useSkills.getState().openDiff !== `${profile}:${e.id}`) return
  const f = ledgerDiffFile(e)
  const shas = [f?.before, f?.after].filter((x): x is string => !!x && !useSkills.getState().blobs[x])
  if (shas.length === 0) return
  for (const sha of shas) useSkills.getState().setBlob(sha, { status: 'loading' })
  const res = await window.mc.skills.blobs({ profile, shas })
  for (const sha of shas) {
    const b = res.ok ? res.data.blobs.find((x) => x.sha === sha) : undefined
    useSkills.getState().setBlob(sha, b && 'text' in b ? { status: 'ok', text: b.text, truncated: b.truncated } : { status: 'error', message: 'The stored copy is gone (the curator cleans old backups).' })
  }
}
