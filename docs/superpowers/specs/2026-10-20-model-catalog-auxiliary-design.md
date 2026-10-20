# Model catalog and auxiliary models (v2)

Two v2 candidates that live in Settings → Agents → **Model** and share one data source: the Hermes model catalog
suggests models for the main model and for every auxiliary slot.

## What Hermes offers (checked against the source at tag v2026.8.31)

- **Catalog** (`hermes_cli/model_catalog.py`, docs `reference/model-catalog.md`): a JSON manifest
  `{version: 1, updated_at, providers: {<slug>: {models: [{id, description?, default?}]}}}` from
  `https://hermes-agent.nousresearch.com/docs/api/model-catalog.json`, cached by Hermes as-is at
  `get_hermes_home()/cache/model_catalog.json` (the profile's home under `-p`). Curated lists exist for `openrouter` and
  `nous`; one model per provider may carry `default: true`. Pricing and context length are not in it.
- **Auxiliary** (`config_defaults.py`): `auxiliary.<task>.{provider, model, base_url, api_key, ...}` for **18** tasks:
  `vision, compression, skills_hub, approval, review, mcp, title_generation, memory_query_rewrite, tts_audio_tags,
  triage_specifier, kanban_decomposer, profile_describer, goal_judge, curator, monitor, background_review,
  moa_reference, moa_aggregator`. Default `provider: auto`, `model: ''` (use the main model, with fallbacks). The docs
  list 11 slots and `web_extract`; the source dropped `web_extract`, so the app follows the source.

## Decisions (user)

- Catalog source: the **VPS cache first** (read-only), else the **public manifest fetched by the app** from the user's
  computer (never from the VPS), kept in memory for one hour.
- Auxiliary read: **one restricted read script** run with Hermes's Python that loads the profile's `config.yaml` with
  PyYAML (a Hermes dependency) and prints only `provider`, `model`, `base_url` and whether an `api_key` is set for each
  slot. It never prints a key and writes nothing; it does not import Hermes (its config loader may migrate and save).
- Auxiliary write: only `hermes [-p P] config set auxiliary.<task>.provider|model|base_url <value>`, previewed and
  confirmed like the main model. No key is ever written from this screen (a slot that needs its own key keeps using
  `hermes config` in the terminal).

## Rules

- Zero-Change: reads are read-only; writes only after the confirm, through `hermes config set`.
- The catalog fetch runs in main with Electron `net.fetch` (2 MiB cap, 10 s timeout, `https` only, that one URL); the
  renderer's CSP is unchanged.
- `app.log` gets `aux: config set auxiliary.<task>.<field> <value>` (values are provider and model names, never keys).

## Catalog

- Collector `--query model_catalog {profile}` reads `<profile home>/cache/model_catalog.json`, then
  `<hermes home>/cache/model_catalog.json`; cap 2 MiB; requires `version == 1` and a `providers` object; keeps at most
  50 providers × 2,000 models, `id` ≤ 200 chars, `description` ≤ 40. Answers `{found: false}` or
  `{found: true, mtime, updatedAt, providers}`.
- Main `src/main/agentcfg/catalog.ts` `CatalogService.get(profile)` → `{ok: true, source: 'vps'|'public', updatedAt,
  providers}` or `{ok: false, error: 'unavailable', detail}`; the public answer is validated with the same zod schema
  and cached for an hour (`fetchUrl` is a dependency so tests inject it). Channel `mc:agentcfg:catalog`.
- Renderer: `lib/modelCatalog.ts` (`catalogModels(catalog, slug)` default first, then manifest order; `sourceLine`).
  The Model tab shows a **Hermes catalog** list for the chosen provider when the catalog has it (OpenRouter, Nous
  Portal): one radio per model with its badge (`default`, `recommended`, `free`) and a line *From the server's Hermes
  cache · updated …* or *From hermes-agent.nousresearch.com*. Picking one sets the Model ID. *Fetch models* stays.

## Auxiliary

- `shared/auxModels.ts`: `AUX_TASKS` (key, label, hint) in the source order; `AuxSlot {provider, model, baseUrl,
  hasKey}`; `AuxChoice = {kind: 'auto'} | {kind: 'model', provider, model, baseUrl?}`;
  `buildAuxPlan(task, choice)` → `config set` arg lists (`auto` → provider `auto`, model `''`, base_url `''`; a model →
  provider, model, base_url value or `''`); `resetAllPlan(slots)` for every slot that is not auto. Provider slugs
  `^[a-z][a-z0-9_-]{0,40}$`, model `MODEL_ID_RE`, base URL `isHttpUrl`.
- `src/main/agentcfg/aux.ts`: `AUX_READ_PY` and `AuxService.read(profile)` (`python -c AUX_READ_PY <config path>`;
  `no-yaml` when PyYAML is missing) and `save(profile, steps)` (the steps rebuilt in main from the request, run one by
  one, stop at the first failure, then read back). Channels `mc:agentcfg:aux-read|aux-save`.
- Renderer: `screens/agents/AuxModels.tsx`, a section under the main model: 18 rows (label, `provider · model` or
  `auto (main model)`, a key badge when a slot has its own key), **Change** opens an inline editor (provider select
  with `auto` and the presets plus *Other…*, model input with the catalog as suggestions, Base URL for *Other*),
  **Use main model** sets auto, **Reset all to auto**; each save opens the confirm modal with the commands.

## Testing

- pytest: `model_catalog` profile cache, home fallback, missing, bad version, caps.
- Python (pytest, skipped without PyYAML): `AUX_READ_PY` against a temp `config.yaml` with keys: only the four fields
  leave, `hasKey` true, missing slots are auto, missing file is all auto.
- Vitest: `buildAuxPlan`, `resetAllPlan`, `catalogModels`.
- Integration: `CatalogService` VPS cache wins; public fallback through an injected fetch; aux read/save against the fake
  (`config set` recorded, read back reflects it).
- E2E (`agentSettings.spec.ts`): the catalog list sets the Model ID; an auxiliary slot changed to a catalog model and
  reset to auto through the confirm.
- Checklist: compare with `hermes model` and the dashboard Models page on the real VPS.
