import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: {} }))

import { EXPORT_MAX_BYTES, safeName, saveExport, type SaveDialog } from '../../src/main/sessions/export'

let dir = ''
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

describe('saveExport', () => {
  it('writes UTF-8 to the path the user picked', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mc-export-'))
    const target = join(dir, 'out.md')
    const pick: SaveDialog = vi.fn(async () => ({ canceled: false, filePath: target }))
    const r = await saveExport({ name: 'Morning briefing', ext: 'md', content: '# Halo ✓' }, null, pick)
    expect(r).toEqual({ saved: target })
    expect(readFileSync(target, 'utf8')).toBe('# Halo ✓')
    expect(vi.mocked(pick).mock.calls[0]![1].defaultPath).toBe('Morning_briefing.md')
  })

  it('does nothing when the dialog is canceled', async () => {
    const pick: SaveDialog = async () => ({ canceled: true, filePath: '' })
    expect(await saveExport({ name: 'x', ext: 'html', content: 'x' }, null, pick)).toEqual({ canceled: true })
  })

  it('refuses a bad extension or a huge export without opening the dialog', async () => {
    const pick = vi.fn() as unknown as SaveDialog
    expect(await saveExport({ name: 'x', ext: 'exe' as never, content: 'x' }, null, pick)).toMatchObject({ failed: expect.any(String) })
    expect(await saveExport({ name: 'x', ext: 'md', content: 'x'.repeat(EXPORT_MAX_BYTES + 1) }, null, pick)).toMatchObject({ failed: expect.any(String) })
    expect(pick).not.toHaveBeenCalled()
  })

  it('sanitizes the suggested name', () => {
    expect(safeName('a/b:c')).toBe('a_b_c')
    expect(safeName('')).toBe('session')
    expect(safeName('x'.repeat(200))).toHaveLength(80)
  })
})
