export type DiffOp = { t: 'same' | 'add' | 'del'; text: string }

/** Beyond this many cells the middle of two texts is shown as replaced instead of being compared line by line. */
const MAX_CELLS = 4_000_000

const lines = (s: string): string[] => (s === '' ? [] : s.split('\n'))

/** Line diff (longest common subsequence) of two texts. */
export function lineDiff(a: string, b: string): DiffOp[] {
  const x = lines(a)
  const y = lines(b)
  let pre = 0
  while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++
  let suf = 0
  while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++
  const xm = x.slice(pre, x.length - suf)
  const ym = y.slice(pre, y.length - suf)
  const out: DiffOp[] = x.slice(0, pre).map((text) => ({ t: 'same', text }))
  if (xm.length * ym.length > MAX_CELLS) {
    out.push(...xm.map((text): DiffOp => ({ t: 'del', text })), ...ym.map((text): DiffOp => ({ t: 'add', text })))
  } else {
    const n = xm.length
    const m = ym.length
    const w = m + 1
    const t = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        t[i * w + j] = xm[i] === ym[j] ? t[(i + 1) * w + j + 1]! + 1 : Math.max(t[(i + 1) * w + j]!, t[i * w + j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (xm[i] === ym[j]) {
        out.push({ t: 'same', text: xm[i]! })
        i++
        j++
      } else if (t[(i + 1) * w + j]! >= t[i * w + j + 1]!) {
        out.push({ t: 'del', text: xm[i++]! })
      } else {
        out.push({ t: 'add', text: ym[j++]! })
      }
    }
    while (i < n) out.push({ t: 'del', text: xm[i++]! })
    while (j < m) out.push({ t: 'add', text: ym[j++]! })
  }
  out.push(...x.slice(x.length - suf).map((text): DiffOp => ({ t: 'same', text })))
  return out
}

export const diffStats = (ops: readonly DiffOp[]): { added: number; removed: number } => ({
  added: ops.filter((o) => o.t === 'add').length,
  removed: ops.filter((o) => o.t === 'del').length
})

export const isUnchanged = (ops: readonly DiffOp[]): boolean => ops.every((o) => o.t === 'same')

export type DiffRow = DiffOp | { t: 'skip'; n: number }

/** Folds long runs of unchanged lines into one "N unchanged" row, keeping `ctx` lines around each change. */
export function foldDiff(ops: readonly DiffOp[], ctx = 2): DiffRow[] {
  const keep = new Array<boolean>(ops.length).fill(false)
  ops.forEach((o, i) => {
    if (o.t === 'same') return
    for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) keep[k] = true
  })
  const rows: DiffRow[] = []
  let skipped = 0
  ops.forEach((o, i) => {
    if (keep[i]) {
      if (skipped) rows.push({ t: 'skip', n: skipped })
      skipped = 0
      rows.push(o)
    } else {
      skipped++
    }
  })
  if (skipped) rows.push({ t: 'skip', n: skipped })
  return rows
}

interface Hunk {
  /** First base line replaced, and the end (exclusive). */
  start: number
  end: number
  repl: string[]
}

function hunksOf(ops: readonly DiffOp[]): Hunk[] {
  const out: Hunk[] = []
  let base = 0
  let cur: Hunk | null = null
  for (const o of ops) {
    if (o.t === 'same') {
      if (cur) out.push(cur)
      cur = null
      base++
      continue
    }
    cur ??= { start: base, end: base, repl: [] }
    if (o.t === 'del') {
      cur.end++
      base++
    } else {
      cur.repl.push(o.text)
    }
  }
  if (cur) out.push(cur)
  return out
}

export const CONFLICT_MINE = '<<<<<<< mine'
export const CONFLICT_SEP = '======='
export const CONFLICT_THEIRS = '>>>>>>> theirs'

export const hasConflictMarkers = (text: string): boolean => text.split('\n').some((l) => l === CONFLICT_MINE || l === CONFLICT_SEP || l === CONFLICT_THEIRS)

/** Three-way merge by lines. Edits that touch the same lines differently become a marked conflict block. */
export function merge3(base: string, mine: string, theirs: string): { text: string; conflicts: number } {
  if (mine === theirs) return { text: mine, conflicts: 0 }
  if (base === mine) return { text: theirs, conflicts: 0 }
  if (base === theirs) return { text: mine, conflicts: 0 }
  const b = lines(base)
  const tag = (hs: Hunk[], who: 'm' | 't') => hs.map((h) => ({ ...h, who }))
  const all = [...tag(hunksOf(lineDiff(base, mine)), 'm'), ...tag(hunksOf(lineDiff(base, theirs)), 't')].sort((p, q) => p.start - q.start || p.end - q.end)

  const out: string[] = []
  let conflicts = 0
  let pos = 0
  let i = 0
  const apply = (hs: typeof all, from: number, to: number): string[] => {
    const res: string[] = []
    let p = from
    for (const h of hs) {
      res.push(...b.slice(p, h.start), ...h.repl)
      p = h.end
    }
    res.push(...b.slice(p, to))
    return res
  }
  while (i < all.length) {
    const first = all[i]!
    let gs = first.start
    let ge = first.end
    const group = [first]
    i++
    while (i < all.length) {
      const n = all[i]!
      const overlaps = n.start < ge || (n.start === ge && (n.end === n.start || ge === gs || group.some((g) => g.end === g.start && g.start === n.start)))
      if (!overlaps) break
      group.push(n)
      ge = Math.max(ge, n.end)
      gs = Math.min(gs, n.start)
      i++
    }
    out.push(...b.slice(pos, gs))
    pos = ge
    const m = group.filter((g) => g.who === 'm')
    const t = group.filter((g) => g.who === 't')
    if (t.length === 0) out.push(...apply(m, gs, ge))
    else if (m.length === 0) out.push(...apply(t, gs, ge))
    else {
      const mm = apply(m, gs, ge)
      const tt = apply(t, gs, ge)
      if (mm.join('\n') === tt.join('\n')) out.push(...mm)
      else {
        conflicts++
        out.push(CONFLICT_MINE, ...mm, CONFLICT_SEP, ...tt, CONFLICT_THEIRS)
      }
    }
  }
  out.push(...b.slice(pos))
  return { text: out.join('\n'), conflicts }
}
