import { useEffect } from 'react'
import { lineDiff } from '@shared/textDiff'
import { Icon } from '../../components/Icon'
import { EmptyState, Skeleton } from '../../components/States'
import { agentColor } from '../../lib/agentColor'
import { ACTOR_COLOR, ledgerDiffFile, mergeLedgers } from '../../lib/skills'
import { formatRunTime } from '../../lib/cronControl'
import { loadChanges, toggleLedgerDiff } from '../../skillsActions'
import { useSkills } from '../../stores/skills'

function Diff({ before, after }: { before: string | null; after: string | null }) {
  const blobs = useSkills((s) => s.blobs)
  const b = before ? blobs[before] : null
  const a = after ? blobs[after] : null
  if ((before && (!b || b.status === 'loading')) || (after && (!a || a.status === 'loading'))) return <span className="sk-why">Loading the stored copies…</span>
  const err = b?.status === 'error' ? b.message : a?.status === 'error' ? a.message : null
  if (err) return <span className="sk-why">{err}</span>
  const ops = lineDiff(b?.status === 'ok' ? b.text : '', a?.status === 'ok' ? a.text : '')
  return (
    <div className="crun-diff sk-diff" role="region" aria-label="Changes" tabIndex={0}>
      {ops.map((o, i) => (
        <div key={i} className={`crun-line ${o.t}`}>
          <span className="crun-sign">{o.t === 'add' ? '+' : o.t === 'del' ? '−' : ' '}</span>
          {o.text}
        </div>
      ))}
    </div>
  )
}

/** Who changed which skill (F-SKILL-6): the curator ledger of the shown agents, and `curator status` for one agent. */
export function ChangesTab({ profiles, names }: { profiles: string[]; names: Record<string, string> }) {
  const ledgers = useSkills((s) => s.ledgers)
  const curator = useSkills((s) => s.curator)
  const openDiff = useSkills((s) => s.openDiff)
  const one = profiles.length === 1 ? profiles[0]! : null
  const key = profiles.join(',')

  useEffect(() => {
    void loadChanges(profiles, profiles.length === 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const lists = profiles.flatMap((p) => {
    const l = ledgers[p]
    return l?.status === 'ok' ? [{ profile: p, entries: l.entries }] : []
  })
  const rows = mergeLedgers(lists)
  const loading = profiles.some((p) => !ledgers[p] || ledgers[p]!.status === 'loading')
  const errors = profiles.flatMap((p) => (ledgers[p]?.status === 'error' ? [`${names[p] ?? p}: ${(ledgers[p] as { message: string }).message}`] : []))
  const status = one ? curator[one] : undefined

  return (
    <div className="sk-changes">
      <section className="sk-curator" aria-label="Curator">
        {!one && <span className="sk-why">Pick one agent to see its curator status.</span>}
        {one && (!status || status.status === 'loading') && <span className="sk-why">Reading curator status…</span>}
        {status?.status === 'error' && <span className="sk-why bad">{status.message}</span>}
        {status?.status === 'ok' && <pre className="sk-curator-text">{status.text.trim() || '(no output)'}</pre>}
        <span className="sk-why sk-src">
          from <code>hermes curator status</code>
        </span>
      </section>
      {errors.map((e) => (
        <div key={e} className="banner bad" role="alert">
          {e}
        </div>
      ))}
      {loading && rows.length === 0 ? (
        <Skeleton rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState title="No skill changes recorded" why="Hermes writes one line to skills/.curator_ledger.jsonl for every skill change by the agent, the curator or you." />
      ) : (
        <section className="sk-ledger" aria-label="Skill changes">
          <table className="us-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Actor</th>
                <th scope="col">Action</th>
                <th scope="col">Skill</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const id = `${e.profile}:${e.id}`
                const f = ledgerDiffFile(e)
                const open = openDiff === id
                const tone = ACTOR_COLOR[e.actor] ?? '#A9B2D3'
                return (
                  <tr key={id}>
                    <td className="sk-when">{formatRunTime(e.ts)}</td>
                    <td>
                      <span className="tag" style={{ color: tone, borderColor: tone }}>
                        {e.actor}
                      </span>
                    </td>
                    <td>{e.action}</td>
                    <td>
                      <span style={{ color: agentColor(e.profile) }}>{names[e.profile] ?? e.profile}</span> {e.skill}
                    </td>
                    <td>
                      <div className="sk-notecell">
                        <span>
                          {e.note ?? ''}
                          {f && (
                            <button type="button" className="fchip sk-diffbtn" aria-expanded={open} aria-pressed={open} onClick={() => void toggleLedgerDiff(e.profile, e)}>
                              diff <Icon name="chev-down" size={11} />
                            </button>
                          )}
                        </span>
                        {open && f && <Diff before={f.before} after={f.after} />}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
      <p className="sk-why">
        Read from <code>.curator_ledger.jsonl</code>. “agent” means the agent changed its own skill; Hermes treats that flag as a policy marker, not proof of authorship.
      </p>
    </div>
  )
}
