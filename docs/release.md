# Releasing Hermes Agent Mission Control

PRD F-APP-3 asks for a Windows `.exe` (NSIS), a macOS `.dmg` (universal) and a Linux `.AppImage` and `.deb`. One config, `electron-builder.yml`, makes all of them. Installers are **not signed** in v1 (PRD Q10); the config turns signing on when the certificates are present (see below).

## Build on your own machine

An installer can only be built on its own OS (a DMG needs macOS, an AppImage and a deb need Linux). Node 22 and Python 3 are enough; `npm ci` rebuilds `better-sqlite3` for Electron.

| OS | Command | Output in `dist/` |
|---|---|---|
| Windows | `npm run dist:win` | `hermes-mission-control-<version>-win-x64.exe` (+ `win-unpacked/`) |
| macOS | `npm run dist:mac` | `hermes-mission-control-<version>-mac-universal.dmg` |
| Linux | `npm run dist:linux` | `...-linux-x64.AppImage`, `...-linux-x64.deb` (+ `linux-unpacked/`) |
| any | `npm run dist:dir` | the unpacked app only, quickest for testing |

The version is `version` in `package.json`. The collector ships as `resources/mc_collector.py` next to `app.asar`; `better-sqlite3` is unpacked from the asar.

## Test what you built

```bash
npm run dist:dir              # or the dist:<os> command
npm run test:e2e:packaged     # app, dashboard, agent graph and cron suites against the unpacked app
```

On Windows, `powershell -File scripts/smoke-installer-win.ps1` also installs the NSIS installer silently into a temporary folder, runs the first-run suite against the installed app and uninstalls it again. Set `MC_PACKAGED_EXE` to point `test:e2e:packaged` at any app on disk.

Linux needs a display and a keyring for Electron `safeStorage`. In a terminal without them:

```bash
sudo chown root dist/linux-unpacked/chrome-sandbox && sudo chmod 4755 dist/linux-unpacked/chrome-sandbox
dbus-run-session -- bash -c 'echo -n "" | gnome-keyring-daemon --unlock --components=secrets >/dev/null; xvfb-run -a npm run test:e2e:packaged'
```

## Continuous integration and releases

`.github/workflows/build.yml` runs on every push to `master` and every pull request:

1. **checks**: typecheck, Vitest, pytest.
2. **package** (Windows, macOS, Linux): builds the installer and uploads it as an artifact. Windows also runs the whole Playwright suite, the packaged-app suite and the installer smoke test; macOS and Linux run the packaged-app suite with `continue-on-error` until a first run shows that keychain access works on those runners.
3. **release** (only for a tag `v*`): attaches every installer to a **draft** GitHub release.

To release: change `version` in `package.json`, commit, then

```bash
git tag v0.2.0 && git push origin master v0.2.0
```

Check the draft release, test an installer by hand with `docs/manual-vps-checklist.md` (steps 72-77), then publish it.

## Opening an unsigned app (for users)

- **Windows**: SmartScreen says "Windows protected your PC". Choose **More info**, then **Run anyway**. The installer is per user and needs no administrator.
- **macOS**: Gatekeeper refuses an app from an unidentified developer. Drag the app to Applications, then **right-click > Open**, or run `xattr -cr "/Applications/Hermes Agent Mission Control.app"` once.
- **Linux**: `chmod +x hermes-mission-control-*.AppImage && ./hermes-mission-control-*.AppImage`, or `sudo apt install ./hermes-mission-control-*.deb`. Without a Secret Service keyring (GNOME Keyring or KWallet) the app cannot remember the SSH password safely and turns "remember password" off; it explains this on the Connect screen.

## Turning signing on

Nothing changes in the config; set these variables before building (in CI as repository secrets and `env` of the package job):

- Windows: `CSC_LINK` (a `.pfx` file or its base64) and `CSC_KEY_PASSWORD`.
- macOS: `CSC_LINK` and `CSC_KEY_PASSWORD` (a Developer ID Application certificate), and for notarization `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` plus `mac.notarize: true` in `electron-builder.yml`.

## Auto-update (F-APP-6)

The installed app updates itself from the newest **published** GitHub release of `fhdyt/hamc` (`publish` in `electron-builder.yml`; the repository must be public, or the app could not read the releases without a token).

- The build writes `latest.yml` (Windows), `latest-mac.yml` and `latest-linux.yml` next to the installers; CI attaches them, the Windows `.blockmap` and the macOS `.zip` (macOS updates from the zip, not the dmg) to the draft release.
- **Publish the draft** after checking it: drafts and pre-releases are invisible to the updater. Every release needs a higher `version` in `package.json`.
- In the app: Settings → General → *Check for updates automatically* (on by default: 20 s after start, then every 6 hours; downloads in the background, installs when the app quits); Settings → About shows the state with *Check for updates* and *Restart to update*; the status bar shows *Restart to update* when a download is ready.
- Where it works: the Windows NSIS install (unsigned is accepted; signed is better), macOS only when the app is signed and notarized, Linux only for the AppImage (a `.deb` is updated with the package manager). A development run and `MC_NO_UPDATE=1` (the E2E tests) turn it off.
- Code: `src/main/update/service.ts` (`UpdateService` around `electron-updater`'s `autoUpdater`), `src/shared/update.ts`, `src/renderer/stores/update.ts`, channels `mc:update:get|check|install`, `mc:ev:update`.

## Zero-Change on a clean VPS (NF-4)

The automated Zero-Change tests (`tests/integration`, a tree snapshot before and after) run against a fake server. For a real one, follow steps 72-77 of `docs/manual-vps-checklist.md`: snapshot the home directory over `ssh` before the first connection, use every screen, disconnect, snapshot again, and expect no difference except what you saved yourself.

## Not verified yet

The macOS universal build and the Linux builds have only been configured, because they cannot be built on Windows. The first CI run decides whether `better-sqlite3` merges into a universal binary and whether the Linux packaged suite passes on a runner.
