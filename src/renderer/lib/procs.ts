import type { MetricsData } from '@shared/events'

export type SortKey = 'cpu' | 'mem' | 'pid'
type Proc = MetricsData['procs'][number]

export function sortProcs(procs: readonly Proc[], key: SortKey, hermesOnly: boolean): Proc[] {
  const rows = procs.filter((p) => !hermesOnly || p.hermes)
  return rows.sort((a, b) => (key === 'pid' ? a.pid - b.pid : key === 'cpu' ? b.cpu - a.cpu : b.mem - a.mem))
}

export function ariaSort(active: SortKey, key: SortKey): 'descending' | 'ascending' | 'none' {
  if (active !== key) return 'none'
  return key === 'pid' ? 'ascending' : 'descending'
}
