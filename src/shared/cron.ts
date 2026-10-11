/** True for a cron run status that means the run failed. Unknown statuses are not failures. */
export function isFailure(status: string | null): boolean {
  if (!status) return false
  const s = status.toLowerCase()
  return s === 'error' || s === 'delivery_failed' || s === 'blocked_config' || s.startsWith('error')
}
