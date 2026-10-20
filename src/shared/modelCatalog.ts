import { z } from 'zod'

/** v2: the Hermes model catalog (manifest version 1), as the collector or the public fetch hands it over. */
export const CATALOG_URL = 'https://hermes-agent.nousresearch.com/docs/api/model-catalog.json'

export const CatalogModel = z.object({ id: z.string().min(1).max(200), description: z.string().max(40), default: z.boolean() })
export type CatalogModel = z.infer<typeof CatalogModel>

export const CatalogProviders = z.record(z.string().max(64), z.object({ models: z.array(CatalogModel).max(2000) }))
export type CatalogProviders = z.infer<typeof CatalogProviders>

/** What `--query model_catalog` answers. */
export const CatalogQueryResult = z.union([
  z.object({ found: z.literal(false) }),
  z.object({ found: z.literal(true), mtime: z.number(), updatedAt: z.string().nullable(), providers: CatalogProviders })
])
export type CatalogQueryResult = z.infer<typeof CatalogQueryResult>

export type CatalogResult =
  | { ok: true; source: 'vps' | 'public'; updatedAt: string | null; providers: CatalogProviders }
  | { ok: false; error: 'unavailable'; detail: string }

/** The public manifest, normalised the way the collector normalises the VPS cache; null when it is not a v1 manifest. */
export function normaliseManifest(data: unknown): { updatedAt: string | null; providers: CatalogProviders } | null {
  if (!data || typeof data !== 'object') return null
  const d = data as { version?: unknown; updated_at?: unknown; providers?: unknown }
  if (d.version !== 1 || !d.providers || typeof d.providers !== 'object' || Array.isArray(d.providers)) return null
  const providers: CatalogProviders = {}
  for (const [slug, block] of Object.entries(d.providers as Record<string, unknown>).slice(0, 50)) {
    if (slug.length > 64 || !block || typeof block !== 'object') continue
    const list = (block as { models?: unknown }).models
    const models: CatalogModel[] = []
    for (const m of Array.isArray(list) ? list : []) {
      if (!m || typeof m !== 'object') continue
      const x = m as { id?: unknown; description?: unknown; default?: unknown }
      if (typeof x.id !== 'string' || !x.id || x.id.length > 200) continue
      models.push({ id: x.id, description: typeof x.description === 'string' ? x.description.slice(0, 40) : '', default: x.default === true })
      if (models.length >= 2000) break
    }
    providers[slug] = { models }
  }
  return { updatedAt: typeof d.updated_at === 'string' ? d.updated_at : null, providers }
}
