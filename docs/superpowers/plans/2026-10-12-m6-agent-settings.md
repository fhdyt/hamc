# M6 Agent Settings: implementation plan

Spec: `docs/superpowers/specs/2026-10-12-m6-agent-settings-design.md`. Each task ends green (`npm run typecheck`, `npm test`) and with a commit.

1. **Shared logic.** `src/shared/textDiff.ts` (line diff, merge3), `src/shared/agentCfg.ts` (kinds, limits, paths, entries, presets, env names, `buildModelPlan`, result types). Unit tests first.
2. **File service.** `src/main/agentcfg/files.ts` (`AgentFileService`), fake SFTP gains read, fstat, rename, setstat. Integration tests through the fake SSH.
3. **Model parsers and service.** `src/main/agentcfg/parse.ts`, `model.ts`, the fetch script, fake Hermes `config get/set`, `status`, `gateway restart`, `chat -q`. Unit and integration tests.
4. **Wiring.** `session.ts`, `ipc.ts` (zod), `channels.ts`, `shared/ipc.ts` (`MissionApi.agentCfg`), preload; log redaction; window close guard.
5. **Renderer store and libs.** `stores/agentCfg.ts` (drafts, dirty, undo, conflict, guards), `lib/agentCfg.ts`; store tests.
6. **Renderer UI.** `settings/AgentsTab.tsx` and `screens/agents/*` (agent list, tabs, Model, Soul, entries editor, diff and conflict dialogs, restart dialog); Settings modal widens for this tab; unsaved guards; Dashboard gear.
7. **E2E, docs.** Playwright spec, CLAUDE.md, manual checklist steps, README notes. Final `typecheck`, `test`, `test:py`, `test:e2e`.
