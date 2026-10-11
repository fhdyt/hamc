import { useState } from 'react'
import { saveSetting } from '../actions'
import type { SettingsMap } from '@shared/settings'
import { useUi } from '../stores/ui'

type NumericKey = { [K in keyof SettingsMap]: SettingsMap[K] extends number ? K : never }[keyof SettingsMap]

/** A saved number that follows a drag live and is written to app.db when the drag ends. */
export function useLiveSetting(key: NumericKey): { value: number; onChange(v: number): void; onCommit(v: number): void } {
  const saved = useUi((s) => s.settings[key]) as number
  const [live, setLive] = useState<number | null>(null)
  return {
    value: live ?? saved,
    onChange: setLive,
    onCommit: (v) => {
      void saveSetting(key, v as never)
      setLive(null)
    }
  }
}
