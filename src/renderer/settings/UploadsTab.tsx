import { useCallback, useEffect, useState } from 'react'
import type { UploadsList } from '@shared/events'
import { saveSetting } from '../actions'
import { Icon } from '../components/Icon'
import { EmptyState, ErrorState, Skeleton } from '../components/States'
import { formatBytes } from '../lib/format'
import { useUi } from '../stores/ui'

type View = { state: 'loading' } | { state: 'error'; why: string } | { state: 'ok'; list: UploadsList }

const day = (d: string): string => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d)

/** Files sent from Chat. They stay on the server until you delete them here. */
export function UploadsTab() {
  const dir = useUi((s) => s.settings['chat.uploadDir'])
  const maxMb = useUi((s) => s.settings['chat.maxUploadMb'])
  const [view, setView] = useState<View>({ state: 'loading' })
  const [ask, setAsk] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [limit, setLimit] = useState(String(maxMb))

  const load = useCallback(async () => {
    setView({ state: 'loading' })
    const res = await window.mc.uploads.list()
    setView(res.ok ? { state: 'ok', list: res.data } : { state: 'error', why: res.error === 'not-connected' ? 'Connect to the server to see the uploaded files.' : 'The upload folder could not be read.' })
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const remove = async (path: string): Promise<void> => {
    setAsk(null)
    setProblem(null)
    const res = await window.mc.uploads.remove(path)
    if (!res.ok) setProblem('The file could not be deleted.')
    await load()
  }
  const commitLimit = (): void => {
    const n = Math.round(Number(limit))
    if (Number.isFinite(n) && n >= 1 && n <= 2048) void saveSetting('chat.maxUploadMb', n)
    else setLimit(String(maxMb))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <dl className="kv" style={{ margin: 0 }}>
        <dt>folder</dt>
        <dd>
          <code>{dir}</code> on the server
        </dd>
        <dt>size limit</dt>
        <dd style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label htmlFor="up-limit" className="vh">
            Largest file in MB
          </label>
          <input id="up-limit" type="number" min={1} max={2048} value={limit} onChange={(e) => setLimit(e.target.value)} onBlur={commitLimit} onKeyDown={(e) => e.key === 'Enter' && commitLimit()} style={{ width: 80 }} />
          MB per file
        </dd>
      </dl>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 12 }}>Uploaded files</strong>
        <button type="button" className="ib sm" onClick={() => void load()} aria-label="Refresh uploaded files" title="Refresh">
          <Icon name="refresh" size={13} />
        </button>
      </div>
      {problem && (
        <div className="cv-banner bad" role="alert">
          <Icon name="alert" size={12} /> {problem}
        </div>
      )}
      {view.state === 'loading' && <Skeleton rows={3} />}
      {view.state === 'error' && <ErrorState title="Uploads unavailable" why={view.why} onRetry={() => void load()} />}
      {view.state === 'ok' && !view.list.exists && <EmptyState title="Nothing uploaded yet" why="The folder is created the first time you attach a file in Chat." />}
      {view.state === 'ok' && view.list.exists && view.list.files.length === 0 && <EmptyState title="The upload folder is empty" />}
      {view.state === 'ok' && view.list.files.length > 0 && (
        <ul className="up-list" aria-label="Uploaded files">
          {view.list.files.map((f) => (
            <li key={f.path} className="up-row">
              <span className="up-name" title={f.path}>
                {f.name}
              </span>
              <span className="up-meta">
                {f.agent} · {day(f.date)} · {formatBytes(f.size)}
              </span>
              {ask === f.path ? (
                <span className="up-ask">
                  <button type="button" className="cb dng sm" onClick={() => void remove(f.path)} aria-label={`Confirm delete ${f.name}`}>
                    Delete
                  </button>
                  <button type="button" className="cb sm" onClick={() => setAsk(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="ib sm" onClick={() => setAsk(f.path)} aria-label={`Delete ${f.name}`} title="Delete from the server">
                  <Icon name="trash" size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {view.state === 'ok' && view.list.truncated && <div style={{ color: '#8B95BD', fontSize: 11 }}>Only the newest files are listed.</div>}
    </div>
  )
}
