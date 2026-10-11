import { useEffect, useState } from 'react'
import type { VaultCheck } from '@shared/events'
import { saveVault } from '../../actions'
import { Icon } from '../../components/Icon'
import { describeQueryError } from '../../lib/queryError'
import { BrowseDialog } from './BrowseDialog'

type Check = { status: 'idle' } | { status: 'checking' } | { status: 'done'; check: VaultCheck } | { status: 'error'; message: string }


/** Asks for the vault folder, checks it on the server and saves it for this connection. */
export function VaultSetup({ initial, onDone, onCancel }: { initial: string; onDone(): void; onCancel?: () => void }) {
  const [path, setPath] = useState(initial)
  const [check, setCheck] = useState<Check>({ status: 'idle' })
  const [browsing, setBrowsing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const p = path.trim()
    if (!p) {
      setCheck({ status: 'idle' })
      return
    }
    setCheck({ status: 'checking' })
    let live = true
    const t = window.setTimeout(() => {
      void window.mc.brain.validate(p).then((res) => {
        if (!live) return
        setCheck(res.ok ? { status: 'done', check: res.data } : { status: 'error', message: describeQueryError(res.error, res.detail) })
      })
    }, 450)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [path])

  const ok = check.status === 'done' && check.check.exists && check.check.readable && check.check.notes > 0
  let note: { text: string; bad: boolean } | null = null
  if (check.status === 'checking') note = { text: 'Checking the folder…', bad: false }
  else if (check.status === 'error') note = { text: check.message, bad: true }
  else if (check.status === 'done') {
    const c = check.check
    if (!c.exists) note = { text: 'This folder does not exist on the server.', bad: true }
    else if (!c.readable) note = { text: 'This folder cannot be read by your SSH user.', bad: true }
    else if (c.notes === 0) note = { text: 'No .md files were found in this folder.', bad: true }
    else note = { text: `Found ${c.notes.toLocaleString('en-US')}${c.truncated ? '+' : ''} notes in ${c.path}`, bad: false }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    await saveVault(path.trim())
    setSaving(false)
    onDone()
  }

  return (
    <div className="vs" role="form" aria-label="Vault folder">
      <h2>Where is your vault?</h2>
      <p className="vs-why">Type the folder on the server that holds your Obsidian notes (the folder with the .md files), or browse for it. Mission Control only reads it.</p>
      <label className="vs-label" htmlFor="vault-path">
        Vault folder on the server
      </label>
      <div className="vs-row">
        <input id="vault-path" className="fld" value={path} placeholder="/home/user/vault or ~/Documents/Obsidian Vault" spellCheck={false} onChange={(e) => setPath(e.target.value)} />
        <button type="button" className="cb" onClick={() => setBrowsing(true)}>
          <Icon name="folder" size={12} /> Browse
        </button>
      </div>
      <p className="vs-note" role="status" style={{ color: note?.bad ? '#FF5555' : ok ? '#50FA7B' : '#A9B2D3' }}>
        {note?.text ?? ' '}
      </p>
      <div className="vs-row end">
        {onCancel && (
          <button type="button" className="cb" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="cb pri" disabled={!ok || saving} onClick={() => void save()}>
          Use this vault
        </button>
      </div>
      {browsing && (
        <BrowseDialog
          start={path.trim() && !path.trim().startsWith('~') ? path.trim() : ''}
          onClose={() => setBrowsing(false)}
          onPick={(p) => {
            setPath(p)
            setBrowsing(false)
          }}
        />
      )}
    </div>
  )
}
