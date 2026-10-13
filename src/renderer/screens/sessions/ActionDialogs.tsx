import { useState } from 'react'
import type { SessionRow } from '@shared/events'
import { TITLE_MAX, sessionCommandPreview, validTitle, type SessionAction } from '@shared/sessions'
import { Modal } from '../../components/Modal'
import { runAction } from '../../sessionsActions'

const DETAIL: Record<SessionAction, string> = {
  pin: 'Pinned sessions stay at the top of the history in Hermes.',
  unpin: 'The session is no longer pinned in Hermes.',
  rename: 'Hermes stores the new title with the session.'
}
const TITLE: Record<SessionAction, string> = { pin: 'Pin session', unpin: 'Unpin session', rename: 'Rename session' }
const CONFIRM: Record<SessionAction, string> = { pin: 'Pin session', unpin: 'Unpin session', rename: 'Rename session' }

/** Pin, unpin and rename change the server, so they show the exact command and wait for a yes. */
export function ActionDialog({ action, row, onClose }: { action: SessionAction; row: SessionRow; onClose: () => void }) {
  const [draft, setDraft] = useState(row.title ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clean = action === 'rename' ? validTitle(draft) : undefined
  const invalid = action === 'rename' && clean === null
  const preview = sessionCommandPreview(action, row.profile, row.id, action === 'rename' ? (clean ?? draft) : undefined)

  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = await runAction(action, row, clean ?? undefined)
    setBusy(false)
    if (res.ok) onClose()
    else setError(res.error === 'not-connected' ? 'Not connected to the server.' : res.error === 'bad-input' ? 'Hermes cannot take that value.' : (res.detail ?? 'The command failed.'))
  }

  return (
    <Modal title={TITLE[action]} onClose={onClose} width={520}>
      <div className="ses-dlg">
        <p className="ses-dlg-text">{DETAIL[action]}</p>
        {action === 'rename' && (
          <>
            <label htmlFor="ses-rename" className="ses-dlg-lbl">
              New title
            </label>
            <input id="ses-rename" type="text" className="fld" maxLength={TITLE_MAX} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          </>
        )}
        <span className="ses-dlg-lbl">This runs on the server:</span>
        <pre className="ses-dlg-cmd">{preview}</pre>
        {error && (
          <div className="banner bad" role="alert">
            {error}
          </div>
        )}
        <div className="ses-dlg-actions">
          <button type="button" className="cb" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="cb pri" disabled={busy || invalid} onClick={() => void confirm()}>
            {busy ? 'Working…' : CONFIRM[action]}
          </button>
        </div>
      </div>
    </Modal>
  )
}
