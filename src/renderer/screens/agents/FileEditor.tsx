import { useEffect, useState } from 'react'
import { FILE_LABEL, FILE_LIMITS, charCount, type AgentFileKind } from '@shared/agentCfg'
import { loadFile, refreshFile, saveFile } from '../../agentCfgActions'
import { Icon } from '../../components/Icon'
import { Markdown } from '../../components/Markdown'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { SAVE_BLOCK_TEXT, draftKey, isDirty, saveBlock, withEdit, withRevert } from '../../lib/agentCfg'
import { useAgentCfg } from '../../stores/agentCfg'
import { useConn } from '../../stores/conn'
import { ConflictDialog, RestartDialog, SaveDialog } from './Dialogs'
import { EntriesEditor } from './EntriesEditor'

const POLL_MS = 5000
const STARTER_SOUL = '# Soul\n\nWho this agent is and how it behaves.\n'

type Dialog = 'save' | 'conflict' | 'restart' | null

/** The editor of SOUL.md, MEMORY.md or USER.md of one agent. Edits stay in memory until Save (F-CFG-18). */
export function FileEditor({ profile, kind }: { profile: string; kind: AgentFileKind }) {
  const d = useAgentCfg((s) => s.drafts[draftKey(profile, kind)])
  const patch = useAgentCfg((s) => s.patchDraft)
  const connected = useConn((s) => s.status.state === 'connected')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [raw, setRaw] = useState(false)
  const loaded = !!d?.loaded

  useEffect(() => {
    if (connected) void loadFile(profile, kind)
  }, [profile, kind, connected])

  // F-CFG-16: look at the file again every few seconds while this editor is open.
  useEffect(() => {
    if (!connected || !loaded) return
    const t = window.setInterval(() => {
      if (!document.hidden) void refreshFile(profile, kind)
    }, POLL_MS)
    return () => window.clearInterval(t)
  }, [profile, kind, connected, loaded])

  // A save that found a different file opens the conflict dialog by itself.
  useEffect(() => {
    if (d?.conflict) setDialog('conflict')
  }, [d?.conflict])

  const name = FILE_LABEL[kind]
  if (!d || !d.loaded) {
    if (d?.error) return <ErrorState title={`${name} could not be opened`} why={d.error} onRetry={() => void loadFile(profile, kind, true)} />
    if (!connected) return <EmptyState title="Not connected" why="Connect to the server to open this file." />
    return <Skeleton rows={6} />
  }

  const limit = FILE_LIMITS[kind]
  const count = charCount(d.text)
  const block = saveBlock(d, connected)
  const dirty = isDirty(d)
  const edit = (t: string): void => patch(profile, kind, (x) => withEdit(x, t))
  const doSave = async (): Promise<void> => {
    await saveFile(profile, kind)
    setDialog(useAgentCfg.getState().drafts[draftKey(profile, kind)]?.conflict ? 'conflict' : null)
  }

  const missing = kind === 'soul' && !d.baseExists && d.text === '' && !dirty
  const changed = d.conflict ?? d.serverChanged

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="ag-bar">
        <strong>{name}</strong>
        {dirty && (
          <span className="ag-dirty">
            <span className="dot" style={{ background: '#FFB86C' }} /> unsaved
          </span>
        )}
        <span className="grow" />
        {limit !== null && (
          <span className={`ag-count${count > limit ? ' bad' : ''}`} aria-live="polite">
            {count} / {limit} characters
          </span>
        )}
        {limit === null && <span className="ag-count">{count} characters</span>}
        {kind !== 'soul' && (
          <span className="seg" role="group" aria-label="Editor mode">
            <button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>
              Entries
            </button>
            <button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>
              Raw
            </button>
          </span>
        )}
        <button type="button" className="cb" onClick={() => patch(profile, kind, withRevert)} disabled={d.undo.length === 0} title="Puts the text from before your last save back into the editor">
          <Icon name="undo" size={12} /> Revert last save
        </button>
        <button type="button" className="cb pri" onClick={() => setDialog('save')} disabled={block !== null} title={block ? SAVE_BLOCK_TEXT[block] : 'Review the changes and save'}>
          <Icon name="save" size={12} /> Save
        </button>
      </div>

      {!connected && (
        <div className="cv-banner warn" role="status">
          <Icon name="alert" size={13} /> The connection is down. Your edits stay here; saving is off until it is back.
        </div>
      )}
      {d.error && (
        <div className="cv-banner bad" role="alert">
          <Icon name="alert" size={13} /> {d.error}
        </div>
      )}
      {changed && (
        <div className="cv-banner warn" role="status">
          <Icon name="alert" size={13} /> {name} changed on the server while you were editing.
          <button type="button" className="cb sm" onClick={() => setDialog('conflict')}>
            Resolve…
          </button>
        </div>
      )}
      {d.notice && (
        <div className="cv-banner" role="status">
          <Icon name="info" size={13} /> {d.notice}
          {d.notice.startsWith('Saved') && (
            <button type="button" className="cb sm" onClick={() => setDialog('restart')}>
              Restart this agent’s gateway…
            </button>
          )}
        </div>
      )}

      {missing ? (
        <EmptyState title={`${name} does not exist yet`} why="Hermes creates it when it needs it. You can create it now.">
          <button type="button" className="cb pri" onClick={() => edit(STARTER_SOUL)} disabled={!connected}>
            <Icon name="plus" size={12} /> Create {name}
          </button>
        </EmptyState>
      ) : kind === 'soul' ? (
        <div className="ag-split">
          <textarea className="ag-text" rows={16} value={d.text} onChange={(e) => edit(e.target.value)} aria-label="SOUL.md text" spellCheck={false} />
          <div className="ag-preview" aria-label="Preview">
            <Markdown text={d.text || '*Nothing to preview.*'} className="md-chat" />
          </div>
        </div>
      ) : raw ? (
        <textarea className="ag-text" rows={14} value={d.text} onChange={(e) => edit(e.target.value)} aria-label={`${name} raw text`} spellCheck={false} />
      ) : (
        <EntriesEditor text={d.text} onChange={edit} label={`${name} entries`} />
      )}
      <span className="ag-note">Changes apply to new sessions. Nothing is saved until you press Save, and no draft is kept on this computer.</span>

      {dialog === 'save' && <SaveDialog d={d} saving={d.saving} onSave={() => void doSave()} onCancel={() => setDialog(null)} onRestart={() => setDialog('restart')} />}
      {dialog === 'conflict' && changed && <ConflictDialog d={d} kind={kind} onClose={() => setDialog(null)} />}
      {dialog === 'restart' && <RestartDialog profile={profile} onClose={() => setDialog(null)} />}
    </div>
  )
}
