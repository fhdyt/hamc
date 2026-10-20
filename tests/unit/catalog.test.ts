import { describe, expect, it, vi } from 'vitest'
import { CatalogService } from '../../src/main/agentcfg/catalog'
import { CATALOG_URL } from '@shared/modelCatalog'
import { catalogModels, sourceLine } from '../../src/renderer/lib/modelCatalog'

const vps = { openrouter: { models: [{ id: 'a/b', description: 'recommended', default: false }, { id: 'z/default', description: 'default', default: true }] } }
const manifest = JSON.stringify({ version: 1, updated_at: '2026-10-02T00:00:00Z', providers: { nous: { models: [{ id: 'x/y', default: true }, { id: 7 }] } } })

describe('CatalogService (v2)', () => {
  it('answers the server cache and never fetches then', async () => {
    const fetchUrl = vi.fn()
    const s = new CatalogService({ query: async () => ({ ok: true, data: { found: true, mtime: 1, updatedAt: '2026-10-01T00:00:00Z', providers: vps } }), fetchUrl })
    expect(await s.get('scout')).toEqual({ ok: true, source: 'vps', updatedAt: '2026-10-01T00:00:00Z', providers: vps })
    expect(fetchUrl).not.toHaveBeenCalled()
  })

  it('falls back to the public manifest, keeps it for an hour and normalises it', async () => {
    let now = 0
    const fetchUrl = vi.fn(async () => manifest)
    const s = new CatalogService({ query: async () => ({ ok: true, data: { found: false } }), fetchUrl, now: () => now })
    const r = await s.get('default')
    expect(r).toEqual({ ok: true, source: 'public', updatedAt: '2026-10-02T00:00:00Z', providers: { nous: { models: [{ id: 'x/y', description: '', default: true }] } } })
    expect(fetchUrl).toHaveBeenCalledWith(CATALOG_URL, expect.objectContaining({ maxBytes: 2 * 1024 * 1024 }))
    now = 30 * 60_000
    await s.get('default')
    expect(fetchUrl).toHaveBeenCalledTimes(1)
    now = 61 * 60_000
    await s.get('default')
    expect(fetchUrl).toHaveBeenCalledTimes(2)
  })

  it('says why when neither source works', async () => {
    const s = new CatalogService({ query: async () => ({ ok: false, error: 'not-connected' }), fetchUrl: async () => Promise.reject(new Error('offline')) })
    expect(await s.get('default')).toMatchObject({ ok: false, error: 'unavailable', detail: expect.stringContaining('offline') })
    const t = new CatalogService({ query: async () => ({ ok: true, data: { found: false } }), fetchUrl: async () => '{"version": 2}' })
    expect(await t.get('default')).toMatchObject({ ok: false, error: 'unavailable' })
    expect(await t.get('../x')).toMatchObject({ ok: false })
  })
})

describe('catalogModels', () => {
  it('puts the default first and keeps the manifest order', () => {
    const r = { ok: true as const, source: 'vps' as const, updatedAt: null, providers: vps }
    expect(catalogModels(r, 'openrouter').map((m) => m.id)).toEqual(['z/default', 'a/b'])
    expect(catalogModels(r, 'anthropic')).toEqual([])
    expect(catalogModels(null, 'openrouter')).toEqual([])
  })

  it('says where the list came from', () => {
    expect(sourceLine({ ok: true, source: 'vps', updatedAt: '2026-10-01T10:00:00Z', providers: {} })).toBe("From the server's Hermes cache · updated 2026-10-01")
    expect(sourceLine({ ok: true, source: 'public', updatedAt: null, providers: {} })).toBe('From hermes-agent.nousresearch.com')
  })
})
