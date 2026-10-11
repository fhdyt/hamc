import { useEffect, useState } from 'react'

/** True when `waiting` has been true for `ms` without a break: used to replace an endless spinner with an explanation. */
export function useStalled(waiting: boolean, ms = 10_000): boolean {
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    if (!waiting) {
      setStalled(false)
      return
    }
    const t = window.setTimeout(() => setStalled(true), ms)
    return () => window.clearTimeout(t)
  }, [waiting, ms])
  return stalled
}
