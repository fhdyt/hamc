import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import type { SessionRow } from '@shared/events'
import { buildItems, searchItems, type PaletteGroup, type PaletteItem } from '../lib/palette'
import { closePalette, runItem } from '../paletteActions'
import { useAgents } from '../stores/agents'
import { serverAddress, serverName } from '../lib/servers'
import { useBrain } from '../stores/brain'
import { useConn } from '../stores/conn'
import { useGroups } from '../stores/groups'
import { usePalette } from '../stores/palette'
import { useSessions } from '../stores/sessions'
import { Icon } from './Icon'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
const GROUP_LABEL: Record<PaletteGroup, string> = { screen: 'Screens', action: 'Actions', agent: 'Agents', session: 'Sessions', note: 'Notes' }
const hintText = (h: string): string => (isMac ? h.replace('Ctrl+', 'Cmd+') : h)

/** Sessions the palette loaded plus the ones the Sessions screen already has, without duplicates. */
function mergeSessions(a: readonly SessionRow[], b: readonly SessionRow[]): SessionRow[] {
  const seen = new Set<string>()
  const out: SessionRow[] = []
  for (const r of [...a, ...b]) {
    const key = `${r.profile}:${r.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

export function CommandPalette() {
  const open = usePalette((s) => s.open)
  return open ? <PaletteBody /> : null
}

function PaletteBody() {
  const query = usePalette((s) => s.query)
  const index = usePalette((s) => s.index)
  const loaded = usePalette((s) => s.sessions)
  const loading = usePalette((s) => s.loading)
  const error = usePalette((s) => s.error)
  const setQuery = usePalette((s) => s.setQuery)
  const setIndex = usePalette((s) => s.setIndex)
  const agents = useAgents((s) => s.agents)
  const own = useSessions((s) => s.rows)
  const notes = useBrain((s) => s.notes)
  const rooms = useGroups((s) => s.rooms)
  const servers = useConn((s) => s.servers)
  const activeId = useConn((s) => s.saved?.id ?? null)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo(
    () =>
      buildItems({
        agents,
        sessions: mergeSessions(loaded, own),
        notes: Array.from(notes.values(), (n) => ({ id: n.id, title: n.title })),
        rooms,
        servers: servers.map((v) => ({ id: v.id, name: serverName(v), address: serverAddress(v), active: v.id === activeId })),
        now: Date.now() / 1000
      }),
    [agents, loaded, own, notes, rooms, servers, activeId]
  )
  const results = useMemo(() => searchItems(items, query), [items, query])
  const active = Math.min(index, Math.max(results.length - 1, 0))

  // focus comes back to where it was when the palette closes
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    return () => prev?.focus?.()
  }, [])
  useEffect(() => {
    document.getElementById(`pal-opt-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  const run = (item: PaletteItem | undefined): void => {
    if (item) runItem(item)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    const n = results.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (n > 0) setIndex((active + 1) % n)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (n > 0) setIndex((active - 1 + n) % n)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setIndex(Math.max(n - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(results[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closePalette()
    }
  }

  let lastGroup: PaletteGroup | null = null
  return (
    <div className="pal-bk" onMouseDown={(e) => e.target === e.currentTarget && closePalette()}>
      <div className="pal" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="pal-top">
          <Icon name="search" size={14} />
          <label htmlFor="pal-input" className="vh">
            Search screens, agents, sessions and notes
          </label>
          <input
            id="pal-input"
            className="pal-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-autocomplete="list"
            aria-activedescendant={results.length > 0 ? `pal-opt-${active}` : undefined}
            placeholder="Search screens, agents, sessions and notes"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <div ref={listRef} id="pal-list" className="pal-list" role="listbox" aria-label="Results">
          {results.length === 0 && (
            <div className="pal-empty" role="status">
              No results for “{query.trim()}”. Try a screen name, an agent, a session title or a note.
            </div>
          )}
          {results.map((it, i) => {
            const heading = it.group !== lastGroup
            lastGroup = it.group
            return (
              <div key={it.id} role="presentation">
                {heading && (
                  <div className="pal-group" role="presentation">
                    {GROUP_LABEL[it.group]}
                  </div>
                )}
                <div
                  id={`pal-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className="pal-row"
                  onMouseMove={() => i !== active && setIndex(i)}
                  onClick={() => run(it)}
                >
                  <span className="pal-label">{it.label}</span>
                  {it.hint && <span className="pal-hint">{hintText(it.hint)}</span>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="pal-foot" role="status">
          {loading ? 'Loading sessions…' : error ? `Sessions could not be loaded: ${error}` : '↑ ↓ to move · Enter to open · Esc to close'}
        </div>
      </div>
    </div>
  )
}
