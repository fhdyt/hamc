# Obsidian graph settings (F-BRAIN-10, v2)

## Goal

Draw the Second brain graph the way the user set it up in Obsidian: the colour groups and the forces of
`<vault>/.obsidian/graph.json` (PRD F-BRAIN-10). Read-only; the app never writes that file.

## Decisions

- **Live overlay, not an import.** While `brain.graph.useObsidian` is on (default) and the vault has a readable
  `graph.json`, the Obsidian values win over the app's own for the fields they cover. Turning it off shows the app's own
  values again, unchanged. Nothing is copied into the app's settings.
- Obsidian colour groups come **after** the app's own groups (the app's groups still win, as with folders), and are
  shown read-only in the controls.
- The file is read when the vault is attached (connect, vault change), when the Brain screen or the Dashboard graph
  panel mounts, and with a **Reload** button. No polling.

## Rules

- Zero-Change: one read-only `--query vault_graph`; the vault root comes from the saved setting, never from the
  renderer, exactly as `--query note`.
- The file is capped at 256 KiB; anything else in it (Obsidian has many keys) is ignored.

## Collector: `--query vault_graph {root}`

- Reads `<root>/.obsidian/graph.json` after the same `realpath` containment check as `q_note`.
- Missing file: `{ "found": false }`. Too big or not a JSON object: `QueryError("unreadable")`.
- Found: `{ "found": true, "mtime": int, "graph": {...} }` where `graph` keeps only these keys when their type is right:
  `colorGroups` (list of `{query: str, color: {rgb: int, a: number}}`, at most 64), `showTags`, `showAttachments`,
  `hideUnresolved`, `showOrphans` (bool), `centerStrength`, `repelStrength`, `linkStrength`, `linkDistance`,
  `nodeSizeMultiplier`, `lineSizeMultiplier`, `textFadeMultiplier` (number), `search` (str, 500 chars).

## Main

- `QueryCommand` gains `vault_graph`; `MissionSession.brainObsidian()` runs it with the saved root (no root:
  `{ ok: false, error: 'not_found' }`). zod `ObsidianGraphResult` in `shared/events.ts` (or next to `NoteText`).
- Channel `mc:brain:obsidian`, `window.mc.brain.obsidian()`.

## Renderer

- `lib/brain/obsidianGraph.ts` (pure):
  - `toGroups(colorGroups)` → `BrainGroup[]` with ids `obs-<i>`, colour `#rrggbb` from `rgb` (alpha ignored), empty
    queries dropped.
  - `toSettings(graph)` → `Partial<BrainGraphSettings>` for the fields present:
    - `showTags`, `showAttachments`, `showOrphans` as they are; `existingOnly = hideUnresolved`;
    - `centerForce = clamp(centerStrength, 0, 1)`; `repelForce = clamp(repelStrength / 20, 0, 1)`;
      `linkForce = clamp(linkStrength, 0, 1)`; `linkDistance = clamp((linkDistance - 30) / 470, 0, 1)`;
    - `nodeSize = clamp(nodeSizeMultiplier, 0.3, 3)`; `linkWidth = clamp(lineSizeMultiplier, 0.3, 4)`;
    - `labelFade = clamp((textFadeMultiplier + 3) / 6, 0, 1)`.
  - `effectiveGraph(own, obsidian, on)` → `{ settings, obsidianGroups, followed: (keyof BrainGraphSettings)[] }`.
- `stores/brain.ts` gains `obsidian: { state: 'idle'|'loading'|'ok'|'none'|'error'; graph?; mtime?; error? }`
  (reset with the store). `actions.ts` `loadObsidianGraph()` with a sequence number (stale answers dropped).
- `BrainGraphSettings.useObsidian: boolean` (default `true`, zod default so old saved values parse).
- `hooks/useBrainGraph.ts` uses the effective settings; the groups list is `[...own groups, ...obsidian groups]`.
- `screens/brain/Controls.tsx`: at the top an **Obsidian** row: switch *Use .obsidian/graph.json* with a line
  `Following graph.json · N groups` / `No graph.json in this vault` / the error, and **Reload**. Followed fields show the
  Obsidian value and are disabled with the hint `from graph.json`. Obsidian groups are listed read-only under the
  user's groups.

## Testing

- pytest: `vault_graph` found / missing / not an object / too big / keeps only known keys / root escape refused.
- Vitest: `toGroups`, `toSettings` (each mapping, clamping, missing keys), `effectiveGraph` (on, off, none).
- E2E (`brain.spec.ts`): the fixture vault gets a `.obsidian/graph.json` with one colour group; the controls show
  *Following graph.json · 1 group*, the slider is disabled; switching it off enables the slider.
- Checklist step: a real vault's colours and forces match Obsidian.
