import { useEffect, useState } from 'react'
import type { BrowseResult } from '@shared/events'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { ErrorState, Skeleton } from '../../components/States'

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: BrowseResult }

const ERRORS: Record<string, string> = {
  not_found: 'This folder does not exist.',
  unreadable: 'This folder cannot be read by your SSH user.',
  timeout: 'The server took too long to answer.',
  'not-connected': 'Not connected to the server.'
}

/** Lists the folders of the server (read-only) so a vault can be picked without typing its path. */
export function BrowseDialog({ start, onPick, onClose }: { start: string; onPick(path: string): void; onClose(): void }) {
  const [path, setPath] = useState(start)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setLoad({ status: 'loading' })
    void window.mc.brain.browse(path).then((res) => {
      if (!live) return
      if (res.ok) setLoad({ status: 'ok', data: res.data })
      else setLoad({ status: 'error', message: ERRORS[res.error] ?? 'Could not list this folder.' })
    })
    return () => {
      live = false
    }
  }, [path, attempt])

  const here = load.status === 'ok' ? load.data : null
  const join = (name: string): string => (here!.path.endsWith('/') || here!.path.endsWith('\\') ? here!.path + name : `${here!.path}${here!.path.includes('\\') ? '\\' : '/'}${name}`)

  return (
    <Modal title="Choose the vault folder" onClose={onClose} width={560}>
      <div className="bd">
        <div className="bd-bar">
          <button type="button" className="ib sm" disabled={!here?.parent} aria-label="Up one folder" title="Up one folder" onClick={() => here?.parent && setPath(here.parent)}>
            <Icon name="arrow-up" size={13} />
          </button>
          <span className="bd-path num" title={here?.path ?? path}>
            {here?.path ?? (path || '~')}
          </span>
        </div>
        {load.status === 'loading' && <Skeleton rows={5} />}
        {load.status === 'error' && <ErrorState title="Could not list the folder" why={load.message} onRetry={() => setAttempt(attempt + 1)} />}
        {here && (
          <div className="bd-list" role="list" aria-label="Folders">
            {here.dirs.length === 0 && <span className="fcount">No sub-folders here.</span>}
            {here.dirs.map((d) => (
              <div key={d.name} role="listitem">
                <button type="button" className="bd-row" onClick={() => setPath(join(d.name))}>
                  <Icon name="folder" size={13} />
                  <span className="nm">{d.name}</span>
                  {d.notes > 0 && <span className="tag">{d.notes} notes</span>}
                </button>
              </div>
            ))}
            {here.truncated && <span className="fcount">Only the first 500 folders are shown.</span>}
          </div>
        )}
        <div className="bd-foot">
          <span className="fcount">Read-only: nothing is created or changed on the server.</span>
          <button type="button" className="cb" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="cb pri" disabled={!here} onClick={() => here && onPick(here.path)}>
            Select this folder
          </button>
        </div>
      </div>
    </Modal>
  )
}
