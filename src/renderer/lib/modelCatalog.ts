import type { CatalogModel, CatalogResult } from '@shared/modelCatalog'

/** The catalog models of one provider, the silent default first, then in the manifest's order. */
export function catalogModels(c: CatalogResult | null, slug: string): CatalogModel[] {
  if (!c || !c.ok) return []
  const list = c.providers[slug]?.models ?? []
  return [...list.filter((m) => m.default), ...list.filter((m) => !m.default)]
}

/** Where the list came from, for the line under it. */
export function sourceLine(c: Extract<CatalogResult, { ok: true }>): string {
  if (c.source === 'public') return 'From hermes-agent.nousresearch.com'
  const day = c.updatedAt ? /^\d{4}-\d{2}-\d{2}/.exec(c.updatedAt)?.[0] : null
  return `From the server's Hermes cache${day ? ` · updated ${day}` : ''}`
}
