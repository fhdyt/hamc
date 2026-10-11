import type { AgentsData, MetricsData } from '@shared/events'

export function sampleMetrics(over: Partial<MetricsData> = {}): MetricsData {
  return {
    cpu: { total: 34, cores: [41, 28, 63, 19], load: [1.42, 0.98, 0.77], uptimeS: 1_038_240, tempC: 52 },
    mem: { total: 17179869184, used: 6.1e9, cached: 5.4e9, available: 9.9e9, free: 4.5e9, swapTotal: 2e9, swapUsed: 1e8 },
    disks: [{ mount: '/', fs: 'ext4', total: 160e9, used: 77e9 }],
    io: { readBps: 2.1e6, writeBps: 6.4e5 },
    net: [{ name: 'eth0', rxBps: 1.2e6, txBps: 3.4e5, rxTotal: 48e9, txTotal: 9.7e9 }],
    procs: [{ pid: 1842, user: 'root', cpu: 22.4, mem: 3.1, rss: 512e6, cmd: 'python -m hermes_cli.main gateway run', hermes: true }],
    tasks: 214,
    ...over
  }
}

export function sampleAgents(): AgentsData {
  return {
    agents: [
      { profile: 'default', displayName: 'default', status: 'idle', platforms: ['telegram'], lastActivityTs: 1_760_000_000, configMtime: 1_759_000_000, hasSoul: true, hasMemory: true, hasUser: true },
      { profile: 'scout', displayName: 'Scout', status: 'working', platforms: [], lastActivityTs: 1_760_000_100, configMtime: null, hasSoul: false, hasMemory: false, hasUser: false }
    ],
    gateway: { up: true, heartbeatAgeS: 4, served: ['default', 'scout'] }
  }
}
