import { useEffect, useState } from 'react'
import { LOOK_NAME_MAX } from '@shared/looks'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { agentColor } from '../../lib/agentColor'
import { saveLookName, saveLookPhoto } from '../../looksActions'
import { useAgents } from '../../stores/agents'
import { useLooks } from '../../stores/looks'

/** Settings → Agents → Profile (F-SHELL-6): a photo and a display name that stay on this computer. */
export function ProfileTab({ profile }: { profile: string }) {
  const agent = useAgents((s) => s.agents.find((a) => a.profile === profile))
  const hermesName = useAgents((s) => s.raw.find((a) => a.profile === profile)?.displayName ?? profile)
  const model = useAgents((s) => s.models[profile])
  const look = useLooks((s) => s.looks[profile])
  const [name, setName] = useState(look?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => setName(look?.name ?? ''), [look?.name])

  const shown = agent?.displayName ?? hermesName
  const commit = async (value: string): Promise<void> => {
    const next = value.trim() ? value : null
    if ((next ?? '') === (look?.name ?? '')) return
    setError(await saveLookName(profile, next))
  }
  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setBusy(true)
    setError(await saveLookPhoto(profile, file))
    setBusy(false)
  }
  const id = `look-name-${profile}`
  const fileId = `look-photo-${profile}`

  return (
    <div className="lk">
      <div className="lk-head">
        <Avatar name={shown} profile={profile} size={72} />
        <div className="lk-who">
          <span className="lk-name" style={{ color: agentColor(profile) }}>
            {shown}
          </span>
          <span className="lk-sub">
            profile {profile}
            {model?.model ? ` · ${model.model}` : ''}
            {model?.provider ? ` · ${model.provider}` : ''}
          </span>
          <span className="lk-actions">
            <input
              id={fileId}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="vh"
              disabled={busy}
              onChange={(e) => {
                void pick(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <label htmlFor={fileId} className="cb sm lk-pick" aria-disabled={busy}>
              <Icon name="camera" size={13} /> {look?.photo ? 'Change photo' : 'Choose photo'}
            </label>
            {look?.photo && (
              <button type="button" className="ib sm" aria-label="Remove photo" title="Remove photo" disabled={busy} onClick={() => void saveLookPhoto(profile, null).then(setError)}>
                <Icon name="trash" size={13} />
              </button>
            )}
          </span>
        </div>
      </div>
      <div className="lk-field">
        <label htmlFor={id}>Display name</label>
        <span className="lk-row">
          <input
            id={id}
            type="text"
            className="fld"
            maxLength={LOOK_NAME_MAX}
            value={name}
            placeholder={hermesName}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void commit(name)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commit(name)
              if (e.key === 'Escape' && name !== (look?.name ?? '')) {
                e.stopPropagation()
                setName(look?.name ?? '')
              }
            }}
          />
          {look?.name && (
            <button
              type="button"
              className="ib sm"
              aria-label="Use the profile name"
              title="Use the profile name"
              onClick={() => {
                setName('')
                void saveLookName(profile, null).then(setError)
              }}
            >
              <Icon name="undo" size={13} />
            </button>
          )}
        </span>
      </div>
      {error && (
        <div className="banner bad" role="alert">
          {error}
        </div>
      )}
      <p className="lk-note">Name and photo stay in this app. The Hermes profile on the VPS keeps its name.</p>
    </div>
  )
}
