import { useEffect, useMemo, type KeyboardEvent } from 'react'
import { diffItems } from '@shared/memory'
import { Icon } from '../../components/Icon'
import { EmptyState, Skeleton } from '../../components/States'
import { agentColor } from '../../lib/agentColor'
import { authorView, fileLabel, FILES, limitOf, versionRows, versionWhen } from '../../lib/memoryTimeline'
import { sortAgents } from '../../lib/roster'
import { copyVersion, loadVersions, pickVersion, restoreVersion } from '../../memoryActions'
import { useAgents } from '../../stores/agents'
import { useMemoryTimeline } from '../../stores/memoryTimeline'

/** F-MEMT-1..6: versions of MEMORY.md, USER.md and SOUL.md kept locally, with what changed in each. */
export function MemoryTimeline() {
  const agents = useAgents((s) => s.agents)
  const roster = useMemo(() => sortAgents(agents), [agents])
  const chosen = useMemoryTimeline((s) => s.profile)
  const file = useMemoryTimeline((s) => s.file)
  const versions = useMemoryTimeline((s) => s.versions)
  const picked = useMemoryTimeline((s) => s.picked)
  const texts = useMemoryTimeline((s) => s.texts)
  const sameOpen = useMemoryTimeline((s) => s.sameOpen)
  const note = useMemoryTimeline((s) => s.note)
  const choose = useMemoryTimeline((s) => s.choose)
  const toggleSame = useMemoryTimeline((s) => s.toggleSame)
  const profile = chosen && roster.some((a) => a.profile === chosen) ? chosen : (roster[0]?.profile ?? null)
  const name = roster.find((a) => a.profile === profile)?.displayName ?? profile ?? ''

  useEffect(() => {
    if (profile) void loadVersions(profile)
  }, [profile, file])

  const list = versions?.status === 'ok' ? versions.list : []
  const rows = useMemo(() => versionRows(list, file), [list, file])
  const sel = list[picked]
  const prev = list[picked + 1]
  const cur = sel ? texts[sel.id] : undefined
  const before = prev ? texts[prev.id] : undefined
  const diff = useMemo(
    () => (cur?.status === 'ok' && (!prev || before?.status === 'ok') ? diffItems(file, before?.status === 'ok' ? before.text : '', cur.text) : null),
    [cur, before, prev, file]
  )
  const limit = limitOf(file)
  const author = sel && profile ? authorView(sel.author, name, agentColor(profile)) : null

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = Math.min(list.length - 1, Math.max(0, picked + (e.key === 'ArrowDown' ? 1 : -1)))
    void pickVersion(next)
    document.getElementById(`mt-v-${next}`)?.focus()
  }

  if (!profile) return <EmptyState title="No agents yet" why="Versions appear once Mission Control is connected and sees an agent." />

  return (
    <div className="mt">
      <div className="mt-bar">
        <div role="group" aria-label="Agent" className="ses-chips">
          {roster.map((a) => (
            <button key={a.profile} type="button" className="fchip mt-chip" aria-pressed={a.profile === profile} onClick={() => choose({ profile: a.profile })}>
              <span className="dot" style={{ background: agentColor(a.profile) }} aria-hidden="true" />
              {a.displayName}
            </button>
          ))}
        </div>
        <div role="group" aria-label="File" className="ses-chips">
          {FILES.map((f) => (
            <button key={f.id} type="button" className="fchip mt-chip" aria-pressed={f.id === file} onClick={() => choose({ file: f.id })}>
              {f.label}
            </button>
          ))}
        </div>
        <span className="mt-src">snapshots kept locally in app.db · nothing is written to the VPS</span>
      </div>
      <div className="mt-main">
        <section className="mt-versions" aria-label="Versions">
          {(!versions || versions.status === 'loading') && <Skeleton rows={6} />}
          {versions?.status === 'ok' && list.length === 0 && (
            <EmptyState title="No versions yet" why={`Mission Control keeps a version of ${fileLabel(file)} each time it changes while connected. ${name} has none yet.`} />
          )}
          {list.length > 0 && (
            <div role="listbox" aria-label="Versions" className="mt-list" onKeyDown={onKey}>
              {rows.map((r) => {
                const a = authorView(r.v.author, name, agentColor(profile))
                const on = r.index === picked
                return (
                  <div key={r.v.id}>
                    {r.newDay && <div className="mt-day">{r.day}</div>}
                    <button id={`mt-v-${r.index}`} type="button" role="option" aria-selected={on} tabIndex={on ? 0 : -1} className="mt-row" onClick={() => void pickVersion(r.index)}>
                      <span className="mt-row1">
                        <span className="dot" style={{ background: a.color }} aria-hidden="true" />
                        <span className="mt-time">{r.time}</span>
                        <span style={{ color: a.color }}>{a.label}</span>
                        <span className="mt-tag">{r.index === 0 ? 'current' : ''}</span>
                      </span>
                      <span className="mt-row2">
                        <span className="mt-add">+{r.v.added}</span>
                        <span className="mt-del">−{r.v.removed}</span>
                        <span className="mt-chars">
                          {r.v.chars.toLocaleString('en-US')} / {limit ? limit.toLocaleString('en-US') : 'no limit'}
                        </span>
                        {r.pct !== null && (
                          <span className="mt-bar-track" aria-hidden="true">
                            <span style={{ width: `${r.pct}%`, background: r.pct >= 90 ? '#FFB86C' : '#50FA7B' }} />
                          </span>
                        )}
                      </span>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>
        <section className="mt-changes" aria-label="What changed">
          {sel && author ? (
            <>
              <div className="mt-head">
                <div className="mt-title">
                  <span className="mt-name">
                    {fileLabel(file)} · {versionWhen(sel.takenAt)}
                  </span>
                  <span style={{ color: author.color }}>{author.label}</span>
                </div>
                <span className="mt-how">
                  {author.how} · version {list.length - picked} of {list.length}
                  {sel.sessionId ? ` · session ${sel.sessionId}` : ''}
                </span>
                <div className="mt-actions">
                  <button type="button" className="cb sm" disabled={cur?.status !== 'ok'} onClick={() => void restoreVersion(profile)}>
                    <Icon name="undo" size={12} />
                    Restore in the editor
                  </button>
                  <button type="button" className="cb sm" disabled={cur?.status !== 'ok'} onClick={() => void copyVersion()}>
                    <Icon name="copy" size={12} />
                    Copy this version
                  </button>
                  {note && (
                    <span className="mt-note" role="status">
                      {note}
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-body">
                {(cur?.status === 'loading' || (prev && before?.status === 'loading')) && <Skeleton rows={4} />}
                {cur?.status === 'error' && (
                  <div className="banner bad" role="alert">
                    {cur.message}
                  </div>
                )}
                {diff && (
                  <>
                    {diff.rows.length === 0 && prev && <span className="mt-how">Nothing changed in the entries (only spacing).</span>}
                    {(prev ? diff.rows : diff.rows.filter((r) => r.t === 'add')).map((r, i) => (
                      <div key={`${r.t}${i}`} className={`mt-line ${prev ? r.t : 'same'}`}>
                        <span className="mt-sign" aria-label={prev ? (r.t === 'add' ? 'added' : 'removed') : undefined}>
                          {prev ? (r.t === 'add' ? '+' : '−') : ' '}
                        </span>
                        <span className="mt-text">{r.text}</span>
                      </div>
                    ))}
                    {prev && diff.same.length > 0 && (
                      <button type="button" className="fchip mt-same" aria-expanded={sameOpen} onClick={toggleSame}>
                        {sameOpen ? 'Hide' : 'Show'} {diff.same.length} unchanged {diff.same.length === 1 ? (file === 'soul' ? 'line' : 'entry') : file === 'soul' ? 'lines' : 'entries'}
                      </button>
                    )}
                    {prev && sameOpen && diff.same.map((t, i) => (
                      <div key={`s${i}`} className="mt-line same mt-dim">
                        <span className="mt-sign"> </span>
                        <span className="mt-text">{t}</span>
                      </div>
                    ))}
                    {!prev && <span className="mt-how">First snapshot of this file. Later versions show what changed against it.</span>}
                  </>
                )}
              </div>
            </>
          ) : (
            <EmptyState title="Pick a version" why="What changed against the version before appears here." />
          )}
        </section>
      </div>
      <p className="mt-foot">
        One version per change, checked about every 30 s while Mission Control is connected. Changes made while it was closed arrive as a single “while away” version. Authorship is a best guess from session activity at that moment.
      </p>
    </div>
  )
}
