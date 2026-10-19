import { useRef, useState, type KeyboardEvent } from 'react'
import type { GroupMember } from '@shared/groups'
import { sendToGroup, stopGroup } from '../../groupsActions'
import { Icon } from '../../components/Icon'
import { agentColor } from '../../lib/agentColor'
import { insertMention, mentionAt, suggest } from '../../lib/groupView'
import { useGroups } from '../../stores/groups'

/** The room's message box: Enter sends, Shift+Enter adds a line, `@` offers the members. */
export function GroupComposer({ id, name, members, disabled }: { id: string; name: string; members: GroupMember[]; disabled: string | null }) {
  const draft = useGroups((s) => s.drafts[id] ?? '')
  const running = useGroups((s) => !!s.running[id])
  const sending = useGroups((s) => !!s.sending[id])
  const error = useGroups((s) => s.sendError[id] ?? null)
  const setDraft = useGroups((s) => s.setDraft)
  const box = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)
  const [pick, setPick] = useState(0)
  const [closed, setClosed] = useState(false)
  const at = closed ? null : mentionAt(draft, caret)
  const options = at ? suggest(at.query, members) : []
  const listId = `gr-mentions-${id}`
  const canSend = !running && !sending && disabled === null && draft.trim() !== ''

  const send = (): void => {
    if (!canSend) return
    void sendToGroup(id)
    box.current?.focus()
  }
  const put = (handle: string): void => {
    if (!at) return
    const next = insertMention(draft, at, handle)
    setDraft(id, next.text)
    setCaret(next.caret)
    requestAnimationFrame(() => {
      box.current?.focus()
      box.current?.setSelectionRange(next.caret, next.caret)
    })
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (options.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        put(options[Math.min(pick, options.length - 1)]!.handle)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setClosed(true)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <form
      className="cp"
      aria-label={`Message the room ${name}`}
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      {disabled && (
        <div className="cv-banner warn" role="status">
          <Icon name="alert" size={12} /> {disabled}
        </div>
      )}
      {error && (
        <div className="cv-banner bad" role="alert">
          <Icon name="alert" size={12} /> {error}
        </div>
      )}
      {options.length > 0 && (
        <ul className="gr-mentions" id={listId} role="listbox" aria-label="Mention an agent">
          {options.map((o, i) => (
            <li key={o.handle} id={`${listId}-${i}`} role="option" aria-selected={i === Math.min(pick, options.length - 1)} onMouseDown={(e) => (e.preventDefault(), put(o.handle))}>
              {o.label}
            </li>
          ))}
        </ul>
      )}
      <div className="cp-row">
        <label htmlFor={`gmsg-${id}`} className="vh">
          Message the room {name}
        </label>
        <textarea
          id={`gmsg-${id}`}
          ref={box}
          rows={2}
          value={draft}
          placeholder="Message the room · @name to ask one agent"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          {...(options.length > 0 ? { 'aria-activedescendant': `${listId}-${Math.min(pick, options.length - 1)}` } : {})}
          onChange={(e) => {
            setDraft(id, e.target.value)
            setCaret(e.target.selectionStart)
            setPick(0)
            setClosed(false)
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKey}
        />
        {running ? (
          <button type="button" className="cp-stop" onClick={() => void stopGroup(id)} aria-label="Stop the room" title="Stop the room">
            <Icon name="stop" size={15} />
          </button>
        ) : (
          <button type="submit" className="cp-send" disabled={!canSend} aria-label="Send" title="Send (Enter)">
            <Icon name="send" size={16} />
          </button>
        )}
      </div>
      <div className="gr-chips" aria-label="Mention">
        {members.map((m) => (
          <button
            key={m.profile}
            type="button"
            className="gr-chip"
            style={{ color: agentColor(m.profile) }}
            onClick={() => {
              const sep = draft === '' || /\s$/.test(draft) ? '' : ' '
              setDraft(id, `${draft}${sep}@${m.profile} `)
              box.current?.focus()
            }}
            title={`Mention ${m.name}`}
          >
            @{m.profile}
          </button>
        ))}
      </div>
    </form>
  )
}
