import type { FeedItem, SessionRow } from '@shared/events'
import { costLabel, durationLabel } from './sessions'

const iso = (ts: number | null): string => (ts === null ? 'unknown' : new Date(ts * 1000).toISOString())

/** A file name stem for the export: the title when there is one, else the id, without unsafe characters. */
export function exportName(row: Pick<SessionRow, 'title' | 'id'>): string {
  const clean = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return clean(row.title ?? '') || clean(row.id) || 'session'
}

export function toJsonl(row: SessionRow, items: readonly FeedItem[]): string {
  const head = {
    type: 'session', id: row.id, profile: row.profile, title: row.title, source: row.source, model: row.model, status: row.status,
    startedAt: row.startedAt, endedAt: row.endedAt, messageCount: row.messageCount, cost: row.cost, costKind: row.costKind
  }
  const lines = [JSON.stringify(head)]
  for (const it of items) lines.push(JSON.stringify({ type: 'message', kind: it.kind, ts: it.ts, toolName: it.toolName, text: it.text, truncated: it.truncated }))
  return lines.join('\n') + '\n'
}

const KIND_TITLE: Record<FeedItem['kind'], string> = { user: 'user', reply: 'reply', thinking: 'thinking', tool: 'tool call', result: 'tool result' }

function fence(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length))
  const bar = '`'.repeat(Math.max(3, longest + 1))
  return `${bar}\n${text}\n${bar}`
}

function metaLines(row: SessionRow): [string, string][] {
  return [
    ['Agent', row.profile], ['Session', row.id], ['Source', row.source ?? 'unknown'], ['Model', row.model ?? 'unknown'],
    ['Started', iso(row.startedAt)], ['Duration', durationLabel(row)], ['Status', row.status], ['Cost', costLabel(row)]
  ]
}

export function toMarkdown(row: SessionRow, items: readonly FeedItem[]): string {
  const out = [`# ${row.title ?? row.id}`, '', ...metaLines(row).map(([k, v]) => `- ${k}: ${v}`), '']
  for (const it of items) {
    out.push(`### ${KIND_TITLE[it.kind]}${it.toolName ? ` · ${it.toolName}` : ''} · ${iso(it.ts)}`, '')
    if (it.kind === 'tool' || it.kind === 'result') out.push(fence(it.text))
    else if (it.kind === 'thinking') out.push(...it.text.split('\n').map((l) => `> ${l}`))
    else out.push(it.text)
    out.push('')
  }
  return out.join('\n')
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const CSS =
  'body{font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;background:#282A36;color:#F8F8F2;max-width:860px;margin:2rem auto;padding:0 1rem}' +
  'h1{font-size:1.2rem}dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;color:#A9B2D3}dt{color:#8B95BD}dd{margin:0}' +
  '.m{margin:14px 0;padding:8px 12px;border-left:3px solid #44475A;white-space:pre-wrap;overflow-wrap:anywhere}' +
  '.m b{display:block;font-size:12px;color:#8BE9FD}.user{border-color:#50FA7B}.thinking{color:#A9B2D3;font-style:italic}' +
  '.tool,.result{background:#191A21}'

/** A standalone page. Every piece of text is escaped and the page carries no script. */
export function toHtml(row: SessionRow, items: readonly FeedItem[]): string {
  const title = esc(row.title ?? row.id)
  const meta = metaLines(row).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')
  const body = items
    .map((it) => `<div class="m ${it.kind}"><b>${esc(KIND_TITLE[it.kind])}${it.toolName ? ` · ${esc(it.toolName)}` : ''} · ${esc(iso(it.ts))}</b>${esc(it.text)}</div>`)
    .join('\n')
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body>\n<h1>${title}</h1>\n<dl>${meta}</dl>\n${body}\n</body></html>\n`
}
