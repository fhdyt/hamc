import { describe, expect, it } from 'vitest'
import { BRAIN_GRAPH_DEFAULTS } from '@shared/settings'
import { effectiveGraph, toGroups, toSettings } from '../../src/renderer/lib/brain/obsidianGraph'

describe('toGroups (F-BRAIN-10)', () => {
  it('turns Obsidian colour groups into read-only groups', () => {
    expect(toGroups([{ query: 'path:Daily', color: { a: 1, rgb: 0xff5555 } }, { query: '  ', color: { a: 1, rgb: 0 } }, { query: 'tag:#work', color: { a: 0.5, rgb: 0x0a0b0c } }])).toEqual([
      { id: 'obs-0', query: 'path:Daily', color: '#ff5555' },
      { id: 'obs-2', query: 'tag:#work', color: '#0a0b0c' }
    ])
    expect(toGroups(undefined)).toEqual([])
  })
})

describe('toSettings', () => {
  it('maps every key onto the app scale', () => {
    expect(
      toSettings({
        showTags: true,
        showAttachments: false,
        hideUnresolved: true,
        showOrphans: false,
        centerStrength: 0.5,
        repelStrength: 10,
        linkStrength: 0.8,
        linkDistance: 265,
        nodeSizeMultiplier: 2,
        lineSizeMultiplier: 1.5,
        textFadeMultiplier: 0
      })
    ).toEqual({
      showTags: true,
      showAttachments: false,
      existingOnly: true,
      showOrphans: false,
      centerForce: 0.5,
      repelForce: 0.5,
      linkForce: 0.8,
      linkDistance: 0.5,
      nodeSize: 2,
      linkWidth: 1.5,
      labelFade: 0.5
    })
  })

  it('clamps values outside the sliders and leaves out missing keys', () => {
    expect(toSettings({ repelStrength: 40, linkDistance: 5, nodeSizeMultiplier: 9, lineSizeMultiplier: 0.01, textFadeMultiplier: -9, centerStrength: 2 })).toEqual({
      repelForce: 1,
      linkDistance: 0,
      nodeSize: 3,
      linkWidth: 0.3,
      labelFade: 0,
      centerForce: 1
    })
    expect(toSettings({})).toEqual({})
  })
})

describe('effectiveGraph', () => {
  const own = { ...BRAIN_GRAPH_DEFAULTS, showTags: false, repelForce: 0.1, groups: [{ id: 'g1', query: 'tag:#a', color: '#000000' }] }
  const obsidian = { colorGroups: [{ query: 'path:folder', color: { a: 1, rgb: 0xff0000 } }], showTags: true, repelStrength: 20 }

  it('follows graph.json when on', () => {
    const e = effectiveGraph(own, obsidian, true)
    expect(e.settings.showTags).toBe(true)
    expect(e.settings.repelForce).toBe(1)
    expect(e.settings.groups).toEqual(own.groups)
    expect(e.obsidianGroups).toEqual([{ id: 'obs-0', query: 'path:folder', color: '#ff0000' }])
    expect(e.followed.sort()).toEqual(['repelForce', 'showTags'])
  })

  it('keeps the app values when off or without graph.json', () => {
    for (const e of [effectiveGraph(own, obsidian, false), effectiveGraph(own, null, true)]) {
      expect(e.settings).toEqual(own)
      expect(e.obsidianGroups).toEqual([])
      expect(e.followed).toEqual([])
    }
  })
})
