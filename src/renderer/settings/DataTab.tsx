import { useState } from 'react'
import { clearGroupHistory } from '../groupsActions'
import { useMemoryTimeline } from '../stores/memoryTimeline'

/** The local log of the group chat rooms; the rooms and the agents' room sessions on the server stay. */
function RoomHistory() {
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle')
  const [done, setDone] = useState<string | null>(null)
  const clear = async (): Promise<void> => {
    setStep('busy')
    await clearGroupHistory()
    setDone('Room history cleared.')
    setStep('idle')
  }
  return (
    <>
      <h2 style={{ margin: '12px 0 0', fontSize: 13 }}>Room history</h2>
      <p style={{ margin: 0, color: '#A9B2D3' }}>
        The messages of your group chat rooms are kept in the local database of this computer. Clearing them empties every room; the rooms stay, and so do the agents’ room
        sessions on the server.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {step === 'confirm' ? (
          <>
            <span style={{ color: '#FFB86C' }}>Delete the messages of every room? This cannot be undone.</span>
            <button type="button" className="cb sm" onClick={() => setStep('idle')}>
              Cancel
            </button>
            <button type="button" className="cb sm dng" onClick={() => void clear()}>
              Delete messages
            </button>
          </>
        ) : (
          <button type="button" className="cb sm" disabled={step === 'busy'} onClick={() => (setDone(null), setStep('confirm'))}>
            Clear room history
          </button>
        )}
        {done && (
          <span role="status" style={{ color: '#50FA7B' }}>
            {done}
          </span>
        )}
      </div>
    </>
  )
}

/** Settings → Data: the local memory snapshots (F-MEMT-6) and the room history. Clearing them never touches the VPS. */
export function DataTab() {
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle')
  const [done, setDone] = useState<string | null>(null)

  const clear = async (): Promise<void> => {
    setStep('busy')
    const n = await window.mc.memory.clear()
    useMemoryTimeline.setState({ versions: null, texts: {}, picked: 0 })
    setDone(`Deleted ${n} version${n === 1 ? '' : 's'}.`)
    setStep('idle')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
      <h2 style={{ margin: 0, fontSize: 13 }}>Memory snapshots</h2>
      <p style={{ margin: 0, color: '#A9B2D3' }}>
        Mission Control keeps versions of each agent’s MEMORY.md, USER.md and SOUL.md in its local database (at most 200 per file, 180 days) for the memory timeline in Second
        brain. Clearing them deletes those local copies of this connection; the files on the server stay as they are.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {step === 'confirm' ? (
          <>
            <span style={{ color: '#FFB86C' }}>Delete every saved version? This cannot be undone.</span>
            <button type="button" className="cb sm" onClick={() => setStep('idle')}>
              Cancel
            </button>
            <button type="button" className="cb sm dng" onClick={() => void clear()}>
              Delete versions
            </button>
          </>
        ) : (
          <button type="button" className="cb sm" disabled={step === 'busy'} onClick={() => (setDone(null), setStep('confirm'))}>
            Clear snapshots
          </button>
        )}
        {done && (
          <span role="status" style={{ color: '#50FA7B' }}>
            {done}
          </span>
        )}
      </div>
      <RoomHistory />
    </div>
  )
}
