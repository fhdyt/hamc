# M10b · Memory timeline: design

PRD: 6.17 (F-MEMT-1..6), 8.4 (`memory_snapshots`). Mockup: `mockup/src/Brain.dc.html` (`?tab=timeline`). The UI is English only.

## Facts from the Hermes source

- `memories/MEMORY.md` and `memories/USER.md` hold entries joined by `"\n§\n"` (`tools/memory_tool_store.py` `ENTRY_DELIMITER`); limits 2,200 and 1,375 characters. `SOUL.md` is free text.
- The agent writes them with the tool named `memory`; its results are `role='tool'` rows with `tool_name='memory'` in `state.db`.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Watching | The main collector stream checks the three files of every profile every 30 s (`--memory-interval`), reads one only when its size or mtime changed (256 KiB cap) and emits a `memory` event `{profile, file, hash, text, truncated, size, mtime, agentTs, agentSession}` when its sha256 differs from the last one it sent (the first check sends every file: the baseline) | No polling of content; one small read per change. |
| Author guess (F-MEMT-3) | `agent` when a `memory` tool result lies within ±2 min of the file's mtime (the collector looks it up in that profile's `state.db`); `you` when Mission Control saved that exact text (Settings → Agents); `away` for the first version seen after connecting that differs from the stored one ("while away"); `other` for a later change with no evidence ("not attributed"); `first` for the very first snapshot of a file | The PRD's "while away" is only true for changes made while the app was closed; a live change with no evidence is labelled honestly. Always called a guess in the UI. |
| Storage | `app.db` table `memory_snapshots (id, connection_id, profile, file, taken_at, hash, content, author, session_id, mtime)`; a version is stored only when the hash differs from the newest stored one; retention 200 versions per file and 180 days. Nothing is written to the VPS | PRD 8.4. |
| Diff (F-MEMT-4) | Entry level for MEMORY and USER (split by `§`), line level for SOUL; unchanged entries folded behind "Show N unchanged" | Mockup. |
| Restore (F-MEMT-5) | Opens Settings → Agents on that file with the version loaded as an unsaved edit (the normal Save path with its diff and hash check) | No one-click overwrite. |
| Clear (F-MEMT-6) | Settings → Data → "Clear snapshots" (two-step) deletes the rows of the current connection | PRD. |

## Testing

pytest (`tests/collector/test_memory.py`), Vitest (store migration and retention, `MemorySnapshots` author rules, `lib/memoryTimeline.ts`, store and actions), integration (events → versions, a save through Settings is `you`), e2e (`tests/e2e/memoryTimeline.spec.ts`), checklist steps 121 onward.
