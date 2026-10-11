# M4a — Second brain (vault graph): design

PRD refs: F-BRAIN-1..9 (P0/P1 subset), F-R12 (graph node click opens a note-reader modal), §8 architecture (PixiJS v8, d3-force in a Web Worker, collector parses the vault). M4b (agent interaction graph, F-AGRAPH) is a separate cycle. Out of scope here: F-BRAIN-10 (`graph.json`), F-BRAIN-11 (Animate), F-BRAIN-12 (several vaults), the Memory timeline tab (M10).

## Decisions

- **One dedicated stream per vault.** The metrics collector has no control channel (stdin is closed after the script), so the vault runs in its own exec: `python -u - <home> --vault <path>`, using the same bundled script. The main process starts it after connect when a vault path is saved, restarts it when the path changes, and stops it on disconnect. A crash restarts it after 3 s, like the main collector.
- **Parsing happens on the VPS, stdlib only.** The renderer never receives note bodies in the stream; it receives one record per note. Bodies are fetched on click (`--query note`).
- **Zero-Change holds.** Only `os.scandir`/`open(..., 'rb')` reads. The vault path comes from the user; the note path comes from the renderer only as an id relative to the vault root, the main process supplies the root, and the script refuses anything that resolves outside the root or is not `*.md`.
- **Graph engine is split in three:** a pure model (`lib/brain/graphModel.ts`: filters, tags, ghosts, orphans, groups, local graph), a layout Web Worker (`d3-force`), and a Pixi renderer (`lib/brain/renderer.ts`). Edges are one custom Mesh (quads rebuilt from a typed array each tick); nodes are sprites with a shared circle texture; labels are a small pool of Text objects. A first-class perf spike measures a synthetic vault of 5,000 notes and 20,000 links.

## Data

`BrainNote` (one per note, emitted only when it changes):

```
{ id: 'folder/Note.md', title: 'Note', mtime: epoch s, size: bytes,
  tags: ['a', 'a/b'], aliases: [...], links: [ids of existing notes],
  ghosts: [names that match no note], attachments: [names of non-md embeds] }
```

Resolution follows Obsidian: a link target is a file name without extension, case-insensitive, `folder/name` matches by path suffix, several matches pick the shortest path, aliases from frontmatter also resolve. `#heading`, `^block` and `|alias` suffixes are stripped. `![[x]]`, `[[x]]` and `[text](x.md)` (not URLs) all count as links. Tags come from `#tag` in the body (not inside code blocks or headings-like `# `) and frontmatter `tags`. Hidden folders (any name starting with `.`) are skipped, and so is anything in `.obsidian`, `.git`, `.trash`. Limits: 20,000 notes (then `truncated: true`), files over 2 MB are listed without links, only the first 512 KB of a note is parsed.

Event `brain`: `{ mode: 'snapshot' | 'delta', first: boolean, done: boolean, total: number, truncated: boolean, notes: BrainNote[], removed: string[] }`. A snapshot is sent in chunks of 300 notes (`first` on the first chunk, `done` on the last). After the snapshot the script polls every 3 s: it stats every file, re-parses only files whose `(mtime, size)` changed, re-resolves all links (a new note can resolve old ghosts) and emits a delta with the notes whose record changed plus removed ids. Failures (path vanished, unreadable) are an `error` event with code `vault_unreadable`; the stream keeps polling.

Queries (same `--query` mode as the feed, one JSON line back):

- `vault_check {path}` → `{ ok, exists, readable, notes, truncated }` — counts `*.md` files (stops counting at 20,000).
- `browse {path}` → `{ path, parent, dirs: [{name, notes}] }` — immediate subdirectories (hidden ones skipped), `notes` is the number of `*.md` files directly inside (cheap hint), capped at 500 entries.
- `note {root, id}` → `{ id, text, truncated, mtime }` — up to 256 KB.

## Main process

