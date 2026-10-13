/** Keys whose values are secrets wherever they appear in config.yaml. */
const SECRET_KEY = /(api[_-]?key|apikey|token|secret|password|passwd|authorization|bearer|credential|private[_-]?key|access[_-]?key|client[_-]?secret)/i
/** Maps whose every value is blanked (MCP server env and HTTP headers). */
const BLANK_MAPS = new Set(['env', 'headers'])
const KEY_LINE = /^(\s*)(-\s+)?("[^"]*"|'[^']*'|[^\s:#][^:#]*?)\s*:(\s*)(.*)$/

/**
 * Blanks secrets in a config.yaml before it goes into a local backup (F-CFG-23): every value under an `env:` or
 * `headers:` map, and every value of a key that looks like a secret, becomes `""`. Line based, so it also works on
 * YAML this app cannot parse; an inline map (`env: {A: b}`) becomes `{}`. Comments and structure stay.
 */
export function redactConfig(text: string): { text: string; blanked: number } {
  let blanked = 0
  const stack: { indent: number; blank: boolean }[] = []
  const out = text.split(/\r?\n/).map((line): string | null => {
    if (!line.trim() || line.trim().startsWith('#')) return line
    const indent = line.length - line.trimStart().length
    while (stack.length && indent <= stack[stack.length - 1]!.indent) stack.pop()
    const inBlank = stack.some((s) => s.blank)
    const m = KEY_LINE.exec(line)
    if (!m) {
      // a list item or a continuation inside a blanked map
      if (inBlank && /^\s*-\s+\S/.test(line)) {
        blanked++
        return line.replace(/^(\s*-\s+).*$/, '$1""')
      }
      if (inBlank) {
        // a line of a block scalar under a secret key: dropped
        blanked++
        return null
      }
      return line
    }
    const [, lead, dash = '', rawKey, gap, rest] = m as unknown as [string, string, string | undefined, string, string, string]
    const key = rawKey.replace(/^["']|["']$/g, '')
    const value = rest.replace(/\s+#.*$/, '').trim()
    const blankMap = BLANK_MAPS.has(key.toLowerCase())
    if (!value || /^[|>][-+]?\d*$/.test(value) || value.startsWith('&')) {
      stack.push({ indent: indent + dash.length, blank: blankMap || (SECRET_KEY.test(key) && !value.startsWith('&')) })
      return line
    }
    if (blankMap && value.startsWith('{')) {
      blanked++
      return `${lead}${dash}${rawKey}:${gap || ' '}{}`
    }
    if (inBlank || SECRET_KEY.test(key)) {
      blanked++
      return `${lead}${dash}${rawKey}:${gap || ' '}""`
    }
    return line
  })
  return { text: out.filter((l): l is string => l !== null).join('\n'), blanked }
}
