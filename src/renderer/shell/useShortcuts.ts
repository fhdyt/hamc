import { useEffect } from 'react'
import { stepZoomLevel } from '../actions'
import { togglePalette } from '../paletteActions'
import { useUi } from '../stores/ui'
import { routeForShortcut } from './nav'

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const { route, navigate } = useUi.getState()
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        void stepZoomLevel(1)
        return
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        void stepZoomLevel(-1)
        return
      }
      if (route === 'connect' || route === 'launch') return
      if ((e.key === 'k' || e.key === 'K') && !e.shiftKey) {
        e.preventDefault()
        togglePalette()
        return
      }
      const target = routeForShortcut(e.key)
      if (target) {
        e.preventDefault()
        navigate(target)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
