# Model Catalog and Auxiliary Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Hermes model catalog list in the Model tab and an editor for the 18 auxiliary model slots.

**Architecture:** Collector query for the VPS catalog cache with a public-manifest fallback in main; a restricted PyYAML read script for the auxiliary slots; writes through the existing `hermes config set` path with a pure plan builder shared with the preview.

**Tech Stack:** Python stdlib collector, Electron `net.fetch`, zod, React, Vitest, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-model-catalog-auxiliary-design.md`

## Global Constraints

- Catalog: VPS cache first, then `https://hermes-agent.nousresearch.com/docs/api/model-catalog.json` from main, 1 h memory cache, 2 MiB, 10 s.
- The aux read script prints only provider, model, base_url and hasKey; it never imports Hermes and writes nothing.
- Writes only `config set auxiliary.<task>.provider|model|base_url`, never a key.
- Collector ASCII-only, stdlib-only.

---

### Task 1: Catalog

- [ ] pytest for `--query model_catalog` (profile cache, home fallback, missing, bad version, caps); implement `q_model_catalog`.
- [ ] `ModelCatalog` zod in `shared/agentCfg.ts`; `CatalogService` (`src/main/agentcfg/catalog.ts`) with injectable `fetchUrl`; channel, preload, API.
- [ ] Integration test (VPS cache wins, public fallback via injected fetch, error when both fail).
- [ ] `lib/modelCatalog.ts` + Vitest; catalog list in `ModelTab.tsx`.
- [ ] Commit `feat(model): Hermes model catalog in the Model tab`.

### Task 2: Auxiliary

- [ ] `shared/auxModels.ts` + Vitest (`buildAuxPlan`, `resetAllPlan`, validation).
- [ ] `AUX_READ_PY` + pytest against a temp config.yaml; `AuxService` read/save; fake answers the read script from its config map.
- [ ] Integration test (read, save, read back; bad slug refused without a command).
- [ ] `AuxModels.tsx` in the Model tab with the confirm modal; CSS.
- [ ] Commit `feat(model): auxiliary model slots`.

### Task 3: E2E + docs

- [ ] `agentSettings.spec.ts`: catalog pick; aux change + reset through the confirm.
- [ ] PRD (F-CFG-19, §10), checklist, CLAUDE.md. Commit.
