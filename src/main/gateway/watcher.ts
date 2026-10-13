import type { AgentInfo } from '@shared/events'
import { describeGatewayDown, describePlatform, gatewayDown, isPlatformProblem } from '@shared/gateway'

export interface GatewayAlert {
  profile: string
  kind: 'gateway' | 'platform'
  platform?: string
  detail: string
}

/**
 * Decides which gateway changes deserve a notification: a gateway that went from running to down, or a platform that
 * went from healthy to failed. The first batch is a baseline, so an agent that was already down when the app looked
 * never rings, and a change is reported once until it has recovered.
 */
export class GatewayWatcher {
  private down = new Map<string, boolean>()
  private bad = new Map<string, boolean>()
  private baselined = false

  ingest(agents: readonly AgentInfo[]): GatewayAlert[] {
    const alerts: GatewayAlert[] = []
    for (const a of agents) {
      const g = a.gateway
      if (!g) continue
      const isDown = gatewayDown(g)
      if (this.baselined && this.down.get(a.profile) === false && isDown) alerts.push({ profile: a.profile, kind: 'gateway', detail: describeGatewayDown(g) })
      this.down.set(a.profile, isDown)
      for (const p of g.platforms) {
        const key = `${a.profile}/${p.name}`
        const isBad = isPlatformProblem(p)
        if (this.baselined && this.bad.get(key) === false && isBad) alerts.push({ profile: a.profile, kind: 'platform', platform: p.name, detail: describePlatform(p) })
        this.bad.set(key, isBad)
      }
    }
    this.baselined = true
    return alerts
  }

  reset(): void {
    this.down.clear()
    this.bad.clear()
    this.baselined = false
  }
}
