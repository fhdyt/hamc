import { useEffect } from 'react'
import { EmptyState } from '../components/States'
import { loadList, refreshList } from '../sessionsActions'
import { useSessions } from '../stores/sessions'
import { SessionFilters } from './sessions/SessionFilters'
import { SessionList } from './sessions/SessionList'
import { Transcript } from './sessions/Transcript'

const REFRESH_MS = 10_000

export function Sessions() {
  const selected = useSessions((s) => s.selected)

  useEffect(() => {
    void loadList()
    // The first page is re-read quietly while the screen is shown and the window is visible.
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshList()
    }, REFRESH_MS)
    return () => window.clearInterval(t)
  }, [])

  return (
    <div className={`ses${selected ? ' has-sel' : ''}`}>
      <section className="ses-list-col" aria-label="Session list">
        <h1 className="page-title">Sessions</h1>
        <SessionFilters />
        <SessionList />
      </section>
      <section className="ses-detail" aria-label="Session detail">
        {selected ? <Transcript /> : <EmptyState title="Select a session" why="The transcript, thinking steps and tool calls appear here. Search looks inside every message, not just titles." />}
      </section>
    </div>
  )
}
