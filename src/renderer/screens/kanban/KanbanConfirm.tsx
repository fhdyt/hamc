import { useEffect, useRef, useState } from 'react'
import { KANBAN_LIMITS, kanbanCommandPreview, type KanbanActionRequest } from '@shared/kanban'
import { cancelKanbanAsk, confirmKanbanAction } from '../../kanbanActions'
import { useKanban } from '../../stores/kanban'

/** The request as it will run, with the text typed into the confirm (block reason, complete result). */
function withField(req: KanbanActionRequest, field: 'reason' | 'result' | undefined, text: string): KanbanActionRequest {
  const t = text.trim()
  if (!t) return req
  if (field === 'reason' && req.action === 'block') return { ...req, reason: t }
  if (field === 'result' && req.action === 'complete') return { ...req, result: t }
  return req
}

/** F-STATE-3: the question, the exact command, Confirm and Cancel, inside the dialog that asked. */
export function KanbanConfirm() {
  const ask = useKanban((s) => s.ask)
  const pending = useKanban((s) => s.pending)
  const [text, setText] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setText('')
    if (ask) box.current?.querySelector<HTMLElement>('input, button.pri')?.focus()
  }, [ask])
  if (!ask) return null
  const preview = kanbanCommandPreview(withField(ask.req, ask.field, text))
  const max = ask.field === 'reason' ? KANBAN_LIMITS.reason : KANBAN_LIMITS.result
  return (
    <div ref={box} className="kw-confirm" role="alertdialog" aria-label="Confirm" aria-describedby="kw-q">
      <p id="kw-q" className="kw-q">
        {ask.question}
      </p>
      {ask.field && (
        <label className="kw-field">
          <span>{ask.field === 'reason' ? 'Reason (optional, added as a comment)' : 'Result (optional)'}</span>
          <input className="fld" value={text} maxLength={max} onChange={(e) => setText(e.target.value.replace(/[\r\n]/g, ' '))} />
        </label>
      )}
      {preview ? <code className="kw-cmd">{preview}</code> : <p className="kw-bad">This text cannot be sent; check its length.</p>}
      <div className="kw-btns">
        <button type="button" className="cb" onClick={cancelKanbanAsk} disabled={pending}>
          Cancel
        </button>
        <button type="button" className="cb pri" onClick={() => void confirmKanbanAction(text)} disabled={pending || !preview}>
          {pending ? 'Running…' : 'Confirm'}
        </button>
      </div>
    </div>
  )
}

/** The result of the last write. */
export function KanbanNote() {
  const note = useKanban((s) => s.note)
  if (!note) return null
  return (
    <p role="status" className={`kw-note ${note.ok ? 'ok' : 'bad'}`}>
      {note.text}
    </p>
  )
}
