import { useEffect, useMemo, useState } from 'react'
import { mcpTestArgs, preview, terminalCommands, toolsApplyArgs } from '@shared/agentOps'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/States'
import { applyTools, copyText, discardTools, loadFallback, loadMcp, loadTools, runBackup, testMcp, toggleTool } from '../../agentOpsActions'
import { cellState, parseFallback, parseMcpList, parseToolsList, toolPlatforms } from '../../lib/agentOps'
import { useAgentOps, type OpsEntry } from '../../stores/agentOps'
import { useAgents } from '../../stores/agents'
import { useConn } from '../../stores/conn'
import { useAgentCfg } from '../../stores/agentCfg'
import { useUi } from '../../stores/ui'
import { fillCommand } from '../../terminalActions'

/** F-CFG-26: "Open in the terminal" closes Settings and puts the command on the prompt; the user presses Enter. */
export function TerminalCommand({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false)
  const connected = useConn((s) => s.status.state === 'connected')
  const open = (): void =>
    useAgentCfg.getState().requestLeave('Opening the terminal closes Settings and drops every unsaved change in Agents.', () => {
      useUi.getState().closeSettings()
      fillCommand(command)
    })
  return (
    <div className="ops-term">
      <span className="ops-term-label">{label}</span>
      <pre className="cc-cmd">$ {command}</pre>
      <span className="ops-term-acts">
        <button type="button" className="cb sm" disabled={!connected} title="Puts the command on the prompt; nothing runs until you press Enter" onClick={open}>
          <Icon name="terminal" size={11} /> Open in the terminal
        </button>
        <button
          type="button"
          className="cb sm"
          onClick={() =>
            void copyText(command).then((ok) => {
              setCopied(ok)
              window.setTimeout(() => setCopied(false), 1500)
            })
          }
        >
          <Icon name="copy" size={11} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </span>
    </div>
  )
}

/** F-CFG-19: what changes here affects. */
export function NewSessionsNote() {
  return <p className="ops-note">Changes here apply to new sessions. Restart the agent’s gateway (Model tab or Logs → Gateway) to apply them to chats that are already running.</p>
}

function EntryState({ entry, retry }: { entry: OpsEntry | undefined; retry: () => void }) {
  if (!entry || entry.status === 'loading') return <Skeleton rows={3} />
  if (entry.status === 'error')
    return (
      <div className="banner bad" role="alert">
        {entry.message}
        <button type="button" className="cb sm" onClick={retry}>
          Retry
        </button>
      </div>
    )
  return null
}

