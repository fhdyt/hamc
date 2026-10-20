import { useMemo, type ReactNode } from 'react'
import { BRAIN_GRAPH_DEFAULTS, type BrainGraphSettings } from '@shared/settings'
import { loadObsidianGraph, saveGraphSettings } from '../../actions'
import { Icon } from '../../components/Icon'
import { effectiveGraph } from '../../lib/brain/obsidianGraph'
import { useBrain } from '../../stores/brain'
import { useUi } from '../../stores/ui'

const GROUP_COLORS = ['#FF79C6', '#8BE9FD', '#F1FA8C', '#FFB86C', '#50FA7B', '#FF5555']
const FROM = 'from graph.json'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="bc-sec" open>
      <summary>{title}</summary>
      <div className="bc-body">{children}</div>
    </details>
  )
}

/** A followed control shows the graph.json value and cannot be changed until the switch is off. */
function Toggle({ label, on, locked = false, onChange }: { label: string; on: boolean; locked?: boolean; onChange(v: boolean): void }) {
  return (
    <label className={`bc-toggle${locked ? ' locked' : ''}`} title={locked ? FROM : undefined}>
      <span>
        {label}
        {locked && <span className="bc-from"> · {FROM}</span>}
      </span>
      <input type="checkbox" role="switch" checked={on} disabled={locked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

function Slider({ label, value, min = 0, max = 1, step = 0.01, locked = false, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; locked?: boolean; onChange(v: number): void }) {
  return (
    <label className={`bc-slider${locked ? ' locked' : ''}`} title={locked ? FROM : undefined}>
      <span>
        {label}
        {locked && <span className="bc-from"> · {FROM}</span>}
      </span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} disabled={locked} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

/** F-BRAIN-10: whether the vault's .obsidian/graph.json is followed, and what came of reading it. */
function ObsidianRow({ on, groups }: { on: boolean; groups: number }) {
  const o = useBrain((s) => s.obsidian)
  const vault = useBrain((s) => s.vault)
  if (!vault) return null
  const line =
    o.state === 'ok'
      ? on
        ? `Following graph.json · ${groups} group${groups === 1 ? '' : 's'}`
        : 'graph.json found, not followed'
      : o.state === 'none'
        ? 'No graph.json in this vault'
        : o.state === 'error'
          ? o.error
          : 'Reading graph.json…'
  return (
    <div className="bc-obs">
      <Toggle label="Use .obsidian/graph.json" on={on} onChange={(v) => saveGraphSettings({ useObsidian: v })} />
      <div className="bc-obs-line">
        <span role="status" className={o.state === 'error' ? 'err' : undefined}>
          {line}
        </span>
        <button type="button" className="cb sm" onClick={() => void loadObsidianGraph()}>
          Reload
        </button>
      </div>
    </div>
  )
}

/** Left-hand panel of the Second brain screen: Filters, Groups, Display and Forces, saved in app.db. */
export function Controls() {
  const own = useUi((s) => s.settings['brain.graph'])
  const obsidian = useBrain((s) => s.obsidian)
  const search = useBrain((s) => s.search)
  const setSearch = useBrain((s) => s.setSearch)
  const set = (p: Partial<BrainGraphSettings>): void => saveGraphSettings(p)
  const eff = useMemo(() => effectiveGraph(own, obsidian.state === 'ok' ? obsidian.graph : null, own.useObsidian), [own, obsidian])
  const g = eff.settings
  const locked = (k: keyof BrainGraphSettings): boolean => (eff.followed as string[]).includes(k)

  const addGroup = (): void => {
    if (own.groups.length >= 12) return
    set({ groups: [...own.groups, { id: `g${Date.now().toString(36)}`, query: '', color: GROUP_COLORS[own.groups.length % GROUP_COLORS.length]! }] })
  }
  const editGroup = (id: string, patch: Partial<{ query: string; color: string }>): void => set({ groups: own.groups.map((x) => (x.id === id ? { ...x, ...patch } : x)) })

  return (
    <aside className="bc" aria-label="Graph controls">
      <Section title="Obsidian">
        <ObsidianRow on={own.useObsidian} groups={eff.obsidianGroups.length} />
      </Section>
      <Section title="Filters">
        <label className="vh" htmlFor="brain-search">
          Search notes
        </label>
        <div className="ag-search">
          <Icon name="search" size={12} />
          <input id="brain-search" type="search" placeholder="Search notes" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Toggle label="Tags" on={g.showTags} locked={locked('showTags')} onChange={(v) => set({ showTags: v })} />
        <Toggle label="Attachments" on={g.showAttachments} locked={locked('showAttachments')} onChange={(v) => set({ showAttachments: v })} />
        <Toggle label="Existing files only" on={g.existingOnly} locked={locked('existingOnly')} onChange={(v) => set({ existingOnly: v })} />
        <Toggle label="Orphans" on={g.showOrphans} locked={locked('showOrphans')} onChange={(v) => set({ showOrphans: v })} />
      </Section>
      <Section title="Groups">
        {own.groups.map((x) => (
          <div key={x.id} className="bc-group">
            <input type="color" value={x.color} aria-label="Group colour" onChange={(e) => editGroup(x.id, { color: e.target.value })} />
            <input className="fld" value={x.query} placeholder="path:projects, tag:#work, file:name" aria-label="Group query" onChange={(e) => editGroup(x.id, { query: e.target.value })} />
            <button type="button" className="ib sm" aria-label="Remove group" title="Remove group" onClick={() => set({ groups: own.groups.filter((y) => y.id !== x.id) })}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
        <button type="button" className="cb" disabled={own.groups.length >= 12} onClick={addGroup}>
          <Icon name="plus" size={12} /> New group
        </button>
        {eff.obsidianGroups.length > 0 && (
          <ul className="bc-obs-groups" aria-label="Groups from graph.json">
            {eff.obsidianGroups.map((x) => (
              <li key={x.id}>
                <span className="bc-dot" style={{ background: x.color }} aria-hidden="true" />
                <span className="bc-q">{x.query}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Display">
        <Toggle label="Color by folder" on={g.colorByFolder} onChange={(v) => set({ colorByFolder: v })} />
        <Slider label="Text fade threshold" value={g.labelFade} locked={locked('labelFade')} onChange={(v) => set({ labelFade: v })} />
        <Slider label="Node size" value={g.nodeSize} min={0.3} max={3} step={0.05} locked={locked('nodeSize')} onChange={(v) => set({ nodeSize: v })} />
        <Slider label="Link thickness" value={g.linkWidth} min={0.3} max={4} step={0.05} locked={locked('linkWidth')} onChange={(v) => set({ linkWidth: v })} />
      </Section>
      <Section title="Forces">
        <Slider label="Center force" value={g.centerForce} locked={locked('centerForce')} onChange={(v) => set({ centerForce: v })} />
        <Slider label="Repel force" value={g.repelForce} locked={locked('repelForce')} onChange={(v) => set({ repelForce: v })} />
        <Slider label="Link force" value={g.linkForce} locked={locked('linkForce')} onChange={(v) => set({ linkForce: v })} />
        <Slider label="Link distance" value={g.linkDistance} locked={locked('linkDistance')} onChange={(v) => set({ linkDistance: v })} />
        <button
          type="button"
          className="cb"
          onClick={() => {
            const d = BRAIN_GRAPH_DEFAULTS
            set({ centerForce: d.centerForce, repelForce: d.repelForce, linkForce: d.linkForce, linkDistance: d.linkDistance })
          }}
        >
          Reset forces
        </button>
      </Section>
    </aside>
  )
}
