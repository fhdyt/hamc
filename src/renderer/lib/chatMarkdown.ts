/* Agent replies are markdown written by a model, and models often leave out the blank lines markdown needs: a table
   right under a list item ends up as raw `| a | b |` text, `---` under a line turns that line into a heading, and a
   line after a list joins the last item. `tidyMarkdown` puts those blank lines back (never inside code blocks) so the
   reply reads the way it was meant. Hand-written documents (skills, SOUL.md) are rendered without it. */

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const LIST = /^\s{0,3}(?:[-*+]|\d{1,3}[.)])\s+\S/
const BULLET = /^(\s*)[•●▪◦‣]\s+/
const HR = /^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const HEADING = /^\s{0,3}#{1,6}(?:\s|$)/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_DELIM = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$|^\s*\|\s*:?-{2,}:?\s*\|\s*$/

const blank = (s: string): boolean => s.trim() === ''
const indented = (s: string): boolean => /^(?: {2,}|\t)/.test(s)

export function tidyMarkdown(text: string): string {
  const src = text.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let fence: string | null = null
  let inList = false
  let inTable = false
  const gap = (): void => {
    if (out.length > 0 && !blank(out[out.length - 1]!)) out.push('')
  }
  for (let i = 0; i < src.length; i++) {
    let line = src[i]!
    const f = FENCE.exec(line)
    if (fence !== null) {
      out.push(line)
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length && line.trim() === f[1]) fence = null
      continue
    }
    if (f) {
      gap()
      out.push(line)
      fence = f[1]!
      inList = false
      inTable = false
      continue
    }
    if (blank(line)) {
      out.push(line)
      inList = false
      inTable = false
      continue
    }
    line = line.replace(BULLET, '$1- ')
    const tableStart = !inTable && TABLE_ROW.test(line) && TABLE_DELIM.test(src[i + 1] ?? '')
    if (inTable && !TABLE_ROW.test(line) && !TABLE_DELIM.test(line)) {
      gap()
      inTable = false
    }
    if (tableStart) {
      gap()
      inTable = true
      inList = false
    } else if (!inTable && HR.test(line)) {
      gap()
      inList = false
    } else if (!inTable && HEADING.test(line)) {
      gap()
      inList = false
    } else if (!inTable && LIST.test(line)) {
      if (!inList) gap()
      inList = true
    } else if (inList && !indented(line)) {
      // a plain line after a list starts a new paragraph instead of joining the last item
      gap()
      inList = false
    }
    out.push(line)
    if (!inTable && (HR.test(line) || HEADING.test(line))) {
      // what follows a heading or a rule is its own block
      const next = src[i + 1]
      if (next !== undefined && !blank(next)) out.push('')
    }
  }
  return out.join('\n')
}
