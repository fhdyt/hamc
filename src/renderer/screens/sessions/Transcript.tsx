import { useEffect, useMemo, useState } from 'react'
import type { SessionRow } from '@shared/events'
import type { ExportExt, SessionAction } from '@shared/sessions'
import { Icon } from '../../components/Icon'
import { Markdown } from '../../components/Markdown'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { agentColor } from '../../lib/agentColor'
import { clock, formatTokens } from '../../lib/feed'
import { costLabel, durationLabel, statusLabel } from '../../lib/sessions'
import { buildSteps } from '../../lib/transcript'
import { continueInChat, exportSession, loadMoreTranscript, openSession } from '../../sessionsActions'
import { useAgents } from '../../stores/agents'
import { useSessions } from '../../stores/sessions'
import { ActionDialog } from './ActionDialogs'
import { ToolChip } from './ToolChip'

const FORMATS: { ext: ExportExt; label: string }[] = [
  { ext: 'md', label: 'Markdown (.md)' },
  { ext: 'html', label: 'HTML (.html)' },
  { ext: 'jsonl', label: 'JSON Lines (.jsonl)' }
]

function Header({ row, onDialog }: { row: SessionRow; onDialog: (a: SessionAction) => void }) {
  const chain = useSessions((s) => s.transcript.chain)
  const select = useSessions((s) => s.select)
  const agents = useAgents((s) => s.agents)
  const name = agents.find((a) => a.profile === row.profile)?.displayName ?? row.profile
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const doExport = async (ext: ExportExt): Promise<void> => {
    setExportOpen(false)
    setExporting(true)
    const { result, truncated } = await exportSession(row, ext)
    setExporting(false)
    const st = useSessions.getState()
    if ('saved' in result) st.setNotice({ kind: 'ok', text: `Saved to ${result.saved}. Built on this computer, nothing was written on the server.${truncated ? ' Exported the first 10,000 messages.' : ''}` })
    else if ('failed' in result) st.setNotice({ kind: 'error', text: `Export failed: ${result.failed}` })
  }

  return (
    <header className="ses-head">
      <div className="ses-head-top">
        <button type="button" className="ib ses-back" aria-label="Back to the list" onClick={() => select(null)}>
          <Icon name="chevs-left" size={14} />
        </button>
        <h2>{row.title ?? 'Untitled session'}</h2>
        <span className="ses-status" data-status={row.status}>
          {statusLabel(row.status)}
        </span>
      </div>
      <div className="ses-head-meta">
        <span style={{ color: agentColor(row.profile) }}>{name}</span>
        {row.source && <span className="tag">{row.source}</span>}
        {row.model && <span>{row.model}</span>}
        {row.status !== 'running' && <span>{durationLabel(row)}</span>}
        {(row.inputTokens !== null || row.outputTokens !== null) && (
          <span className="num">
            {row.inputTokens !== null ? formatTokens(row.inputTokens) : '?'} in · {row.outputTokens !== null ? formatTokens(row.outputTokens) : '?'} out
            {row.cacheReadTokens ? ` · ${formatTokens(row.cacheReadTokens)} cache` : ''}
          </span>
        )}
        <span className="num">{costLabel(row)}</span>
      </div>
      <div className="ses-id num">{row.id}</div>
      {chain?.parent && (
        <div className="ses-chain">
          continues{' '}
          <button type="button" className="fr-more" onClick={() => void openSession(row.profile, chain.parent!.id)}>
            {chain.parent.title ?? chain.parent.id}
          </button>
        </div>
      )}
      {chain?.children.map((c) => (
        <div key={c.id} className="ses-chain">
          continued in{' '}
          <button type="button" className="fr-more" onClick={() => void openSession(row.profile, c.id)}>
            {c.title ?? c.id}
          </button>
          {c.source && <span className="tag">{c.source}</span>}
        </div>
      ))}
      <div className="ses-actions">
        <button type="button" className="cb pri" title={`hermes ${row.profile === 'default' ? '' : `-p ${row.profile} `}chat --resume ${row.id}`} onClick={() => void continueInChat(row)}>
          <Icon name="message" size={13} /> Continue in Chat
        </button>
        <button type="button" className="cb" aria-pressed={row.pinned} onClick={() => onDialog(row.pinned ? 'unpin' : 'pin')}>
          <Icon name="pin" size={13} /> {row.pinned ? 'Unpin' : 'Pin'}
        </button>
        <button type="button" className="cb" onClick={() => onDialog('rename')}>
          <Icon name="edit" size={13} /> Rename
        </button>
        <div className="ses-menu-wrap">
          <button type="button" className="cb" aria-haspopup="menu" aria-expanded={exportOpen} disabled={exporting} onClick={() => setExportOpen(!exportOpen)}>
            <Icon name="download" size={13} /> {exporting ? 'Exporting…' : 'Export'} <Icon name="chev-down" size={12} />
          </button>
          {exportOpen && (
            <div className="ses-menu" role="menu" aria-label="Export format">
              {FORMATS.map((f) => (
                <button key={f.ext} type="button" role="menuitem" className="ses-menu-item" onClick={() => void doExport(f.ext)}>
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

export function Transcript() {
  const selected = useSessions((s) => s.selected)
  const t = useSessions((s) => s.transcript)
  const listRow = useSessions((s) => s.rows.find((r) => selected && r.profile === selected.profile && r.id === selected.id) ?? null)
  const notice = useSessions((s) => s.notice)
  const setNotice = useSessions((s) => s.setNotice)
  const [dialog, setDialog] = useState<SessionAction | null>(null)
  const steps = useMemo(() => buildSteps(t.items), [t.items])
  const row = t.session ?? listRow

  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 8000)
    return () => window.clearTimeout(id)
  }, [notice, setNotice])

  if (!selected) return null
  if (t.status === 'error' && !row) {
    return <ErrorState title="Could not open the session" why={t.error ?? undefined} onRetry={() => void openSession(selected.profile, selected.id)} />
  }

  return (
    <>
      {row ? <Header row={row} onDialog={setDialog} /> : <Skeleton rows={3} />}
      {notice && (
        <div className={`banner ${notice.kind === 'ok' ? 'ok' : 'bad'}`} role="status">
          {notice.text}
        </div>
      )}
      <div className="ses-body" role="log" aria-label="Transcript">
        {t.status === 'loading' && <Skeleton rows={6} />}
        {t.status === 'error' && <ErrorState title="Could not load the messages" why={t.error ?? undefined} onRetry={() => void openSession(selected.profile, selected.id)} />}
        {t.status === 'ok' && steps.length === 0 && <EmptyState title="No messages in this session" />}
        {steps.map((s) => {
          const it = s.item
          if (s.kind === 'tool') return <ToolChip key={it.id} step={s} />
          if (s.kind === 'user')
            return (
              <div key={it.id} className="ses-msg user">
                <span className="ses-time num">{clock(it.ts)}</span>
                {it.text}
              </div>
            )
          if (s.kind === 'thinking')
            return (
              <details key={it.id} className="ses-think">
                <summary>Thinking</summary>
                <p>{it.text}</p>
              </details>
            )
          return (
            <div key={it.id} className="ses-msg reply">
              <span className="ses-time num">{clock(it.ts)}</span>
              <Markdown text={it.text} />
            </div>
          )
        })}
        {t.status === 'ok' && t.nextAfter !== null && (
          <div className="ses-more">
            <span>Showing the first {t.items.length} items.</span>
            <button type="button" className="cb" disabled={t.loadingMore} onClick={() => void loadMoreTranscript()}>
              {t.loadingMore ? 'Loading…' : 'Load next 200'}
            </button>
          </div>
        )}
        {t.status === 'ok' && t.error && <div className="banner bad">{t.error}</div>}
      </div>
      {dialog && row && <ActionDialog action={dialog} row={row} onClose={() => setDialog(null)} />}
    </>
  )
}
