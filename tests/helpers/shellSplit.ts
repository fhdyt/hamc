// Minimal POSIX splitter, enough to invert buildCommand (single quotes and backslash escapes).
export function shSplit(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let has = false
  let i = 0
  while (i < cmd.length) {
    const c = cmd[i]!
    if (c === "'") {
      const end = cmd.indexOf("'", i + 1)
      if (end < 0) throw new Error('unterminated quote')
      cur += cmd.slice(i + 1, end)
      has = true
      i = end + 1
    } else if (c === '\\') {
      cur += cmd[i + 1] ?? ''
      has = true
      i += 2
    } else if (/\s/.test(c)) {
      if (has) out.push(cur)
      cur = ''
      has = false
      i++
    } else {
      cur += c
      has = true
      i++
    }
  }
  if (has) out.push(cur)
  return out
}
