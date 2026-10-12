# M7 · Release v1: design

PRD: F-APP-3 (installers), F-APP-5 (Reset settings), NF-4 (Zero-Change on a clean VPS), section 10 (M7). Written after the decision to build the configuration for all three systems, with CI, and to build and test the Windows installer on this machine.

## Scope

In:
- `electron-builder.yml` for Windows (NSIS, x64), macOS (universal DMG), Linux (AppImage and deb, x64).
- A GitHub Actions workflow: checks, one installer job per OS, a draft release for `v*` tags.
- Tests of the packaged app: the Playwright suites run against the unpacked app, and a Windows script that installs the NSIS installer silently, tests the installed app and uninstalls it.
- Reset settings (F-APP-5).
- `docs/release.md` and manual checklist steps 72-77.

Out: code signing and notarization (the config is ready, PRD Q10), auto-update (F-APP-6, P2), a second round of UI polish (nothing known to fix; the manual checklist is where it would show up).

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Config file | `electron-builder.yml`, not a `build` key in `package.json` | Keeps `package.json` readable; comments explain signing. |
| Collector | `extraResources` -> `resources/mc_collector.py` | `collectorPath()` already reads `process.resourcesPath/mc_collector.py` when packaged; it is sent over SSH stdin, so it must be a plain file. |
| Native module | `npmRebuild: true` plus `asarUnpack` for `better-sqlite3` | A `.node` file cannot load from inside an asar. |
| Signing | Off by default, switched on by `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_*` | PRD Q10: v1 ships unsigned with an install guide. |
| Windows installer | Per user, not one-click, directory choice | No administrator needed; matches how a monitoring tool for one person is installed. |
| macOS | Universal DMG as the PRD says | Unverified until CI runs: `better-sqlite3` has to be built for two architectures. If the merge fails, the fallback is two DMGs (arm64 and x64). |
| Packaged tests | `launchApp` honours `MC_PACKAGED_EXE`; `scripts/e2e-packaged.mjs` picks the unpacked path per OS | The whole existing suite can drive the packaged app with no copy of the specs. The default subset covers what packaging can break (native SQLite, the bundled collector, IPC, the window). |
| CI strictness | Windows e2e, packaged e2e and installer smoke test are required; macOS and Linux packaged e2e are `continue-on-error` | Keychain access on those runners has not been seen working. |
| Reset settings | Deletes every `SETTINGS_DEFAULTS` key except `window.bounds`; connection, pins, vault path, chat sessions stay | "Reset settings" and "Forget this connection" are separate menu items in the PRD. The window size is left alone so the window does not jump. |
| Zero-Change on a real VPS | Manual, steps 75 of the checklist (snapshot over `ssh` before and after) | The automated Zero-Change tests already use a tree snapshot against the fake server; only a real clean VPS proves the stock Hermes case. |

## Verification here

Windows: `npm run dist:win` builds the installer (about 134 MB, unsigned); `npm run test:e2e:packaged` passes against `dist/win-unpacked`; `scripts/smoke-installer-win.ps1` installs, passes the first-run suite on the installed app and uninstalls. macOS and Linux are verified only by the YAML being valid and the build scripts existing.
