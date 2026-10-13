import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import { EmptyState, Skeleton } from '../../components/States'
import { parsePolicy, suggestionLines } from '../../lib/approvals'
import { maskSecrets } from '../../lib/redact'
import { sortAgents } from '../../lib/roster'
import { loadApprovals } from '../../logsActions'
import { useAgents } from '../../stores/agents'
import { useLogs, type ApprovalsEntry } from '../../stores/logs'

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="cb sm"
      aria-label={label}
      onClick={() =>
        void navigator.clipboard.writeText(maskSecrets(text)).then(() => {
          setDone(true)
          window.setTimeout(() => setDone(false), 1500)
        })
      }
    >
      <Icon name="copy" size={11} /> {done ? 'Copied' : 'Copy'}
    </button>
  )
}

function Card({ name, entry }: { name: string; entry: ApprovalsEntry | undefined }) {
  const policy = useMemo(() => (entry?.status === 'ok' ? parsePolicy(entry.policy) : null), [entry])
  const suggestions = useMemo(() => (entry?.status === 'ok' ? suggestionLines(entry.suggest) : []), [entry])

  return (
    <section className="lg-gw-card" aria-label={`Approvals of ${name}`}>
      <div className="lg-gw-head">
        <h2>{name}</h2>
      </div>
      {(!entry || entry.status === 'loading') && <Skeleton rows={3} />}
      {entry?.status === 'error' && (
        <div className="banner bad" role="alert">
          {entry.message}
        </div>
      )}
      {entry?.status === 'ok' && (
        <>
          {entry.policyError ? (
            <div className="banner" role="status">
              The policy could not be read: {entry.policyError}
            </div>
          ) : (
            policy && (
              <table className="us-table" aria-label={`Policy of ${name}`}>
                <tbody>
                  {policy.entries.map((e) => (
                    <tr key={e.key}>
                      <th scope="row">
                        {e.key}
                        {!e.known && <span className="lg-meta"> (not in the list)</span>}
                      </th>
                      <td>{e.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
          <div className="us-sub">commands that keep being approved (last 30 days)</div>
          {entry.suggestError ? (
            <div className="banner" role="status">
              The suggestions could not be read: {entry.suggestError}
            </div>
          ) : suggestions.length === 0 ? (
            <p className="lg-note">Nothing keeps coming back.</p>
          ) : (
            <ul className="lg-sugg" aria-label={`Suggestions for ${name}`}>
              {suggestions.map((l, i) => (
                <li key={`${i}:${l}`}>
                  <code>{maskSecrets(l)}</code>
                  <CopyButton text={l} label={`Copy command ${i + 1} of ${name}`} />
                </li>
              ))}
            </ul>
          )}
          <details>
            <summary className="lg-note">Raw output</summary>
            <pre className="lg-raw">{maskSecrets(`${entry.policy}${entry.policy && entry.suggest ? '\n\n' : ''}${entry.suggest}`) || '(empty)'}</pre>
          </details>
        </>
      )}
    </section>
  )
}

export function ApprovalsTab() {
  const agents = useAgents((s) => s.agents)
  const approvals = useLogs((s) => s.approvals)
  const sorted = useMemo(() => sortAgents(agents), [agents])
  const key = sorted.map((a) => a.profile).join(',')

  useEffect(() => {
    for (const a of sorted) if (!useLogs.getState().approvals[a.profile]) void loadApprovals(a.profile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (sorted.length === 0) return <EmptyState title="No agents yet" why="Agents appear after the first successful connection." />

  return (
    <div className="lg-ap">
      <div className="banner" role="note">
        Hermes keeps no log of approve and deny decisions, so there is no history here, and it shows no approvals that are waiting: they are answered in the chat or in the messaging app where the agent asked.
      </div>
      {sorted.map((a) => (
        <Card key={a.profile} name={a.displayName} entry={approvals[a.profile]} />
      ))}
      <p className="lg-note">
        Mission Control only reads this. It never changes the approval mode, never uses --yolo and never adds to an allowlist. To change the policy, use a terminal.
      </p>
    </div>
  )
}
