import type { ReactNode } from 'react'
import { BRAIN_GRAPH_DEFAULTS, type BrainGraphSettings } from '@shared/settings'
import { saveGraphSettings } from '../../actions'
import { Icon } from '../../components/Icon'
import { useBrain } from '../../stores/brain'
import { useUi } from '../../stores/ui'

const GROUP_COLORS = ['#FF79C6', '#8BE9FD', '#F1FA8C', '#FFB86C', '#50FA7B', '#FF5555']

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="bc-sec" open>
      <summary>{title}</summary>
      <div className="bc-body">{children}</div>
    </details>
  )
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange(v: boolean): void }) {
  return (
    <label className="bc-toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

function Slider({ label, value, min = 0, max = 1, step = 0.01, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange(v: number): void }) {
  return (
    <label className="bc-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

/** Left-hand panel of the Second brain screen: Filters, Groups, Display and Forces, saved in app.db. */
export function Controls() {
  const g = useUi((s) => s.settings['brain.graph'])
  const search = useBrain((s) => s.search)
  const setSearch = useBrain((s) => s.setSearch)
  const set = (p: Partial<BrainGraphSettings>): void => saveGraphSettings(p)

  const addGroup = (): void => {
    if (g.groups.length >= 12) return
    set({ groups: [...g.groups, { id: `g${Date.now().toString(36)}`, query: '', color: GROUP_COLORS[g.groups.length % GROUP_COLORS.length]! }] })
  }
  const editGroup = (id: string, patch: Partial<{ query: string; color: string }>): void => set({ groups: g.groups.map((x) => (x.id === id ? { ...x, ...patch } : x)) })

  return (
    <aside className="bc" aria-label="Graph controls">
      <Section title="Filters">
        <label className="vh" htmlFor="brain-search">
          Search notes
        </label>
        <div className="ag-search">
          <Icon name="search" size={12} />
          <input id="brain-search" type="search" placeholder="Search notes" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Toggle label="Tags" on={g.showTags} onChange={(v) => set({ showTags: v })} />
        <Toggle label="Attachments" on={g.showAttachments} onChange={(v) => set({ showAttachments: v })} />
        <Toggle label="Existing files only" on={g.existingOnly} onChange={(v) => set({ existingOnly: v })} />
        <Toggle label="Orphans" on={g.showOrphans} onChange={(v) => set({ showOrphans: v })} />
      </Section>
      <Section title="Groups">
        {g.groups.map((x) => (
          <div key={x.id} className="bc-group">
            <input type="color" value={x.color} aria-label="Group colour" onChange={(e) => editGroup(x.id, { color: e.target.value })} />
            <input className="fld" value={x.query} placeholder="path:projects, tag:#work, file:name" aria-label="Group query" onChange={(e) => editGroup(x.id, { query: e.target.value })} />
            <button type="button" className="ib sm" aria-label="Remove group" title="Remove group" onClick={() => set({ groups: g.groups.filter((y) => y.id !== x.id) })}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
        <button type="button" className="cb" disabled={g.groups.length >= 12} onClick={addGroup}>
          <Icon name="plus" size={12} /> New group
        </button>
      </Section>
      <Section title="Display">
        <Toggle label="Color by folder" on={g.colorByFolder} onChange={(v) => set({ colorByFolder: v })} />
        <Toggle label="Synapses" on={g.arrows} onChange={(v) => set({ arrows: v })} />
        <Slider label="Text fade threshold" value={g.labelFade} onChange={(v) => set({ labelFade: v })} />
        <Slider label="Node size" value={g.nodeSize} min={0.3} max={3} step={0.05} onChange={(v) => set({ nodeSize: v })} />
        <Slider label="Link thickness" value={g.linkWidth} min={0.3} max={4} step={0.05} onChange={(v) => set({ linkWidth: v })} />
      </Section>
      <Section title="Forces">
        <Slider label="Center force" value={g.centerForce} onChange={(v) => set({ centerForce: v })} />
        <Slider label="Repel force" value={g.repelForce} onChange={(v) => set({ repelForce: v })} />
        <Slider label="Link force" value={g.linkForce} onChange={(v) => set({ linkForce: v })} />
        <Slider label="Link distance" value={g.linkDistance} onChange={(v) => set({ linkDistance: v })} />
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
