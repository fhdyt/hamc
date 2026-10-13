import type { ToolChange } from '@shared/agentOps'

/* Tolerant parsers of `hermes mcp list`, `tools list --platform <p>` and `fallback list` (hermes_cli/mcp_config.py,
   tools_config_mcp.py, fallback_cmd.py). The raw text is always kept and shown when a parser finds nothing. */

export interface McpRow {
  name: string
  transport: string
  tools: string
  enabled: boolean | null
}

export function parseMcpList(text: string): { rows: McpRow[]; empty: boolean } {
  if (/No MCP servers configured/i.test(text)) return { rows: [], empty: true }
  const rows: McpRow[] = []
  // fixed-width columns: cut each row where the header puts Transport, Tools and Status
  let cols: [number, number, number] | null = null
  for (const line of text.split('\n')) {
    const h = /^(\s*)Name\s+Transport\s+Tools\s+Status/.exec(line)
    if (h) {
      cols = [line.indexOf('Transport'), line.indexOf('Tools'), line.indexOf('Status')]
      continue
    }
    if (!cols || /^\s*[─-]{4,}/.test(line) || !line.trim()) continue
    const [t, k, st] = cols
    const name = line.slice(0, t).trim()
    if (!name) continue
    const status = line.slice(st).trim()
    rows.push({
      name,
      transport: line.slice(t, k).trim(),
      tools: line.slice(k, st).trim(),
      enabled: /enabled/.test(status) ? true : /disabled/.test(status) ? false : null
    })
  }
  return { rows, empty: false }
}

export interface ToolRow {
  key: string
  label: string
  enabled: boolean
}

export function parseToolsList(text: string): ToolRow[] {
  const out: ToolRow[] = []
  for (const line of text.split('\n')) {
    // the mark before the word may be ✓/✗, another glyph, or garbled by a terminal encoding: the word decides
    const m = /^\s*(?:\S{1,3}\s+)?(enabled|disabled)\s+([a-z0-9][a-z0-9_-]*)\s*(.*?)\s*$/.exec(line)
    if (m) out.push({ key: m[2]!, label: m[3]!.trim() || m[2]!, enabled: m[1] === 'enabled' })
  }
  return out
}

export interface FallbackView {
  primary: string | null
  chain: string[]
  empty: boolean
}

export function parseFallback(text: string): FallbackView {
  const primary = /Primary:\s+(.+)$/m.exec(text)?.[1]?.trim() ?? null
  const chain = [...text.matchAll(/^\s*\d+\.\s+(.+)$/gm)].map((m) => m[1]!.trim())
  return { primary, chain, empty: /No fallback providers configured/i.test(text) }
}

/** The platforms the Toolsets matrix shows: the CLI, cron and every platform the agent's gateway serves. */
export function toolPlatforms(gatewayPlatforms: readonly string[]): string[] {
  const out = ['cli', 'cron']
  for (const p of gatewayPlatforms) {
    const key = p.toLowerCase()
    if (/^[a-z][a-z0-9_]{0,31}$/.test(key) && !out.includes(key)) out.push(key)
  }
  return out
}

/** The held change of one cell, or null when it matches the server again. */
export function toggleChange(changes: readonly ToolChange[], toolset: string, platform: string, serverEnabled: boolean): ToolChange[] {
  const rest = changes.filter((c) => !(c.toolset === toolset && c.platform === platform))
  const had = changes.some((c) => c.toolset === toolset && c.platform === platform)
  return had ? rest : [...rest, { toolset, platform, enable: !serverEnabled }]
}

/** What a cell shows: the server state, or the held change on top of it. */
export function cellState(changes: readonly ToolChange[], toolset: string, platform: string, serverEnabled: boolean): { on: boolean; held: boolean } {
  const c = changes.find((x) => x.toolset === toolset && x.platform === platform)
  return c ? { on: c.enable, held: true } : { on: serverEnabled, held: false }
}
