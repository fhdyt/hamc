import { create } from 'zustand'
import type { UpdateState } from '@shared/update'

export const useUpdate = create<{ state: UpdateState | null; set(s: UpdateState | null): void }>()((set) => ({
  state: null,
  set: (state) => set({ state })
}))

/** One line for the About tab. */
export function updateLine(s: UpdateState | null): string {
  if (!s) return 'Checking how updates work here…'
  switch (s.phase) {
    case 'unsupported':
      return s.message ?? 'Automatic updates are not available here.'
    case 'idle':
      return s.checkedAt ? 'Up to date as of the last check.' : 'Not checked yet.'
    case 'checking':
      return 'Checking for updates…'
    case 'none':
      return 'You have the latest version.'
    case 'downloading':
      return `Downloading ${s.version ? `v${s.version}` : 'the update'}${s.percent !== null ? ` · ${s.percent}%` : ''}…`
    case 'ready':
      return `${s.version ? `v${s.version}` : 'The update'} is ready. It installs when you quit, or restart now.`
    case 'error':
      return s.message ?? 'The update check failed.'
  }
}
