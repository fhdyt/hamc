# M8c · Navigation: design

PRD: F-NAV-5 (badges), F-NAV-6 (shortcuts), F-NAV-7 (command palette). Mockup: `mockup/*.html` (Ctrl+K). The UI is English only; this document is not.

## Scope

In: the **command palette** (Ctrl+K or Cmd+K, and the Search button of the sidebar) for screens, agents (open the chat, open the settings tabs Model, SOUL.md, Memory, User profile), sessions (jump by title), vault notes, and actions (Settings, Connection settings, Cron jobs, today's cost); the **Chat badge** (replies that finished while the user was not looking at that agent); the Search button of the sidebar made real.

Out, on purpose: the **Logs badge** and the palette action "show errors from the last hour" (the Logs screen is M9), the **terminal** (toggle action and Ctrl+\`; the terminal panel is not built), a "More" overflow of the menu (F-NAV-4, there is no status bar menu any more). The palette lists its items from registries, so Logs and Terminal items are one entry each when those screens exist. Ctrl+1 to Ctrl+0 already work.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Where do sessions come from? | When the palette opens it loads the 100 newest sessions with the existing `sessions_list` query (again when the data is older than 60 s). Typing only filters locally. The sessions already loaded by the Sessions screen are merged in. | Chosen by the user. A palette that is empty until Sessions was opened is not useful; one query per open is cheap and typing never asks the server. |
| Matching | A small local scorer: exact, prefix, word prefix, substring, then in-order letters; case and accents ignored; ties by group order (screens, actions, agents, sessions, notes) | No dependency; the item count is a few hundred. |
| What is "unread" | A chat turn of agent A that ended without error and without Stop while A's room was not on screen (another screen, another agent, or the window not focused/visible). The count is per agent; the badge shows the sum. | Chat replies only come from turns this app started, so the only way to miss one is to look away during a long turn. |
| When is it cleared | As soon as A's room is on screen in a visible, focused window: the Chat screen with A selected, or the Dashboard with A selected (its chat room is there). | Same rooms that show the conversation. |
| Today's cost | The action opens Usage on the Cost tab with the last day (today) pinned once the data is there | Reuses the pinned day of M8b. |

## Zero-Change

The palette and badges only read. The one query is the existing read-only `sessions_list`. No new IPC channel, no write.

## Design

```
renderer
  lib/palette.ts              pure: items from data, scoring, search, grouping
  lib/unread.ts               pure: isViewing(...), shouldCount(ev)
  stores/palette.ts           open, query, selected index, sessions, loadedAt, loading, error
  stores/unread.ts            counts per agent
  paletteActions.ts           openPalette, closePalette, loadPaletteSessions, runItem
  components/CommandPalette.tsx   the dialog (combobox + listbox)
  shell/useShortcuts.ts       Ctrl/Cmd+K toggles the palette
  shell/Sidebar.tsx           Search button opens it; Chat badge
  shell/useUnread.ts          clears the counts of the agent on screen (route, selection, focus, visibility)
  bootstrap.ts                counts an ended chat turn when the room is not on screen
```

### Items (`lib/palette.ts`)

`PaletteItem { id: string; group: 'screen' | 'action' | 'agent' | 'session' | 'note'; label: string; hint?: string; keywords?: string; target: PaletteTarget }` where `PaletteTarget` is data, not a function (so it is testable and serializable):

- `{ kind: 'screen'; route }` for each `NAV` entry (hint: the shortcut, `Ctrl+4`, and "Coming in a later release" for Kanban, Skills and Logs).
- `{ kind: 'chat'; profile }` "Chat with <name>"; `{ kind: 'agent-settings'; profile; tab: 'model' | 'soul' | 'memory' | 'user' }` "<name> · Model", "<name> · SOUL.md", "<name> · Memory", "<name> · User profile".
- `{ kind: 'session'; profile; id }` label is the title or "Untitled session", hint "<agent> · <source> · <age>".
- `{ kind: 'note'; id }` label is the note title, hint its path.
- `{ kind: 'action'; action: 'settings' | 'connection' | 'cron' | 'cost-today' }`.

`buildItems({ agents, sessions, notes, now })` returns them all; `searchItems(items, query, limit = 40)` returns the visible list: with an empty query the screens and actions (then up to 5 sessions and 5 notes of the newest); with text the scored matches. A result that is a session or a note is capped at 8 each so they cannot push screens out.

### Palette (`components/CommandPalette.tsx`)

`role="dialog"` named "Command palette" over a backdrop; a text input with `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`; a `role="listbox"` of `role="option"` rows under group headings. Up and Down move (wrapping), Home and End jump, Enter runs, Escape closes (and stops the event so a dialog under it stays), a click on a row runs it, a click on the backdrop closes. The input has a label; the selected row scrolls into view; focus returns to where it was. The empty result says what to try ("No results for “x”. Try a screen name, an agent, a session title or a note."). While sessions load a small status line "Loading sessions…" shows; a failed load shows "Sessions could not be loaded" and the rest still works. Reduce motion removes the entrance animation.

Running an item closes the palette first, then: screen -> `navigate`; chat -> select the agent in the agents store and the chat store, navigate to Chat; agent settings -> select the profile and tab in `useAgentCfg`, `openSettings('agents')`; session -> navigate to Sessions and `openSession`; note -> `useBrain.openNote(id)` (the note dialog is global); actions -> Settings General, Settings Connection, Dashboard plus the Cron modal, Usage with today pinned (`pinToday` flag in the usage store, consumed when the data arrives).

### Badge and unread

`bootstrap.ts` already receives every `ChatEvent`. After `applyChat`, an `end` event with `exitCode === 0` and `stopped === false` calls `countIfAway(profile)`: `isViewing` is true when the document is visible and focused and either the route is `chat` with that agent current, or the route is `dashboard` with that agent selected. If not viewing, `stores/unread` adds 1. `useUnread` (mounted in the Shell) calls `clear(profile)` whenever the route, the current chat agent, the selected agent, the focus or the visibility changes and the agent on screen has a count. `reset` on connection change.

The sidebar Chat item shows the sum as a cyan badge (a dot with the number in the rail mode), and its `aria-label` says "Chat, 2 unread replies". The Search button gets the Ctrl+K hint.

## Errors and edge cases

- Not connected: sessions are not loaded and the line says so; everything else works from memory.
- No agents or no vault: those groups are simply absent.
- A palette opened on connect/launch screens does nothing (the shortcut is ignored there, like the screen shortcuts).
- Two quick opens do not start two loads (a sequence number drops the older answer).
- Unread counts survive a screen change but not a reconnect to another server.

## Testing

- Vitest: `lib/palette` (scorer order, accents and case, empty query, caps, every item kind, a note and a session with no title), `lib/unread` (`isViewing` cases, `shouldCount`), `stores/palette` and `stores/unread` reducers, `paletteActions` (stale load dropped, load skipped when fresh, `runItem` effects for each target with stubbed stores).
- E2E (`tests/e2e/palette.spec.ts`): Ctrl+K opens and Escape closes; the Search button opens; typing an agent name and Enter opens its chat; typing a session title jumps to Sessions with that session open; "Scout · Model" opens Settings on the Agents tab with Model; the Cron action opens the Dashboard with the Cron modal; "today's cost" lands on Usage with the last day pressed; the empty result text; the listbox keyboard (ArrowDown moves `aria-activedescendant`); a chat turn that ends while the user is on Usage shows the badge on Chat, and opening Chat clears it.
- Manual (`docs/manual-vps-checklist.md`, steps 91 onward): the session list in the palette matches Sessions, a note opens, Cmd+K on macOS, the badge with a real long turn.
