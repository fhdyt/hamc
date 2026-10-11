import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { dropFiles, pickFiles, removeFile, sendMessage, stopTurn } from '../../chatActions'
import { Icon } from '../../components/Icon'
import { formatBytes } from '../../lib/format'
import { emptyRoom, isBusy, useChat, type AttFile } from '../../stores/chat'

const EMPTY = emptyRoom()

const stateText = (f: AttFile): { text: string; color: string } => {
  if (f.problem) return { text: f.problem, color: '#FF5555' }
  switch (f.state) {
    case 'uploading':
      return { text: `uploading ${f.size ? Math.round((f.sent / f.size) * 100) : 0}%`, color: '#FFB86C' }
    case 'done':
      return { text: 'uploaded', color: '#50FA7B' }
    case 'error':
      return { text: f.error ?? 'upload failed', color: '#FF5555' }
    case 'cancelled':
      return { text: 'cancelled', color: '#8B95BD' }
    default:
      return { text: 'ready · uploads when you send', color: '#A9B2D3' }
  }
}

function FileCard({ profile, f }: { profile: string; f: AttFile }) {
  const st = stateText(f)
  const pct = f.state === 'done' ? 100 : f.size ? Math.min(100, Math.round((f.sent / f.size) * 100)) : 0
  return (
    <div className="cp-file" style={{ borderColor: f.problem || f.state === 'error' ? '#FF5555' : '#BD93F9' }}>
      {f.thumb ? <img src={f.thumb} alt="" className="cp-thumb" /> : <Icon name="file-text" size={16} />}
      <div className="cp-file-body">
        <span className="cp-file-name" title={f.name}>
          {f.name} <span style={{ color: '#A9B2D3' }}>· {formatBytes(f.size)}</span>
        </span>
        <div className="cp-bar" role="progressbar" aria-label={`Upload of ${f.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div style={{ width: `${pct}%`, background: f.state === 'error' || f.problem ? '#FF5555' : f.state === 'done' ? '#50FA7B' : '#BD93F9' }} />
        </div>
        <span style={{ color: st.color, fontSize: 11 }}>{st.text}</span>
      </div>
      <button type="button" className="ib sm" onClick={() => void removeFile(profile, f.id)} aria-label={f.state === 'uploading' ? `Cancel upload of ${f.name}` : `Remove ${f.name}`} title={f.state === 'uploading' ? 'Cancel' : 'Remove'}>
        <Icon name="x" size={13} />
      </button>
    </div>
  )
}

/** The message box with attachments: Enter sends, Shift+Enter adds a line, files can be picked or dropped. */
export function Composer({ profile, name }: { profile: string; name: string }) {
  const room = useChat((s) => s.rooms[profile]) ?? EMPTY
  const patch = useChat((s) => s.patch)
  const busy = isBusy(room)
  const running = room.turn !== null && !room.turn.ended
  const [over, setOver] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const canSend = !busy && room.draft.trim() !== ''

  const send = (): void => {
    if (!canSend) return
    void sendMessage(profile, room.draft.trim())
    box.current?.focus()
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }
  const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files')
  const onDrop = (e: DragEvent): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setOver(false)
    void dropFiles(profile, Array.from(e.dataTransfer.files))
  }

  return (
    <form
      className={`cp ${over ? 'over' : ''}`}
      aria-label={`Message ${name}`}
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {room.backendWarning && room.files.length > 0 && (
        <div className="cv-banner warn" role="status">
          <Icon name="alert" size={12} /> {room.backendWarning}
        </div>
      )}
      {room.sendError && (
        <div className="cv-banner bad" role="alert">
          <Icon name="alert" size={12} /> {room.sendError}
        </div>
      )}
      {room.files.length > 0 && (
        <div className="cp-files">
          {room.files.map((f) => (
            <FileCard key={f.id} profile={profile} f={f} />
          ))}
        </div>
      )}
      <div className="cp-row">
        <button type="button" className="ib cp-attach" onClick={() => void pickFiles(profile)} aria-label="Attach files" title="Attach files (or drop them here)" disabled={busy}>
          <Icon name="paperclip" size={16} />
        </button>
        <label htmlFor={`msg-${profile}`} className="vh">
          Message {name}
        </label>
        <textarea
          id={`msg-${profile}`}
          ref={box}
          rows={2}
          value={room.draft}
          placeholder={over ? 'Drop files to attach them' : 'Ask or assign a task'}
          onChange={(e) => patch(profile, () => ({ draft: e.target.value }))}
          onKeyDown={onKey}
        />
        {running ? (
          <button type="button" className="cp-stop" onClick={() => void stopTurn(profile)} aria-label="Stop" title="Stop the agent">
            <Icon name="stop" size={15} />
          </button>
        ) : (
          <button type="submit" className="cp-send" disabled={!canSend} aria-label="Send" title="Send (Enter)">
            <Icon name="send" size={16} />
          </button>
        )}
      </div>
    </form>
  )
}
