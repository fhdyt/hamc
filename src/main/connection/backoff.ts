export const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000] as const

export function backoffDelay(attempt: number): number {
  const i = Math.max(0, Math.min(attempt, BACKOFF_MS.length - 1))
  return BACKOFF_MS[i]!
}
