import type { Capabilities } from '@shared/ipc'
import type { Execer } from './manager'
import { probeCmd, runSafe } from './remote'

export const PROBES: { id: string; sub: string[] }[] = [
  { id: 'cron runs', sub: ['cron', 'runs'] },
  { id: 'curator status', sub: ['curator', 'status'] },
  { id: 'sessions list', sub: ['sessions', 'list'] },
  { id: 'tools --summary', sub: ['tools'] },
  { id: 'fallback list', sub: ['fallback', 'list'] },
  { id: 'mcp list', sub: ['mcp', 'list'] },
  { id: 'approvals suggest', sub: ['approvals', 'suggest'] }
]

export async function probeCapabilities(conn: Execer, hermesPath: string | null, version: string | null): Promise<Capabilities> {
  const supported: Record<string, boolean> = {}
  if (!hermesPath) {
    for (const p of PROBES) supported[p.id] = false
    return { version, supported }
  }
  await Promise.all(
    PROBES.map(async (p) => {
      supported[p.id] = (await runSafe(conn, probeCmd(hermesPath, p.sub), 10_000)).code === 0
    })
  )
  return { version, supported }
}
