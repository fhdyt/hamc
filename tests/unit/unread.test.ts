import { describe, expect, it } from 'vitest'
import { isViewing, shouldCount, type ViewState } from '../../src/renderer/lib/unread'
import { totalUnread, useUnread } from '../../src/renderer/stores/unread'

const view = (over: Partial<ViewState> = {}): ViewState => ({ route: 'chat', chatCurrent: 'scout', agentSelected: null, visible: true, focused: true, ...over })

describe('isViewing', () => {
  it('is true for the open chat of that agent and for the Dashboard with that agent selected', () => {
    expect(isViewing(view(), 'scout')).toBe(true)
    expect(isViewing(view({ route: 'dashboard', chatCurrent: null, agentSelected: 'scout' }), 'scout')).toBe(true)
  })
  it('is false for another agent or another screen', () => {
    expect(isViewing(view(), 'default')).toBe(false)
    expect(isViewing(view({ route: 'usage' }), 'scout')).toBe(false)
    expect(isViewing(view({ route: 'dashboard', agentSelected: 'default' }), 'scout')).toBe(false)
  })
  it('is false while the window is hidden or not focused', () => {
    expect(isViewing(view({ visible: false }), 'scout')).toBe(false)
    expect(isViewing(view({ focused: false }), 'scout')).toBe(false)
  })
})

describe('shouldCount', () => {
  it('counts a clean end only', () => {
    expect(shouldCount({ kind: 'end', exitCode: 0, stopped: false })).toBe(true)
    expect(shouldCount({ kind: 'end', exitCode: 0, stopped: true })).toBe(false)
    expect(shouldCount({ kind: 'end', exitCode: 1, stopped: false })).toBe(false)
    expect(shouldCount({ kind: 'end', exitCode: null, stopped: false })).toBe(false)
    expect(shouldCount({ kind: 'text' })).toBe(false)
  })
})

describe('useUnread', () => {
  it('adds, clears per agent and sums', () => {
    const s = useUnread.getState()
    s.reset()
    s.add('scout')
    s.add('scout')
    s.add('default')
    expect(useUnread.getState().counts).toEqual({ scout: 2, default: 1 })
    expect(totalUnread(useUnread.getState().counts)).toBe(3)
    s.clear('scout')
    expect(useUnread.getState().counts).toEqual({ default: 1 })
    s.clear('ghost')
    expect(useUnread.getState().counts).toEqual({ default: 1 })
    s.reset()
    expect(useUnread.getState().counts).toEqual({})
  })
})
