import { useEffect, useState } from 'react'
import { joinEntries, splitEntries } from '@shared/agentCfg'
import { Icon } from '../../components/Icon'

/**
 * MEMORY.md and USER.md hold entries separated by a line with only §. Each entry is a card that can be edited,
 * moved and deleted; the text of the whole file is what the parent keeps. A card that is still empty only
 * exists here until something is typed (an empty entry would not survive the file).
 */
export function EntriesEditor({ text, onChange, label }: { text: string; onChange: (t: string) => void; label: string }) {
  const [cards, setCards] = useState<string[]>(() => splitEntries(text))

  // The text changed from outside (load, merge, revert): follow it. Typing in a card changes both and is not an outside change.
  useEffect(() => {
    setCards((cur) => (joinEntries(cur) === joinEntries(splitEntries(text)) ? cur : splitEntries(text)))
  }, [text])

  const set = (next: string[]): void => {
    setCards(next)
    onChange(joinEntries(next))
  }
  const move = (i: number, by: -1 | 1): void => {
    const j = i + by
    if (j < 0 || j >= cards.length) return
    const next = [...cards]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    set(next)
  }

  return (
    <div className="ag-entries" role="list" aria-label={label}>
      {cards.length === 0 && <span className="ag-note">No entries yet.</span>}
      {cards.map((c, i) => (
        <div key={i} className="ag-entry" role="listitem">
          <textarea
            className="ag-text"
            rows={Math.min(8, Math.max(2, c.split('\n').length))}
            value={c}
            aria-label={`Entry ${i + 1}`}
            onChange={(e) => set(cards.map((x, k) => (k === i ? e.target.value : x)))}
          />
          <span className="side">
            <button type="button" className="ib sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move entry ${i + 1} up`} title="Move up">
              <Icon name="arrow-up" size={12} />
            </button>
            <button type="button" className="ib sm" onClick={() => move(i, 1)} disabled={i === cards.length - 1} aria-label={`Move entry ${i + 1} down`} title="Move down">
              <Icon name="arrow-down" size={12} />
            </button>
            <button type="button" className="ib sm" onClick={() => set(cards.filter((_, k) => k !== i))} aria-label={`Delete entry ${i + 1}`} title="Delete entry">
              <Icon name="trash" size={12} />
            </button>
          </span>
        </div>
      ))}
      <div>
        <button type="button" className="cb" onClick={() => setCards([...cards, ''])}>
          <Icon name="plus" size={12} /> Add entry
        </button>
      </div>
    </div>
  )
}
