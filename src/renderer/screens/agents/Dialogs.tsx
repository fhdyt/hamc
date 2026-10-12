import { useState } from 'react'
import type { AgentFileKind } from '@shared/agentCfg'
import { FILE_LABEL } from '@shared/agentCfg'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { keepMine, mergeTheirs, takeTheirs, type Draft } from '../../lib/agentCfg'
import { useAgentCfg } from '../../stores/agentCfg'
import { DiffView } from './DiffView'

/** "You have unsaved changes" (F-CFG-18): shown when a leave was requested while an editor has edits. */
export function UnsavedDialog() {
  const leave = useAgentCfg((s) => s.leave)
  const answer = useAgentCfg((s) => s.answerLeave)
  if (!leave) return null
  return (
    <Modal title="Unsaved changes" onClose={() => answer(false)} width={440}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="cv-banner warn" role="alert">
          <Icon name="alert" size={13} /> You have unsaved changes
        </div>
        <span>{leave.message}</span>
        <div className="ag-bar" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="cb dng" onClick={() => answer(true)}>
            Discard changes
          </button>
          <button type="button" className="cb pri" onClick={() => answer(false)}>
            Keep editing
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** The diff the user confirms before a file is written (F-CFG, 6.8: nothing is written without it). */
export function SaveDialog({ d, saving, onSave, onCancel, onRestart }: { d: Draft; saving: boolean; onSave: () => void; onCancel: () => void; onRestart: () => void }) {
  const name = FILE_LABEL[d.kind]
  return (
    <Modal title={`Save ${name}`} onClose={onCancel} width={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span>
          This writes <code>{name}</code> of <strong>{d.profile}</strong> on the server. Nothing else is changed.
        </span>
        <DiffView before={d.baseText} after={d.text} label="Changes" />
        <span className="ag-note">
          Changes apply to new sessions.{' '}
          <button type="button" className="cb sm" onClick={onRestart}>
            Restart this agent’s gateway…
          </button>
        </span>
        <div className="ag-bar" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="cb" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="cb pri" onClick={onSave} disabled={saving}>
            <Icon name="save" size={12} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** The file changed on the server after the editor loaded it (F-CFG-13). Nothing is overwritten silently. */
export function ConflictDialog({ d, kind, onClose }: { d: Draft; kind: AgentFileKind; onClose: () => void }) {
  const patch = useAgentCfg((s) => s.patchDraft)
  const [confirmMine, setConfirmMine] = useState(false)
  const theirs = d.conflict ?? d.serverChanged
  if (!theirs) return null
  const apply = (fn: (x: Draft) => Draft): void => {
    patch(d.profile, kind, fn)
    onClose()
  }
  return (
    <Modal title={`${FILE_LABEL[kind]} changed on the server`} onClose={onClose} width={720}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span>
          The agent (or someone else) changed this file while you were editing. Nothing was saved. {theirs.exists ? '' : 'The file was deleted.'}
        </span>
        <div className="ag-split">
          <DiffView before={d.baseText} after={theirs.text} label="On the server since you opened it" />
          <DiffView before={d.baseText} after={d.text} label="Your edits" />
        </div>
        {confirmMine && (
          <div className="cv-banner warn" role="alert">
            <Icon name="alert" size={13} /> Your text will replace the server’s version when you save. You will see that diff first.
          </div>
        )}
        <div className="ag-bar" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="cb" onClick={onClose}>
            Decide later
          </button>
          <button type="button" className="cb" onClick={() => apply(takeTheirs)}>
            Take theirs
          </button>
          <button type="button" className="cb" onClick={() => apply(mergeTheirs)}>
            Merge
          </button>
          {confirmMine ? (
            <button type="button" className="cb dng" onClick={() => apply(keepMine)}>
              Yes, keep mine
            </button>
          ) : (
            <button type="button" className="cb dng" onClick={() => setConfirmMine(true)}>
              Keep mine
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** F-CFG-9: restarts only this agent's gateway, after a confirmation. */
export function RestartDialog({ profile, onClose }: { profile: string; onClose: () => void }) {
  const [state, setState] = useState<{ s: 'ask' | 'busy' } | { s: 'done'; ok: boolean; text: string }>({ s: 'ask' })
  const go = async (): Promise<void> => {
    setState({ s: 'busy' })
    const r = await window.mc.agentCfg.restartGateway(profile)
    setState({ s: 'done', ok: r.ok, text: r.ok ? r.output || 'The gateway was restarted.' : r.detail })
  }
  return (
    <Modal title="Restart gateway" onClose={onClose} width={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span>
          Restarts the Hermes gateway of <strong>{profile}</strong> only (<code>hermes {profile === 'default' ? '' : `-p ${profile} `}gateway restart</code>). Running conversations on its platforms are interrupted for a moment.
        </span>
        {state.s === 'done' && (
          <div className={`cv-banner ${state.ok ? '' : 'bad'}`} role="status">
            <Icon name={state.ok ? 'check' : 'alert'} size={13} /> {state.text}
          </div>
        )}
        <div className="ag-bar" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="cb" onClick={onClose}>
            {state.s === 'done' ? 'Close' : 'Cancel'}
          </button>
          {state.s !== 'done' && (
            <button type="button" className="cb pri" onClick={() => void go()} disabled={state.s === 'busy'}>
              {state.s === 'busy' ? 'Restarting…' : 'Restart'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
