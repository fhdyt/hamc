import { describe, expect, it } from 'vitest'
import { DEFAULT_OPTIONS, backlinksOf, densityScale, buildGraph, fileId, ghostId, isEmptyQuery, matchesQuery, neighbours, nodeRadius, parseQuery, tagId, type GraphOptions } from '../../src/renderer/lib/brain/graphModel'
import { sampleBrain, sampleNote } from '../helpers/samples'

const notes = sampleBrain().notes
const opts = (o: Partial<GraphOptions> = {}): GraphOptions => ({ ...DEFAULT_OPTIONS, ...o })
const ids = (g: ReturnType<typeof buildGraph>): string[] => g.nodes.map((n) => n.id).sort()

describe('parseQuery and matchesQuery', () => {
  it('splits tag:, path: and plain words', () => {
    expect(parseQuery('  tag:#Work path:Folder hello  World ')).toEqual({ tags: ['work'], paths: ['folder'], words: ['hello', 'world'], files: [] })
    expect(isEmptyQuery(parseQuery('   '))).toBe(true)
    expect(isEmptyQuery(parseQuery('tag:'))).toBe(true)
  })

  it('understands file: with a name part and with a regular expression, keeping its case', () => {
    const q = parseQuery('file:Plan file:/^\\d{4}-/')
    expect(q.files[0]).toBe('plan')
    expect(q.files[1]).toBeInstanceOf(RegExp)
    expect(matchesQuery(sampleNote({ id: 'x/2026-note.md', title: '2026-note' }), q)).toBe(false) // needs "plan" too
    expect(matchesQuery(sampleNote({ id: 'x/2026-plan.md', title: '2026-plan' }), q)).toBe(true)
    expect(matchesQuery(sampleNote({ id: 'x/Plan.md', title: 'Plan' }), q)).toBe(false)
    expect(parseQuery('file:/(/').files).toEqual([]) // a broken expression is ignored
    expect(matchesQuery(sampleNote({ id: 'a/A1.md', title: 'A1' }), parseQuery('file:/^a\\d/'))).toBe(true) // regex matches ignore case
  })

  it('needs every part to match, tags also match their children, aliases count as words', () => {
    const n = sampleNote({ id: 'folder/Plan.md', title: 'Plan', tags: ['project/x'], aliases: ['Roadmap'] })
    expect(matchesQuery(n, parseQuery('tag:project'))).toBe(true)
    expect(matchesQuery(n, parseQuery('tag:project/x path:folder plan'))).toBe(true)
    expect(matchesQuery(n, parseQuery('tag:proj'))).toBe(false)
    expect(matchesQuery(n, parseQuery('roadmap'))).toBe(true)
    expect(matchesQuery(n, parseQuery('plan nothing'))).toBe(false)
    expect(matchesQuery(n, parseQuery(''))).toBe(false)
  })
})

