const MASK = '[redacted]'

/** Shapes that are secrets on their own. Hermes already masks secrets in its logs; this is the second layer (F-LOG-4). */
const TOKEN_SHAPES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}/g,
  /\b[a-f0-9]{48,}\b/gi
]

/** `Bearer <token>` and `key=value` / `"key": "value"` for keys that name a secret. */
export function maskSecrets(text: string): string {
  let out = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, `Bearer ${MASK}`)
  out = out.replace(/\b(api[_-]?key|token|secret|password|passwd|authorization)(["']?\s*[:=]\s*["']?)(?!Bearer\b|\[redacted\])([^\s"',;}]{6,})/gi, (_m, key: string, sep: string) => `${key}${sep}${MASK}`)
  for (const re of TOKEN_SHAPES) out = out.replace(re, MASK)
  return out
}