`BrainService` (new, `src/main/brain/service.ts`) owns the stream, remembers the last snapshot size, and exposes `get()`, `setVault(path|null)`, `validate(path)`, `browse(path)`, `note(id)`. The saved vault path lives in `app.db` (`settings` table, key `brain.vault.<connectionId>`), so it is per connection and survives restarts. IPC: `brain:get`, `brain:setVault`, `brain:validate`, `brain:browse`, `brain:note`. Graph display settings (`brain.graph`) go through the existing settings API (global, zod-validated).

## Renderer

- `stores/brain.ts`: notes map (id → note), `vault`, `phase` (`unset | loading | live | error`), `lastDelta` (ids added/changed with a timestamp, drives the pulse), selection, hovered, local-graph target + depth, graph settings.
- Screen `Second brain` (route `brain`): header (title, controls toggle, change vault, note count, live dot, fit, preview toggle), left controls panel (Filters, Groups, Display, Forces), canvas, right note preview. The setup state asks for the path (typed, or picked with the Browse dialog) and validates before saving.
- Note preview: markdown-it (html disabled) + DOMPurify, wikilinks rendered as in-app links, with Backlinks and Outgoing lists and a Local graph control (depth 1–3).
- Dashboard `second brain` panel: the same graph in compact mode (no controls), click on a node opens the note-reader modal, expand button goes to the screen.

## Testing

pytest: parser units (links, embeds, aliases, tags, frontmatter, code blocks, resolution rules, hidden dirs), snapshot chunking, delta behaviour (add, edit, remove, ghost resolved by a new note), query path safety, no writes (tree snapshot unchanged). Vitest: `graphModel` (filters, local graph, groups), brain store, `BrainService` against the fake SSH server (set vault, snapshot arrives, delta within 3.5 s, restart on change, not-connected errors, only read verbs). Playwright: set up a vault through the UI (Browse), graph appears, hover/click opens the preview, a new note shows up live, controls persist after restart, Dashboard panel. Perf spike: synthetic 5k/20k vault, record frames per second and layout settle time into the spec result below.

## Perf spike result

Measured on Windows 11 with the Playwright-driven Electron app (`MC_PERF=1 npx playwright test tests/e2e/brainPerf.spec.ts`, `MC_PERF_NOTES` sets the size), against the fake SSH server running the real collector:

| Notes | Links | Layout ticks per second | Layout settles after | Frames per second while zooming | First graph after saving the path |
|---|---|---|---|---|---|
| 1,000 | 3,981 | 15.7 | 1.9 s | 53.6 | 12 s |
| 5,000 | 19,979 | 20.7 | 10.5 s | 32.8 | 57 s |

After the Obsidian-like layout (clustered synthetic vault with 12% unlinked notes, about 3.4 links per linked note; see the layout notes below) the 5,000-note run gave 59.5 fps while zooming, 23 layout ticks per second, a settle time of 14.7 s and no overlapping nodes among 12.5 million pairs. The layout keeps linked notes in clusters that repel each other, holds unlinked notes in a loose band just outside the connected core (a radial force whose radius follows the 90th percentile of the linked notes), and keeps every node apart with a collision force. Benchmark knobs: `MC_PERF_NOTES`, `MC_PERF_LINKS`.

F-BRAIN-9 (at least 30 fps for 5,000 notes and 20,000 links) is met on this machine, with a thin margin. The 57 s is the first parse of 5,000 freshly written files on Windows (Defender scans each new file); the same vault parses in about 2 s once the files are warm, and Linux is faster still. A later change that makes the margin thicker is to draw edges only when their endpoints are on screen. macOS and Linux have not been measured yet: run the command above on each and add a row.

## Neuron look (follow-up)

At the user's request the graph follows `prototypes/neuron-graph/index.html`, "Neuron anatomis": glowing cell body, branching dendrites (levels by connections, hubs one level deeper), curved axon links ending in synapse dots, signals travelling along links, folder colours with a legend, a name card on hover, recently changed notes pulse. It replaces the earlier Obsidian-like look. With the clustered benchmark vault, 5,000 notes / 16,865 links gave 46.6 fps while zooming and 3,000 notes 59.5 fps, with no overlapping cell bodies; layout settles in 9 to 18 s.
