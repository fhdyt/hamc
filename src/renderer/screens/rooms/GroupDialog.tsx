import { useMemo, useState } from 'react'
import { GROUP_MAX_MEMBERS, GROUP_MIN_MEMBERS, GROUP_NAME_MAX, type GroupRoom } from '@shared/groups'
import { createGroup, updateGroup } from '../../groupsActions'
import { Avatar } from '../../components/Avatar'
import { Modal } from '../../components/Modal'
import { agentColor } from '../../lib/agentColor'
import { sortAgents } from '../../lib/roster'
import { useAgents } from '../../stores/agents'

/** New room, or Edit room (name and agents). Rooms live on this computer; the agents only see their room sessions. */
export function GroupDialog({ room, onClose }: { room: GroupRoom | null; onClose: () => void }) {
  const agents = useAgents((s) => s.agents)
  const list = useMemo(() => sortAgents(agents), [agents])
  const [name, setName] = useState(room?.name ?? '')
  const [members, setMembers] = useState<string[]>(room?.members ?? [])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // agents that are in the room but no longer on the server can still be removed
  const gone = members.filter((p) => !list.some((a) => a.profile === p))
  const countOk = members.length >= GROUP_MIN_MEMBERS && members.length <= GROUP_MAX_MEMBERS
  const ok = name.trim() !== '' && countOk && !busy

  const toggle = (p: string): void => setMembers((m) => (m.includes(p) ? m.filter((x) => x !== p) : [...m, p]))
  const save = async (): Promise<void> => {
    if (!ok) return
    setBusy(true)
    const err = room ? await updateGroup(room.id, { name, members }) : await createGroup(name, members)
    setBusy(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <Modal title={room ? 'Edit room' : 'New room'} onClose={onClose} width={480}>
      <form
        className="gr-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <label className="gr-field">
          <span>Name</span>
          <input value={name} maxLength={GROUP_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Ops, research, launch…" autoFocus />
        </label>
        <fieldset className="gr-field">
          <legend>
            Agents <span className="gr-hint">{members.length} of {GROUP_MIN_MEMBERS} to {GROUP_MAX_MEMBERS}</span>
          </legend>
          <div className="gr-picks">
            {list.map((a) => {
              const on = members.includes(a.profile)
              const full = !on && members.length >= GROUP_MAX_MEMBERS
              return (
                <label key={a.profile} className={`gr-pick ${on ? 'on' : ''}`} title={full ? `A room has at most ${GROUP_MAX_MEMBERS} agents` : a.displayName}>
                  <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(a.profile)} />
                  <Avatar name={a.displayName} profile={a.profile} size={20} />
                  <span style={{ color: agentColor(a.profile) }}>{a.displayName}</span>
                </label>
              )
            })}
            {gone.map((p) => (
              <label key={p} className="gr-pick on gone" title="Not on the server any more">
                <input type="checkbox" checked onChange={() => toggle(p)} />
                <span>{p} (not on the server)</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="gr-hint">The room and its messages stay on this computer. On the server each agent gets its own hidden room session, written only when you send.</p>
        {error && (
          <div className="cv-banner bad" role="alert">
            {error}
          </div>
        )}
        <div className="gr-actions">
          <button type="button" className="cb" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="cb pri" disabled={!ok}>
            {room ? 'Save' : 'Create room'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
