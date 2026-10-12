import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withEdit, withFile } from '../../src/renderer/lib/agentCfg'
import { unsavedFor, unsavedKinds, useAgentCfg } from '../../src/renderer/stores/agentCfg'

const file = (text: string) => ({ exists: true, text, hash: `h:${text}`, mtime: 1 })

beforeEach(() => {
  useAgentCfg.setState({ profile: null, tab: 'model', drafts: {}, modelDirty: {}, leave: null })
})

function edit(profile: string, kind: 'soul' | 'memory' | 'user', text: string, dirty = true): void {
  const st = useAgentCfg.getState()
  st.patchDraft(profile, kind, (d) => withFile(d, file('base')))
  if (dirty) st.patchDraft(profile, kind, (d) => withEdit(d, text))
}

describe('unsaved edits', () => {
  it('leaves at once when nothing is unsaved', () => {
    const go = vi.fn()
    edit('atlas', 'soul', 'x', false)
    useAgentCfg.getState().requestLeave('msg', go, 'atlas')
    expect(go).toHaveBeenCalledOnce()
    expect(useAgentCfg.getState().leave).toBeNull()
  })

  it('waits for the answer when an editor is dirty', () => {
    const go = vi.fn()
    edit('atlas', 'memory', 'changed')
    useAgentCfg.getState().requestLeave('You have unsaved changes', go, 'atlas')
    expect(go).not.toHaveBeenCalled()
    expect(useAgentCfg.getState().leave?.message).toBe('You have unsaved changes')
    useAgentCfg.getState().answerLeave(false)
    expect(go).not.toHaveBeenCalled()
    expect(unsavedFor(useAgentCfg.getState(), 'atlas')).toBe(true)
  })

  it('Discard drops that agent’s drafts and goes on; other agents keep theirs', () => {
    const go = vi.fn()
    edit('atlas', 'memory', 'changed')
    edit('scout', 'soul', 'changed too')
    useAgentCfg.getState().requestLeave('msg', go, 'atlas')
    useAgentCfg.getState().answerLeave(true)
    expect(go).toHaveBeenCalledOnce()
    expect(unsavedFor(useAgentCfg.getState(), 'atlas')).toBe(false)
    expect(unsavedFor(useAgentCfg.getState(), 'scout')).toBe(true)
  })

  it('counts unsaved Model choices and names the tabs', () => {
    edit('atlas', 'user', 'x')
    useAgentCfg.getState().setModelDirty('atlas', true)
    expect([...unsavedKinds(useAgentCfg.getState(), 'atlas')].sort()).toEqual(['model', 'user'])
    useAgentCfg.getState().setModelDirty('atlas', false)
    expect([...unsavedKinds(useAgentCfg.getState(), 'atlas')]).toEqual(['user'])
  })

  it('asks for everything when no agent is named', () => {
    const go = vi.fn()
    edit('scout', 'soul', 'x')
    useAgentCfg.getState().requestLeave('msg', go)
    expect(go).not.toHaveBeenCalled()
    useAgentCfg.getState().answerLeave(true)
    expect(go).toHaveBeenCalledOnce()
    expect(unsavedFor(useAgentCfg.getState())).toBe(false)
  })
})
