import type { AgentsData, BrainData, BrainNote, CronData, CronJob, FeedData, FeedItem, MetricsData } from '@shared/events'

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

export function sampleJob(over: Partial<CronJob> = {}): CronJob {
  return {
    profile: 'default',
    id: '09358c101c91',
    name: 'second-brain-daily-sync',
    schedule: { kind: 'cron', expr: '0 23 * * *', display: '0 23 * * *' },
    state: 'scheduled',
    enabled: true,
    nextRunTs: 1_791_734_400,
    lastRunTs: 1_791_648_025,
    tzOffsetMin: 420,
    lastStatus: 'error',
    lastError: 'boom',
    lastDeliveryError: null,
    failureStreak: 10,
    deliver: 'local',
    model: 'deepseek-v4-flash',
    provider: 'deepseek',
    skills: [],
    repeat: { times: null, completed: 39 },
    prompt: 'do the thing',
    lastOutput: { rel: '09358c101c91/2026-10-10_23-00-25.md', mtime: 1_791_648_025 },
    ...over
  }
}

export function sampleCron(): CronData {
  return {
    jobs: [
      sampleJob(),
      sampleJob({ profile: 'scout', id: 'aaaaaaaaaaaa', name: 'never-ran', lastStatus: null, lastRunTs: null, failureStreak: 0, lastError: null, lastOutput: null }),
      sampleJob({ profile: 'scout', id: 'bbbbbbbbbbbb', name: 'Pantau pembaruan', lastStatus: 'ok', failureStreak: 0, lastError: null, deliver: 'telegram:744164478' })
    ],
    profiles: [
      { profile: 'default', ok: true, error: null },
      { profile: 'scout', ok: true, error: null },
      { profile: 'atlas', ok: true, error: null }
    ]
  }
}

export function sampleItem(over: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'default:2:0',
    profile: 'default',
    messageId: 2,
    sessionId: 's-default-1',
    source: 'telegram',
    parentSessionId: null,
    ts: 1_759_996_100,
    kind: 'user',
    text: 'hello agent',
    truncated: false,
    fullLen: 11,
    toolName: null,
    ...over
  }
}

export function sampleFeed(): FeedData {
  return {
    items: [
      sampleItem(),
      sampleItem({ id: 'default:3:0', messageId: 3, kind: 'thinking', text: 'User greets; search first.', fullLen: 26 }),
      sampleItem({ id: 'default:3:2', messageId: 3, kind: 'tool', text: 'web_search {"q": "hermes"}', toolName: 'web_search', fullLen: 25 }),
      sampleItem({ id: 'default:4:0', messageId: 4, kind: 'result', text: '3 results', toolName: 'web_search', fullLen: 9 }),
      sampleItem({ id: 'scout:5:1', profile: 'scout', messageId: 5, sessionId: 's-scout-1', source: 'cron', kind: 'reply', text: 'digest done', fullLen: 11 })
    ],
    cursors: { default: 4, scout: 5 },
    history: true
  }
}

export function sampleNote(over: Partial<BrainNote> = {}): BrainNote {
  return { id: 'Index.md', title: 'Index', mtime: 1_759_996_000, size: 120, tags: ['home'], aliases: [], links: [], ghosts: [], attachments: [], ...over }
}

export function sampleBrain(over: Partial<BrainData> = {}): BrainData {
  return {
    mode: 'snapshot',
    first: true,
    done: true,
    total: 3,
    truncated: false,
    notes: [
      sampleNote({ links: ['Alpha.md', 'folder/Gamma.md'], ghosts: ['Missing'], attachments: ['pic.png'] }),
      sampleNote({ id: 'Alpha.md', title: 'Alpha', tags: ['alpha', 'work'], aliases: ['A'], links: ['Index.md'] }),
      sampleNote({ id: 'folder/Gamma.md', title: 'Gamma', tags: [], links: ['Index.md'] })
    ],
    removed: [],
    ...over
  }
}
