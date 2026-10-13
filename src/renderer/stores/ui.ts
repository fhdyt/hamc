import { create } from 'zustand'
import { SETTINGS_DEFAULTS, type SettingsMap } from '@shared/settings'

export type Route =
  | 'connect' | 'launch' | 'dashboard' | 'chat' | 'feed' | 'sessions' | 'kanban' | 'usage' | 'skills' | 'logs' | 'brain' | 'server'

export type SettingsTab = 'general' | 'connection' | 'notifications' | 'alerts' | 'agents' | 'workspace' | 'chat' | 'terminal' | 'uploads' | 'data' | 'about'

interface UiState {
  route: Route
  settings: SettingsMap
  settingsTab: SettingsTab | null
  ready: boolean
  navigate(route: Route): void
  hydrate(settings: SettingsMap): void
  patchSettings(patch: Partial<SettingsMap>): void
  openSettings(tab?: SettingsTab): void
  closeSettings(): void
}

export const useUi = create<UiState>()((set) => ({
  route: 'connect',
  settings: { ...SETTINGS_DEFAULTS },
  settingsTab: null,
  ready: false,
  navigate: (route) => set({ route }),
  hydrate: (settings) => set({ settings, ready: true }),
  patchSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  openSettings: (tab = 'general') => set({ settingsTab: tab }),
  closeSettings: () => set({ settingsTab: null })
}))
