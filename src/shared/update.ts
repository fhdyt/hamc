/* Auto-update (PRD F-APP-6) through electron-updater and the GitHub releases of fhdyt/hamc. */

export type UpdatePhase =
  | 'unsupported' // a development build, a .deb install or a platform without updates
  | 'idle'
  | 'checking'
  | 'none' // up to date
  | 'downloading'
  | 'ready' // downloaded; installs on quit or with Restart to update
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** The running version. */
  current: string
  /** The version found, once there is one. */
  version: string | null
  /** 0..100 while downloading. */
  percent: number | null
  /** Epoch ms of the last finished check. */
  checkedAt: number | null
  /** Why updates do not work here, or what went wrong. */
  message: string | null
}

/** How often a running app looks for a new version. */
export const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000
/** The first check waits a little, so it never slows the start or the connection. */
export const UPDATE_FIRST_DELAY_MS = 20_000

/** A short, readable reason from an updater error (no stack, no long URLs). */
export function updateErrorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const first = raw.split('\n')[0] ?? raw
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_|getaddrinfo/i.test(first)) return 'Could not reach GitHub. Check the internet connection.'
  if (/404/.test(first) && /latest.*\.yml|releases/i.test(raw)) return 'No published release with update files was found yet.'
  if (/code signature|not signed|signature/i.test(first)) return 'The update is not signed, so the system refused it.'
  return first.replace(/https?:\/\/\S+/g, '[url]').slice(0, 200)
}
