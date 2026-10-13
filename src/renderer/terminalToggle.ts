import { saveSetting } from './actions'
import { useTerminal } from './stores/terminal'
import { useUi } from './stores/ui'

/* Opening and closing the Terminal panel is only a setting: the panel (components/TerminalPanel.tsx) starts a shell and
   takes the focus when it opens. Kept apart from terminalActions.ts so the palette and the shortcuts do not load xterm. */

export const terminalOpen = (): boolean => useUi.getState().settings['terminal.open']

export function setTerminalOpen(open: boolean): void {
  void saveSetting('terminal.open', open)
  if (!open) useTerminal.getState().set({ searchOpen: false, snippetsOpen: false })
}

export const toggleTerminal = (): void => setTerminalOpen(!terminalOpen())
