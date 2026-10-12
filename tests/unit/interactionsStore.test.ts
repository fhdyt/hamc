import { beforeEach, describe, expect, it } from 'vitest'
import type { InteractionsData } from '../../src/shared/events'
import { useInteractions } from '../../src/renderer/stores/interactions'

const ok = { state: 'ok', unresolved: 0 } as const
const mk = (ids: string[], rooms: string[] = []): InteractionsData => ({
  since: 0,
  edges: ids.map((id) => ({ id, kind: 'message' as const, from: 'a', to: 'b', count: 1, firstTs: 1, lastTs: 2, label: 'msg', status: null })),
  rooms: rooms.map((id) => ({ id, name: id, members: ['a'], lastTs: 1 })),
  subagents: [],
  sources: { kanban: ok, message: ok, room: ok, delegate: ok }
})
beforeEach(() => useInteractions.getState().reset())

describe('useInteractions', () => {
  it('starts empty and stores a snapshot', () => {
    expect(useInteractions.getState().data).toBeNull()
    useInteractions.getState().apply(mk(['e1']), 5)
    expect(useInteractions.getState().data?.edges).toHaveLength(1)
    expect(useInteractions.getState().receivedAt).toBe(5)
  })

  it('clears the selection when the selected edge or room disappears', () => {
    const s = useInteractions.getState()
    s.apply(mk(['e1', 'e2'], ['room:x']))
    s.select({ type: 'edge', id: 'e2' })
    s.apply(mk(['e1'], ['room:x']))
    expect(useInteractions.getState().selected).toBeNull()
    s.select({ type: 'node', id: 'room:x' })
    s.apply(mk(['e1'], ['room:x']))
    expect(useInteractions.getState().selected).toEqual({ type: 'node', id: 'room:x' })
    s.apply(mk(['e1'], []))
    expect(useInteractions.getState().selected).toBeNull()
  })

  it('keeps an agent selected whatever the snapshot says', () => {
    const s = useInteractions.getState()
    s.select({ type: 'node', id: 'scout' })
    s.apply(mk([]))
    expect(useInteractions.getState().selected).toEqual({ type: 'node', id: 'scout' })
  })

  it('reset empties everything', () => {
    useInteractions.getState().apply(mk(['e1']))
    useInteractions.getState().reset()
    expect(useInteractions.getState()).toMatchObject({ data: null, selected: null, receivedAt: null })
  })
})
