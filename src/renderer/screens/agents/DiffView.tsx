import { useMemo, useState } from 'react'
import { diffStats, foldDiff, lineDiff } from '@shared/textDiff'

/** A line diff, before → after, with long unchanged runs folded (F-CFG-5/13). */
export function DiffView({ before, after, label }: { before: string; after: string; label: string }) {
  const ops = useMemo(() => lineDiff(before, after), [before, after])
  const [all, setAll] = useState(false)
  const rows = all ? ops : foldDiff(ops, 2)
  const { added, removed } = diffStats(ops)
  return (
    <div>
      <div className="ag-note" style={{ marginBottom: 4 }}>
        {label}: <span className="ag-ok">+{added}</span> <span className="ag-bad">−{removed}</span>
      </div>
      <div className="ag-diff" role="region" aria-label={label}>
        {rows.length === 0 && <div className="same">(empty)</div>}
        {rows.map((r, i) =>
          r.t === 'skip' ? (
            <button key={i} type="button" onClick={() => setAll(true)}>
              Show {r.n} unchanged
            </button>
          ) : (
            <div key={i} className={r.t}>
              {r.t === 'add' ? '+ ' : r.t === 'del' ? '− ' : '  '}
              {r.text || ' '}
            </div>
          )
        )}
      </div>
    </div>
  )
}