export function McpTab({ profile }: { profile: string }) {
  const entry = useAgentOps((s) => s.mcp[profile])
  const tests = useAgentOps((s) => s.mcpTest)
  const ask = useAgentOps((s) => (s.mcpAsk?.profile === profile ? s.mcpAsk : null))
  const set = useAgentOps((s) => s.set)
  const connected = useConn((s) => s.status.state === 'connected')
  useEffect(() => void loadMcp(profile), [profile])
  const parsed = entry?.status === 'ok' ? parseMcpList(entry.text) : null
  const cmds = terminalCommands(profile)

  return (
    <div className="ops">
      <NewSessionsNote />
      <EntryState entry={entry} retry={() => void loadMcp(profile)} />
      {parsed?.empty && <p className="ops-empty">No MCP servers configured for this agent.</p>}
      {parsed && parsed.rows.length > 0 && (
        <table className="us-table ops-table" aria-label="MCP servers">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Transport</th>
              <th scope="col">Tools</th>
              <th scope="col">Status</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {parsed.rows.map((r) => {
              const t = tests[`${profile}:${r.name}`]
              return (
                <tr key={r.name}>
                  <td className="ops-strong">{r.name}</td>
                  <td className="ops-dim">{r.transport}</td>
                  <td>{r.tools}</td>
                  <td>{r.enabled === null ? '—' : <span style={{ color: r.enabled ? '#50FA7B' : '#8B95BD' }}>{r.enabled ? 'enabled' : 'disabled'}</span>}</td>
                  <td className="ops-actions">
                    <button type="button" className="cb sm" disabled={!connected || t?.status === 'loading'} onClick={() => set({ mcpAsk: { profile, name: r.name } })}>
                      {t?.status === 'loading' ? 'Testing…' : 'Test'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {entry?.status === 'ok' && parsed && !parsed.empty && parsed.rows.length === 0 && <pre className="cron-pre">{entry.text}</pre>}
      {ask && (
        <div className="cc-ask" role="group" aria-label={`Test ${ask.name}?`}>
          <span className="cc-ask-title">Test “{ask.name}”?</span>
          <span className="cc-ask-body">Hermes starts this MCP server once to connect and list its tools, then stops it.</span>
          <pre className="cc-cmd">{preview(mcpTestArgs(profile, ask.name))}</pre>
          <span className="cc-ask-actions">
            <button type="button" className="cb sm" onClick={() => set({ mcpAsk: null })}>
              Cancel
            </button>
            <button type="button" className="cb sm pri" onClick={() => void testMcp()}>
              Test server
            </button>
          </span>
        </div>
      )}
      {parsed?.rows.map((r) => {
        const t = tests[`${profile}:${r.name}`]
        return t && t.status !== 'loading' ? (
          <div key={`t-${r.name}`} className={`banner ${t.status === 'ok' ? 'ok' : 'bad'}`} role={t.status === 'ok' ? 'status' : 'alert'}>
            <span className="cc-note-title">{r.name}</span>
            <pre className="cc-note-text">{t.status === 'ok' ? t.text.trim() : t.message}</pre>
          </div>
        ) : null
      })}
      <p className="ops-note">Only names are shown: config.yaml can hold tokens inline, so Mission Control lists servers through `hermes mcp list` and never reads that file here.</p>
      <TerminalCommand label="Add a server (interactive: discovery and auth happen in the terminal)" command={cmds.mcpAdd} />
      {parsed?.rows[0] && <TerminalCommand label="Remove a server" command={cmds.mcpRemove(parsed.rows[0].name)} />}
    </div>
  )
}

export function ToolsetsTab({ profile }: { profile: string }) {
  const agent = useAgents((s) => s.agents.find((a) => a.profile === profile))
  const platforms = useMemo(() => toolPlatforms(agent?.gateway?.platforms.map((p) => p.name) ?? []), [agent])
  const entries = useAgentOps((s) => s.tools[profile])
  const changes = useAgentOps((s) => s.changes[profile]) ?? []
  const ask = useAgentOps((s) => s.applyAsk === profile)
  const applying = useAgentOps((s) => s.applying === profile)
  const applied = useAgentOps((s) => s.applied[profile])
  const set = useAgentOps((s) => s.set)
  const connected = useConn((s) => s.status.state === 'connected')
  const key = platforms.join(',')
  useEffect(() => void loadTools(profile, platforms), [profile, key]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const map = new Map<string, { label: string; on: Record<string, boolean> }>()
    for (const p of platforms) {
      const e = entries?.[p]
      if (e?.status !== 'ok') continue
      for (const r of parseToolsList(e.text)) {
        const row = map.get(r.key) ?? { label: r.label, on: {} }
        row.on[p] = r.enabled
        map.set(r.key, row)
      }
    }
    return [...map.entries()]
  }, [entries, key]) // eslint-disable-line react-hooks/exhaustive-deps
  const loading = !entries || platforms.some((p) => entries[p]?.status === 'loading')
  const cmds = toolsApplyArgs(profile, changes)

  return (
    <div className="ops">
      <NewSessionsNote />
      {platforms.map((p) => entries?.[p]?.status === 'error' && <EntryState key={p} entry={entries[p]} retry={() => void loadTools(profile, platforms)} />)}
      {loading && rows.length === 0 ? (
        <Skeleton rows={5} />
      ) : (
        <div className="ops-matrix-wrap">
          <table className="us-table ops-matrix" aria-label="Toolsets per platform">
            <thead>
              <tr>
                <th scope="col">Toolset</th>
                {platforms.map((p) => (
                  <th key={p} scope="col">
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([toolset, r]) => (
                <tr key={toolset}>
                  <th scope="row">
                    <span className="ops-strong">{toolset}</span> <span className="ops-dim">{r.label !== toolset ? r.label : ''}</span>
                  </th>
                  {platforms.map((p) => {
                    if (r.on[p] === undefined) return <td key={p} className="ops-dim">—</td>
                    const c = cellState(changes, toolset, p, r.on[p]!)
                    return (
                      <td key={p}>
                        <button
                          type="button"
                          className={`ckb ops-cell${c.held ? ' held' : ''}`}
                          role="checkbox"
                          aria-checked={c.on}
                          aria-label={`${toolset} on ${p}${c.held ? ' (not applied)' : ''}`}
                          disabled={!connected || applying}
                          onClick={() => toggleTool(profile, toolset, p, r.on[p]!)}
                        >
                          {c.on && <Icon name="check" size={12} />}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {changes.length > 0 && (
        <div className="ops-held" role="group" aria-label="Changes not applied">
          <span>
            {changes.length} change{changes.length === 1 ? '' : 's'} not applied yet (orange).
          </span>
          <button type="button" className="cb sm" onClick={() => discardTools(profile)}>
            Discard
          </button>
          <button type="button" className="cb sm pri" disabled={!connected || applying} onClick={() => set({ applyAsk: profile })}>
            {applying ? 'Applying…' : 'Apply…'}
          </button>
        </div>
      )}
      {ask && cmds && (
        <div className="cc-ask" role="group" aria-label="Apply toolset changes?">
          <span className="cc-ask-title">Apply these changes?</span>
          <span className="cc-ask-body">They run one after the other; each result is shown below.</span>
          <pre className="cc-cmd">{cmds.map((c) => preview(c)).join('\n')}</pre>
          <span className="cc-ask-actions">
            <button type="button" className="cb sm" onClick={() => set({ applyAsk: null })}>
              Cancel
            </button>
            <button type="button" className="cb sm pri" onClick={() => void applyTools(profile, platforms)}>
              Apply changes
            </button>
          </span>
        </div>
      )}
      {applied && (
        <div className="ops-results" role="status" aria-label="Apply results">
          {'error' in applied ? (
            <div className="banner bad">{applied.error}</div>
          ) : (
            applied.map((r) => (
              <div key={r.command} className={`banner ${r.ok ? 'ok' : 'bad'}`}>
                <pre className="cc-note-text">
                  {r.command}
                  {'\n'}
                  {r.output}
                </pre>
              </div>
            ))
          )}
        </div>
      )}
      <p className="ops-note">Read with `hermes tools list --platform …` for the CLI, cron and each platform this agent’s gateway serves. The kanban toolset is not turned on by `all`.</p>
    </div>
  )
}

export function FallbackTab({ profile }: { profile: string }) {
  const entry = useAgentOps((s) => s.fallback[profile])
  useEffect(() => void loadFallback(profile), [profile])
  const fb = entry?.status === 'ok' ? parseFallback(entry.text) : null
  const cmds = terminalCommands(profile)
  return (
    <div className="ops">
      <NewSessionsNote />
      <EntryState entry={entry} retry={() => void loadFallback(profile)} />
      {fb && (
        <div className="ops-fallback">
          <dl className="kv">
            <dt>primary</dt>
            <dd>{fb.primary ?? '—'}</dd>
          </dl>
          {fb.empty || fb.chain.length === 0 ? (
            <p className="ops-empty">No fallback providers. When the primary model fails, the turn fails.</p>
          ) : (
            <ol className="ops-chain" aria-label="Fallback chain">
              {fb.chain.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ol>
          )}
          <p className="ops-note">Tried in order when the primary fails (rate limit, server errors, connection errors).</p>
        </div>
      )}
      <TerminalCommand label="Add a fallback (Hermes shows its model picker in the terminal)" command={cmds.fallbackAdd} />
      <TerminalCommand label="Remove a fallback" command={cmds.fallbackRemove} />
    </div>
  )
}

export function BackupTab({ profile }: { profile: string }) {
  const b = useAgentOps((s) => s.backup)
  const set = useAgentOps((s) => s.set)
  const connected = useConn((s) => s.status.state === 'connected')
  const r = b.result
  return (
    <div className="ops">
      <p className="ops-note">
        Downloads this agent’s SOUL.md, memories/, profile.yaml, config.yaml, cron/jobs.json and skills/ over SFTP into a zip on this computer. In config.yaml, values under env: and headers:
        and of keys that look like secrets are blanked before the zip is written. .env, auth.json and mcp-tokens/ are never read. Nothing is written on the server.
      </p>
      <label className="ops-check">
        <input type="checkbox" checked={b.includeStateDb} onChange={(e) => set({ backup: { ...b, includeStateDb: e.target.checked } })} />
        Include state.db (sessions and messages; large, and copied while Hermes may be writing it)
      </label>
      <div>
        <button type="button" className="cb pri" disabled={!connected || b.busy} onClick={() => void runBackup(profile)}>
          <Icon name="download" size={12} /> {b.busy ? 'Backing up…' : 'Back up to a zip…'}
        </button>
      </div>
      {r && 'saved' in r && (
        <div className="banner ok" role="status">
          Saved {r.files} files ({Math.round(r.bytes / 1024).toLocaleString('en-US')} KB) to {r.saved}
          {r.skipped.length > 0 ? `. Skipped: ${r.skipped.join(', ')}` : ''}
        </div>
      )}
      {r && 'failed' in r && (
        <div className="banner bad" role="alert">
          The backup failed: {r.failed}
        </div>
      )}
      <p className="ops-note">Restore by hand, or with `hermes import` in a terminal; put API keys back with `hermes config set` or `hermes setup`.</p>
    </div>
  )
}