describe('buildGraph', () => {
  it('draws notes, links and ghosts by default and counts degrees', () => {
    const g = buildGraph(notes, opts())
    expect(ids(g)).toEqual(['Alpha.md', 'Index.md', 'folder/Gamma.md', ghostId('Missing')].sort())
    const index = g.nodes[g.index.get('Index.md')!]!
    expect(index.degree).toBe(5) // 2 out, 2 in, 1 ghost
    expect(g.nodes[g.index.get(ghostId('Missing'))!]!.kind).toBe('ghost')
    expect(g.edges).toHaveLength(5)
  })

  it('drops ghosts with existingOnly', () => {
    const g = buildGraph(notes, opts({ existingOnly: true }))
    expect(ids(g)).toEqual(['Alpha.md', 'Index.md', 'folder/Gamma.md'])
  })

  it('adds tag and attachment nodes only when asked and shares them between notes', () => {
    const more = [...notes, sampleNote({ id: 'Other.md', title: 'Other', tags: ['home'], links: [] })]
    const g = buildGraph(more, opts({ showTags: true, showAttachments: true, existingOnly: true }))
    expect(g.index.has(tagId('home'))).toBe(true)
    expect(g.nodes[g.index.get(tagId('home'))!]!.degree).toBe(2) // Index and Other
    expect(g.index.has(fileId('pic.png'))).toBe(true)
    expect(g.nodes[g.index.get(tagId('alpha'))!]!.label).toBe('#alpha')
    expect(buildGraph(more, opts()).index.has(tagId('home'))).toBe(false)
  })

  it('removes orphans on request but keeps linked ones', () => {
    const more = [...notes, sampleNote({ id: 'Lonely.md', title: 'Lonely', tags: [], links: [] })]
    expect(buildGraph(more, opts()).index.has('Lonely.md')).toBe(true)
    expect(buildGraph(more, opts({ showOrphans: false })).index.has('Lonely.md')).toBe(false)
    expect(buildGraph(more, opts({ showOrphans: false })).index.has('Index.md')).toBe(true)
  })

  it('searches by name, tag and path and keeps only edges between kept nodes', () => {
    expect(ids(buildGraph(notes, opts({ search: 'alpha', existingOnly: true })))).toEqual(['Alpha.md'])
    expect(ids(buildGraph(notes, opts({ search: 'tag:work', existingOnly: true })))).toEqual(['Alpha.md'])
    expect(ids(buildGraph(notes, opts({ search: 'path:folder', existingOnly: true })))).toEqual(['folder/Gamma.md'])
    const both = buildGraph(notes, opts({ search: 'index', existingOnly: false }))
    expect(ids(both)).toEqual(['Index.md', ghostId('Missing')].sort()) // a match keeps its ghost
    expect(buildGraph(notes, opts({ search: 'zzz' })).nodes).toEqual([])
  })

  it('assigns the first matching group to notes only', () => {
    const groups = [
      { id: 'a', query: 'tag:work', color: '#ff0000' },
      { id: 'b', query: 'path:folder', color: '#00ff00' },
      { id: 'c', query: 'index', color: '#0000ff' }
    ]
    const g = buildGraph(notes, opts({ groups }))
    expect(g.nodes[g.index.get('Alpha.md')!]!.group).toBe(0)
    expect(g.nodes[g.index.get('folder/Gamma.md')!]!.group).toBe(1)
    expect(g.nodes[g.index.get('Index.md')!]!.group).toBe(2)
    expect(g.nodes[g.index.get(ghostId('Missing'))!]!.group).toBe(-1)
  })

  it('cuts a local graph by depth', () => {
    const chain = [
      sampleNote({ id: 'a.md', title: 'a', links: ['b.md'], tags: [] }),
      sampleNote({ id: 'b.md', title: 'b', links: ['c.md'], tags: [] }),
      sampleNote({ id: 'c.md', title: 'c', links: ['d.md'], tags: [] }),
      sampleNote({ id: 'd.md', title: 'd', links: [], tags: [] }),
      sampleNote({ id: 'far.md', title: 'far', links: [], tags: [] })
    ]
    expect(ids(buildGraph(chain, opts({ local: { id: 'b.md', depth: 1 } })))).toEqual(['a.md', 'b.md', 'c.md'])
    expect(ids(buildGraph(chain, opts({ local: { id: 'b.md', depth: 2 } })))).toEqual(['a.md', 'b.md', 'c.md', 'd.md'])
    expect(ids(buildGraph(chain, opts({ local: { id: 'a.md', depth: 3 } })))).toEqual(['a.md', 'b.md', 'c.md', 'd.md'])
    expect(buildGraph(chain, opts({ local: { id: 'gone.md', depth: 2 } })).nodes).toEqual([])
    const g = buildGraph(chain, opts({ local: { id: 'b.md', depth: 1 } }))
    expect(g.edges).toHaveLength(2)
    expect(g.nodes.every((n) => n.degree >= 1)).toBe(true)
  })

  it('ignores self links and links to unknown notes', () => {
    const g = buildGraph([sampleNote({ id: 'x.md', title: 'x', links: ['x.md', 'nowhere.md'], tags: [] })], opts())
    expect(g.edges).toEqual([])
  })

  it('handles an empty vault', () => {
    expect(buildGraph([], opts())).toEqual({ nodes: [], edges: [], index: new Map() })
  })
})

describe('helpers', () => {
  it('finds backlinks sorted by title', () => {
    expect(backlinksOf(notes, 'Index.md').map((n) => n.id)).toEqual(['Alpha.md', 'folder/Gamma.md'])
    expect(backlinksOf(notes, 'Alpha.md').map((n) => n.id)).toEqual(['Index.md'])
    expect(backlinksOf(notes, 'nope.md')).toEqual([])
  })

  it('lists neighbours in both directions', () => {
    const g = buildGraph(notes, opts({ existingOnly: true }))
    const nb = neighbours(g)
    const i = g.index.get('Index.md')!
    expect(nb[i]!.map((x) => g.nodes[x]!.id).sort()).toEqual(['Alpha.md', 'Alpha.md', 'folder/Gamma.md', 'folder/Gamma.md'])
  })

  it('shrinks dots as the vault grows', () => {
    expect(densityScale(10)).toBeGreaterThan(densityScale(1000))
    expect(densityScale(1000)).toBeGreaterThan(densityScale(5000))
    expect(densityScale(1_000_000)).toBe(0.55)
    expect(densityScale(1)).toBeLessThanOrEqual(1.4)
  })

  it('grows the radius with connections up to a cap', () => {
    expect(nodeRadius(0, 1)).toBeLessThan(nodeRadius(4, 1))
    expect(nodeRadius(4, 1)).toBeLessThan(nodeRadius(100, 1))
    expect(nodeRadius(100000, 1)).toBe(24)
    expect(nodeRadius(4, 2)).toBeGreaterThan(nodeRadius(4, 1))
  })
})
