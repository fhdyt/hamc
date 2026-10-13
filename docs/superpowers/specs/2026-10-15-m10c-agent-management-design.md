# M10c · Settings → Agents: MCP, Toolsets, Fallback, Backup, New profile — design

PRD: 6.18 (F-CFG-19..26). The UI is English only. The terminal panel (F-TERM) is not built yet, so every "… in the terminal" button (F-CFG-26) copies the command instead and says so; nothing is ever run on the user's behalf for those.

## Facts from the Hermes source

| Command | What it prints or does | Where |
|---|---|---|
| `hermes [-p P] mcp list` | A table `Name / Transport / Tools / Status` (`✓ enabled`, `✗ disabled`); transports are URLs or commands cut at 28 characters; "No MCP servers configured." when empty | `hermes_cli/mcp_config.py` `cmd_mcp_list` |
| `mcp test <name>` | Starts the server once and reports the connection and its tools | idem |
| `mcp add|remove` | Interactive (discovery, auth); copied for the terminal | idem |
| `tools list --platform <p>` | `✓ enabled  <key>  <label>` / `✗ disabled  <key>  <label>` rows under "Built-in toolsets" and "Plugin toolsets"; keys are what `enable`/`disable` take | `hermes_cli/tools_config_mcp.py` |
| `tools enable|disable <key>... --platform <p>` | `Enabled: a, b` / `Disabled: …`; unknown keys and platform-restricted toolsets are refused with a message | idem |
| Platforms | `cli telegram discord slack whatsapp whatsapp_cloud signal bluebubbles email mattermost matrix dingtalk feishu wecom wecom_callback weixin qqbot yuanbao webhook api_server cron` | `hermes_cli/platforms.py` |
| `fallback list` | `Primary: <model>  (via <provider>)` and `Fallback chain (N entries):` with `1. …` lines; `add`/`remove` need a TTY (picker), so they are copied for the terminal | `hermes_cli/fallback_cmd.py` |
| `profile create <name> [--description D] [--clone-from SRC] [--no-skills] [--no-alias]` | Creates `profiles/<name>`; without `--no-alias` it also writes a wrapper script | `hermes_cli/subcommands/profile.py` |

## Decisions

- **MCP:** the raw `mcp list` text parsed tolerantly into rows (unparsed text shown as is); **Test** runs `mcp test <name>` after a confirm (it starts the server once); Add and Remove copy their command.
- **Toolsets:** platforms are `cli`, `cron` and the platforms of the agent's gateway (`AgentInfo.gateway.platforms`); one `tools list --platform <p>` per platform, read on demand. Changes are held (orange), then **Apply** shows the list of `tools enable|disable … --platform <p>` commands (grouped per action and platform) and runs them one by one after a confirm, reporting each result.
- **Fallback:** `fallback list` text parsed into primary and chain; Add and Remove copy `hermes [-p P] fallback add|remove`.
- **Backup:** SFTP download into a local zip picked with the save dialog: `SOUL.md`, `memories/`, `profile.yaml`, `config.yaml` (redacted locally before it is zipped: values under `env:` and `headers:` and of keys that look like secrets are blanked), `cron/jobs.json`, `skills/` (without venvs, caches and `.git`) and optionally `state.db`. Never `.env`, `auth.json`, `mcp-tokens/`. 100 MB cap. Nothing is written on the VPS.
- **New profile:** name `^[a-z][a-z0-9-]{1,23}$` and not used, description (one line, 300 characters, passed as `--description=<text>`), empty or a clone of an existing profile (`--clone-from`), `--no-skills`, and a "wrapper command" checkbox (off: `--no-alias`, because the wrapper is a script Hermes writes into `~/.local/bin`). The preview shows the exact command; Create is the explicit action.
- **F-CFG-19:** each tab says changes apply to new sessions and offers the existing gateway restart for running chats.
- Every command is built in `shared/agentOps.ts` (one builder for preview and run), validated in `ipc.ts`, run by `src/main/agentops/service.ts`, and logged as `agentops <action> <profile> exit <code>`.
