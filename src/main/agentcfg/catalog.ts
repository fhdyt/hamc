import { PROFILE_RE } from '@shared/agentCfg'
import { CATALOG_URL, CatalogQueryResult, normaliseManifest, type CatalogResult } from '@shared/modelCatalog'
import type { QueryResult } from '@shared/ipc'

export const CATALOG_TTL_MS = 60 * 60_000
export const CATALOG_MAX_BYTES = 2 * 1024 * 1024
export const CATALOG_TIMEOUT_MS = 10_000

/** Fetches one https URL from this computer (Electron `net.fetch` in the app); answers the body text. */
export type FetchUrl = (url: string, opts: { timeoutMs: number; maxBytes: number }) => Promise<string>

export interface CatalogDeps {
  /** `--query model_catalog` on the server. */
  query: (profile: string) => Promise<QueryResult<CatalogQueryResult>>
  fetchUrl: FetchUrl
  now?: () => number
  log?: (m: string) => void
}

/**
 * v2 model catalog: the manifest Hermes cached on the server (read-only), else the public manifest fetched from this
 * computer and kept for an hour. The server is never asked to fetch anything.
 */
export class CatalogService {
  private publicCache: { at: number; value: Extract<CatalogResult, { ok: true }> } | null = null

  constructor(private readonly d: CatalogDeps) {}

  async get(profile: string): Promise<CatalogResult> {
    if (!PROFILE_RE.test(profile)) return { ok: false, error: 'unavailable', detail: 'Unknown agent.' }
    const r = await this.d.query(profile)
    if (r.ok && r.data.found) return { ok: true, source: 'vps', updatedAt: r.data.updatedAt, providers: r.data.providers }
    return this.publicManifest()
  }

  private async publicManifest(): Promise<CatalogResult> {
    const now = (this.d.now ?? Date.now)()
    if (this.publicCache && now - this.publicCache.at < CATALOG_TTL_MS) return this.publicCache.value
    try {
      const body = await this.d.fetchUrl(CATALOG_URL, { timeoutMs: CATALOG_TIMEOUT_MS, maxBytes: CATALOG_MAX_BYTES })
      const m = normaliseManifest(JSON.parse(body))
      if (!m) return { ok: false, error: 'unavailable', detail: 'The public catalog is not a manifest this app understands.' }
      const value = { ok: true as const, source: 'public' as const, ...m }
      this.publicCache = { at: now, value }
      this.d.log?.('catalog: public manifest fetched')
      return value
    } catch (e) {
      return { ok: false, error: 'unavailable', detail: `No catalog on the server and the public one could not be read (${e instanceof Error ? e.message : String(e)}).` }
    }
  }
}
