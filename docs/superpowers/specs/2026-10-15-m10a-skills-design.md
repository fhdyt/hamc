# M10a · Skills screen: design

PRD: 6.15 (F-SKILL-1..7), F-NAV-7 (palette), F-R13-1 (sidebar). Mockup: `mockup/src/Skills.dc.html`. The UI is English only.

M10 is split in three: **M10a** (this one, the Skills screen), **M10b** (memory timeline in Second brain) and **M10c** (Settings → Agents: MCP, Toolsets, Fallback, Backup, New profile).

## What the real Hermes does (public source, NousResearch/hermes-agent, 2026-10-13)

| Topic | Fact | Where |
|---|---|---|
| Layout | `<home>/skills/**/SKILL.md` (named profiles: `profiles/<p>/skills`), any depth; scanners skip `.git`, `.github`, `.hub`, `.archive`, `.curator_backups`, `.locks`, venvs, caches, and `references`/`templates`/`assets`/`scripts` folders directly inside a skill | `agent/skill_utils.py` |
| Name | Frontmatter `name:` (first 4,000 characters), else the folder name | `tools/skill_usage.py` `_read_skill_name` |
| Usage | `skills/.usage.json`: `{name: {created_by, use_count, view_count, patch_count, last_used_at, last_viewed_at, last_patched_at, created_at, state (active, stale, archived), pinned, archived_at, ...}}` | `tools/skill_usage.py` |
| Origin | `hub` when the name is in `skills/.hub/lock.json` `installed` (or the `name:` of its `install_path`), `bundled` when in `skills/.bundled_manifest` (`name:hash` lines) or `.curator_suppressed`, else `agent` (agent-written and local hand-made skills; Hermes calls it so) | `provenance()` |
| Archive | Archived skills move to `skills/.archive/<name>/` | `archive_skill` |
| Ledger | `skills/.curator_ledger.jsonl`: `{id, ts, actor (curator, agent, user), action, skill, evidence, before: [{path, sha256}], after: [...]}`; file contents in `<home>/.curator_backups/blobs/<sha256>` | `tools/skill_ledger.py` |
| Frontmatter | `description`, `version`, `platforms`, `tags` or `metadata.hermes.tags`, `metadata.hermes.requires_toolsets`, env names from `required_environment_variables`, `setup.collect_secrets[].env_var`, `prerequisites.env_vars` | bundled skills, `tools/skills_tool_setup.py` |
| Commands | `curator pin|unpin|archive|restore <skill>`, `curator status` (text), `skills inspect <id>`, `skills install <id> [--category C] [--yes] [--force]`. Install asks `Confirm [y/N]` on stdin; EOF counts as no, so a non-interactive install needs `--yes`. A **blocked** scan verdict stops the install unless `--force` | `hermes_cli/curator.py`, `hermes_cli/skills_hub.py` |

## Scope

In: the **Skills** screen (replaces `ComingSoon`) with tabs **Library** and **Changes**; agent chips (shared `filters.agent`), kind filters with counts (Active, Agent-written, Hub, Bundled, Stale, Archived), search over name, description and tags; a detail panel with facts, env names (never values), usage facts and the rendered, sanitized `SKILL.md`; **Pin/Unpin** and **Archive/Restore** for agent-written skills; **Install from hub** (Inspect first, then Install with `--yes` after the user confirmed the command); the Changes tab with the curator ledger, diffs of `SKILL.md` from the blobs, and `curator status` as text. The palette item loses its "later release" note.

Out: enable/disable per skill (not documented, F-SKILL-7), editing skills, `curator run|prune|purge|rollback|adopt`, `skills uninstall|update|reset`, skills from `skills.external_dirs` (shown only by `hermes skills list`, said in the UI).

## Decisions

| Question | Choice | Why |
|---|---|---|
| Data | Read-only collector queries: `skills_list` (all profiles or the chosen ones), `skill_read` (one `SKILL.md`, 256 KiB), `skills_ledger` (newest 200 entries, from the last 2 MiB), `skills_blobs` (1 to 4 blobs by sha256, 64 KiB each) | Same pattern as Kanban; no `hermes` start for reads. |
| Frontmatter | A small tolerant YAML subset in the collector (scalars, inline and block lists, nested maps by indentation); anything else is ignored | Stdlib only; the facts we show are simple. |
| Origin and state | Hermes's own rules above; `archived` when the skill sits in `.archive/` or its record says so; `stale` from the record | The UI states that `created_by` is a policy marker, not proof (F-SKILL-7). |
| Actions | `curator pin|unpin|archive|restore <name>` only for origin `agent` (bundled and hub skills say why there is nothing to do); `skills inspect <id>` is read-only and shows its text; `skills install <id> --yes [--category <c>]` after the confirm. Never `--force` | PRD F-SKILL-4/5. `--yes` only replaces Hermes's own prompt by the app's confirm; Hermes's scan still blocks. |
| Arguments | Skill name `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`; hub id `^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$` or an `https://` URL without spaces; category `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` | No argument can start with `-`; each is quoted on its own. |
| Refresh | The library reloads when the screen opens, every 30 s while visible, and after an action | Skills change slowly. |

## Zero-Change rules

- Reads only: files under `skills/` and `.curator_backups/blobs/` of the chosen profile, real path inside them, size-capped; `.env`, `auth.json` never.
- The only writes are the six commands above, each after a confirm with the exact command, logged as `skills <action> <profile> exit <code>` without the skill text.

## Testing

pytest (`tests/collector/test_skills.py`), Vitest (`skillsShared`, `skillActions`, `skillsLib`, store and actions), integration over the fake SSH server with a fake `hermes curator|skills` (`tests/fixtures/fake_hermes_skills.py`), e2e `tests/e2e/skills.spec.ts`, manual checklist steps 115 onward.
