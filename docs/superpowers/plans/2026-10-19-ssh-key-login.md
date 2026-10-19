# SSH Key Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log in to the VPS with an SSH private key file (with an optional passphrase kept in the OS keychain) as an alternative to the password.

**Architecture:** A new pure-ish module `src/main/connection/keyFile.ts` reads and inspects key files with ssh2's `utils.parseKey`. `MissionSession` resolves credentials per method (password or key) before the handshake, keeps the key buffer in memory for reconnects and saves `auth_method`, `key_path` and the encrypted secret in `app.db` (migration 5). The renderer only ever sees `KeyInfo` (name, type, fingerprint) and can only send back a path the main process returned from its own dialog, or the saved one.

**Tech Stack:** Electron main (ssh2, better-sqlite3, safeStorage), React renderer, zod contract, Vitest (unit + integration against `fakeSshServer`), Playwright for Electron.

**Spec:** `docs/superpowers/specs/2026-10-19-ssh-key-login-design.md`

## Global Constraints

- Zero-Change: the app never installs the public key, never edits `~/.ssh/authorized_keys`, writes nothing on the VPS.
- Key contents and passphrase never reach the renderer and are never logged; `app.log` gets `auth: key <TYPE> <fingerprint>` or `auth: password`.
- Key file: a regular file (symlinks followed) of at most 64 KiB (`KEY_FILE_MAX = 65536`).
- One method per connection: `'password' | 'key'`. Switching method or key path drops the stored secret unless a new one is given.
- UI strings in English; Dracula tokens (`#A9B2D3` / `#8B95BD` secondary text, `#FF5555` errors, `#FFB86C` warnings).
- Supported formats: OpenSSH (`-----BEGIN OPENSSH PRIVATE KEY-----`, incl. encrypted), PEM `RSA|DSA|EC` (incl. encrypted), PuTTY PPK v2. PPK v3 is refused with: `This key is in PuTTY's newer format. Export it from PuTTYgen as an OpenSSH key (Conversions → Export OpenSSH key).`
- No ssh-agent, no keyboard-interactive, no password fallback after a refused key.

---

### Task 1: Key file reader and inspector

**Files:**
- Modify: `src/shared/ipc.ts` (types only: `AuthMethod`, `KeyFormat`, `KeyFacts`, `KeyInfo`, `KeyProblem`, `PickKeyResult`)
- Create: `src/main/connection/keyFile.ts`
- Test: `tests/unit/keyFile.test.ts`

**Interfaces:**
- Produces (in `@shared/ipc`):
  ```ts
  export type AuthMethod = 'password' | 'key'
  export type KeyFormat = 'openssh' | 'pem' | 'ppk'
  export interface KeyFacts { type: string; fingerprint: string | null; encrypted: boolean; format: KeyFormat }
  export interface KeyInfo extends KeyFacts { path: string; name: string }
  export type KeyProblem = 'unreadable' | 'too-big' | 'not-a-key' | 'ppk3' | 'needs-passphrase' | 'bad-passphrase'
  export type PickKeyResult = { ok: true; key: KeyInfo } | { ok: false; reason: 'cancelled' | 'unreadable' | 'too-big' | 'not-a-key' | 'ppk3'; message?: string }
  ```
- Produces (in `keyFile.ts`): `KEY_FILE_MAX`, `readKeyFile(path): KeyRead`, `inspectKey(data: Buffer, passphrase?: string): KeyCheck`, `keyInfoOf(path, facts): KeyInfo`, `openSshPublic(text): { type: string; fingerprint: string } | null`, `typeLabel(sshType): string`, `fingerprintOf(blob: Buffer): string`.
  ```ts
  export type KeyRead = { ok: true; data: Buffer } | { ok: false; reason: 'unreadable' | 'too-big'; message: string }
  export type KeyCheck = { ok: true; facts: KeyFacts; unlocked: boolean } | { ok: false; problem: KeyProblem; message: string }
  ```
  `unlocked` is true when ssh2 can use the key with the given passphrase (always true for an unencrypted key).

- [ ] **Step 1: Write the failing tests** (`tests/unit/keyFile.test.ts`): keys generated in the test with `utils.generateKeyPairSync` (ssh2) and `crypto.generateKeyPairSync` (PEM). Cases: unencrypted ed25519/ecdsa/rsa give type, fingerprint equal to `SHA256:` of the public key blob, `encrypted: false`, `unlocked: true`; encrypted OpenSSH without a passphrase gives `encrypted: true`, `unlocked: false` and the same fingerprint (from the header); with the right passphrase `unlocked: true`; wrong passphrase → `bad-passphrase`; encrypted PEM RSA without passphrase → `type: 'encrypted'`, `fingerprint: null`; with passphrase → `RSA` and a fingerprint; a public key line, random text and PKCS#8 PEM → `not-a-key`; PPK v3 header → `ppk3`; `readKeyFile` of a missing path → `unreadable`, of a folder → `unreadable`, of a 70 KiB file → `too-big`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/keyFile.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `keyFile.ts`:
  ```ts
  const PEM_RE = /^-----BEGIN (RSA|DSA|EC) PRIVATE KEY-----/
  export const PPK3_TEXT = "This key is in PuTTY's newer format. Export it from PuTTYgen as an OpenSSH key (Conversions → Export OpenSSH key)."
  function formatOf(text: string): KeyFormat | 'ppk3' | null {
    if (text.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')) return 'openssh'
    if (PEM_RE.test(text)) return 'pem'
    if (text.startsWith('PuTTY-User-Key-File-2:')) return 'ppk'
    if (/^PuTTY-User-Key-File-\d+:/.test(text)) return 'ppk3'
    return null
  }
  export function inspectKey(data: Buffer, passphrase?: string): KeyCheck {
    const text = data.toString('utf8').trim()
    const format = formatOf(text)
    if (format === 'ppk3') return { ok: false, problem: 'ppk3', message: PPK3_TEXT }
    if (format === null) return NOT_A_KEY
    const bare = first(utils.parseKey(text))
    const encrypted = bare instanceof Error && /no passphrase given/.test(bare.message)
    if (!encrypted) return usable(bare, false, format)
    const header = format === 'openssh' ? openSshPublic(text) : null
    const locked: KeyFacts = { type: header?.type ?? 'encrypted', fingerprint: header?.fingerprint ?? null, encrypted: true, format }
    if (!passphrase) return { ok: true, facts: locked, unlocked: false }
    const opened = first(utils.parseKey(text, passphrase))
    if (opened instanceof Error || !opened) return { ok: false, problem: 'bad-passphrase', message: 'The passphrase is wrong.' }
    return usable(opened, true, format)
  }
  ```
  `usable` returns `NOT_A_KEY` for an Error or a key whose `isPrivateKey()` is false, else facts from `typeLabel(key.type)` and `fingerprintOf(key.getPublicSSH())`. `openSshPublic` decodes the base64 body, checks the `openssh-key-v1\0` magic, skips the cipher, kdf and kdf-options strings and the key count, reads the public key string, then the type string inside it. `readKeyFile` uses `statSync` (follows links), refuses non-files and files over `KEY_FILE_MAX`.
- [ ] **Step 4: Run** the test file — expect PASS.
- [ ] **Step 5: Commit** `feat(conn): read and inspect SSH private key files`.

### Task 2: app.db migration 5 and the saved connection contract

**Files:**
- Modify: `src/shared/ipc.ts` (`ConnectRequestSchema`, `SavedConnection`, `MissionApi.connection.pickKey`)
- Modify: `src/main/store/settingsStore.ts`
- Test: `tests/unit/settingsStore.test.ts`

**Interfaces:**
- `ConnectRequestSchema` adds `auth: z.enum(['password', 'key']).optional()`, `keyPath: z.string().min(1).max(4096).optional()`, `passphrase: z.string().max(1024).optional()`.
- `SavedConnection`: `hasPassword` → `hasSecret: boolean`; adds `authMethod: AuthMethod`, `keyPath: string | null`, `keyInfo?: KeyInfo | null` (filled by the session, not the store).
- `UpsertConnection`: `passwordEnc` → `secretEnc?: Buffer | null`; adds `authMethod?: AuthMethod`, `keyPath?: string | null`.
- `SettingsStore.getPasswordEnc()` → `getSecretEnc(): Buffer | null`.
- `MissionApi.connection.pickKey(): Promise<PickKeyResult>`.

- [ ] **Step 1: Failing tests:** an old row (created by migrations 1-4 then 5) reads `authMethod: 'password'`, `keyPath: null`; upsert with `authMethod: 'key', keyPath: '/k', secretEnc: B` stores it; a second upsert with the same method and path and no `secretEnc` keeps it; changing to `password` without `secretEnc` clears it and `keyPath`; changing `keyPath` clears it; `remember: false` clears it. Rename existing `hasPassword` / `passwordEnc` / `getPasswordEnc` uses in the test.
- [ ] **Step 2: Run** `npx vitest run tests/unit/settingsStore.test.ts` — expect FAIL.
- [ ] **Step 3: Implement:** append to `MIGRATIONS`:
  ```ts
  `ALTER TABLE connections ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'password';
   ALTER TABLE connections ADD COLUMN key_path TEXT;`
  ```
  and in `upsertConnection`:
  ```ts
  const authMethod = input.authMethod ?? existing?.auth_method ?? 'password'
  const keyPath = authMethod === 'key' ? (input.keyPath ?? existing?.key_path ?? null) : null
  const sameAuth = !!existing && existing.auth_method === authMethod && existing.key_path === keyPath
  const secretEnc = !input.remember ? null : input.secretEnc !== undefined ? input.secretEnc : sameAuth ? existing.password_enc : null
  ```
  UPDATE/INSERT write `auth_method` and `key_path`. Update the contract types and `src/main/session.ts` call sites so `npm run typecheck` passes (session keeps password behaviour in this task).
- [ ] **Step 4: Run** the store tests and `npm run typecheck` — expect PASS (renderer uses of `hasPassword` switch to `hasSecret`).
- [ ] **Step 5: Commit** `feat(store): remember the sign-in method and key path (migration 5)`.

### Task 3: Connecting with a key (main process)

**Files:**
- Modify: `src/main/connection/manager.ts`, `src/main/connection/errors.ts`, `src/main/session.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/shared/channels.ts`, `src/preload/index.ts`, `src/main/terminal/localShell.ts` (`SshTarget` fields only)
- Modify: `tests/helpers/fakeSshServer.ts` (`publicKey` option)
- Test: `tests/integration/keyLogin.test.ts`, `tests/integration/session.test.ts` (renames)

**Interfaces:**
- `ConnectParams = { host: string; port: number; username: string } & ({ password: string } | { privateKey: Buffer; passphrase?: string; keyPath: string; keyFormat: KeyFormat })`.
- `SshTarget` adds `identity?: string` (key path usable by OpenSSH) and `systemSshProblem?: string` (set for PPK).
- `friendlyMessage(kind, host, port, raw, who?: { key: boolean; username: string })`; for `auth` with a key: `The server refused this key. Check that its public key is in ~/.ssh/authorized_keys of ${username}.`
- `SessionDeps.openKeyDialog?: () => Promise<string | null>`; `MissionSession.pickKey(): Promise<PickKeyResult>`; `getSaved()` fills `keyInfo`.
- Channel `IPC.pickKey = 'mc:connection:pick-key'`.
- Fake server option `publicKey?: string` (OpenSSH public line); accepts `publickey` with a verified signature for that key, rejects with `['password', 'publickey']`.

- [ ] **Step 1: Failing integration tests** (`tests/integration/keyLogin.test.ts`, same harness as `session.test.ts`; keys written to the temp dir; `openKeyDialog` returns the test's path):
  1. unencrypted ed25519: `pickKey()` → `ED25519` + the public key's fingerprint; connect `{auth: 'key', keyPath}` → host key challenge → trust → connect again → ok; saved `authMethod: 'key'`, `keyPath`, `hasSecret: false`; `getSaved().keyInfo.name` is the file name.
  2. encrypted key: no passphrase → `{kind: 'auth', message: 'This key needs its passphrase.'}`; wrong → `The passphrase is wrong.`; right → ok after trust; `getSecretEnc()` is `enc:<passphrase>`; a new session on the same store connects with `{host, port, username, remember: true, useSaved: true}`.
  3. a server with another public key → `auth`, message contains `refused this key`.
  4. a key path neither picked nor saved → `auth` `Choose the key file again.` and `srv.execLog` stays empty.
  5. the log lines (session `log` dep) contain `auth: key ED25519` and never the passphrase or `PRIVATE KEY`.
- [ ] **Step 2: Run** `npx vitest run tests/integration/keyLogin.test.ts` — expect FAIL.
- [ ] **Step 3: Implement:**
  - fake server: in `authentication`, besides password:
    ```ts
    if (ctx.method === 'publickey' && o.publicKey && ctx.username === o.username) {
      const pub = utils.parseKey(o.publicKey) as ParsedKey
      const same = ctx.key.algo === pub.type && ctx.key.data.equals(pub.getPublicSSH())
      if (!same) return ctx.reject(['password', 'publickey'])
      if (!ctx.signature) return ctx.accept()
      return pub.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true ? ctx.accept() : ctx.reject(['password', 'publickey'])
    }
    ```
  - manager: pass `password` or `privateKey`/`passphrase` to `client.connect`; keep `{identity | systemSshProblem}` in `target` (`ppk` → `systemSshProblem: 'This key is in PuTTY format, which the system ssh cannot read: using the built-in shell.'`); pass `{ key, username }` to `friendlyMessage`.
  - session: `Pending` holds `creds: { method: 'password'; password } | { method: 'key'; keyPath; passphrase }`; new private `credentials(req, saved, sameTarget)` returns `{ ok: true; params; fromKeychain; detail; logLine } | { ok: false; message; detail }`. Method = `req.auth ?? (sameTarget ? saved.authMethod : 'password')`. Key branch: path from request or saved (same target); allowed only if in `keyPicks` or equal to the saved `keyPath`; `readKeyFile` → `inspectKey(data, passphrase)` with the passphrase from the request, else the keychain (same target and same key path), else pending (same target and key path); `unlocked === false` → `This key needs its passphrase.` Persist `authMethod`, `keyPath` and `secretEnc` (the passphrase only for an encrypted key). Log `auth: key <type> <fingerprint>` / `auth: password`.
  - `pickKey()` per the spec; `ipc.ts` `handle(IPC.pickKey, () => d.session.pickKey())`; preload `pickKey`; `index.ts` `openKeyDialog` (returns `MC_E2E_KEY_FILE` when set, else `dialog.showOpenDialog` with `openFile`, `showHiddenFiles`, `defaultPath: ~/.ssh` when it exists).
- [ ] **Step 4: Run** the new tests, `tests/integration/session.test.ts`, `npm run typecheck` — expect PASS.
- [ ] **Step 5: Commit** `feat(conn): sign in with an SSH private key`.

### Task 4: System ssh server tabs use the same key

**Files:**
- Modify: `src/main/terminal/localShell.ts` (`sshArgs`), `src/main/terminal/service.ts`, `src/shared/terminal.ts` (`note?: string` on the ok result), `src/renderer/terminalActions.ts`
- Test: `tests/unit/localShell.test.ts`

- [ ] **Step 1: Failing tests:** `sshArgs` with `identity: 'C:\\Users\\me\\.ssh\\id_ed25519'` contains `-o`, `IdentityFile="C:/Users/me/.ssh/id_ed25519"`, `-o`, `IdentitiesOnly=yes` before `-l`; without identity the args are unchanged; a target with `systemSshProblem` opens a built-in shell (the test's `openShell` resolves a fake channel) whose result has `via: 'builtin'` and `note` equal to the problem.
- [ ] **Step 2: Run** `npx vitest run tests/unit/localShell.test.ts` — expect FAIL.
- [ ] **Step 3: Implement:** in `sshArgs`, `...(t.identity ? ['-o', `IdentityFile=${sshConfigPath(t.identity)}`, '-o', 'IdentitiesOnly=yes'] : [])` before `'-l'` (an `-o` value is parsed with quotes, unlike `-i`); `open()` uses system ssh only when `!target.systemSshProblem`, otherwise the built-in result gets `note`; `startShell` writes `note` in the same colour as `[Reconnected.]`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(terminal): server tabs log in with the connection's key`.

### Task 5: Connection form with a sign-in method

**Files:**
- Modify: `src/renderer/lib/connectForm.ts`, `src/renderer/screens/connect/ConnectionForm.tsx`, `src/renderer/actions.ts` (`runConnect` strips `passphrase` from `lastRequest`), `src/renderer/screens/EditConnectionDialog.tsx` (forget text says "its password or passphrase"), `src/renderer/styles/app.css`
- Test: `tests/unit/renderLibs.test.ts`

**Interfaces:**
- `FormValues = { host; port; username; auth: AuthMethod; password: string; keyPath: string | null; keyEncrypted: boolean; passphrase: string; hasSavedSecret: boolean; sameTarget: boolean; sameKey: boolean }`; error fields add `'key' | 'passphrase'`.

- [ ] **Step 1: Failing tests:** password mode keeps today's rules (with `hasSavedSecret`); key mode without `keyPath` → `{field: 'key', message: 'Choose the key file.'}`; encrypted key without passphrase → `{field: 'passphrase', message: 'Enter the passphrase of this key.'}`; same with `hasSavedSecret && sameKey` → ok; unencrypted key → ok.
- [ ] **Step 2: Run** `npx vitest run tests/unit/renderLibs.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the validation, then the form: `role="radiogroup" aria-label="sign-in method"` with two `role="radio"` buttons **Password** / **Private key** (arrow keys move, class `cf-seg`); key mode shows **Choose key file…** (`id="cf-key"`) or the chosen key (`name`, `type`, `fingerprint`, **Change**), pick errors under it, the passphrase field (`id="cf-phrase"`, label `passphrase`) only for an encrypted key, help text `The public key must already be in ~/.ssh/authorized_keys on the server. The app does not add it.`, and the remember hint `(password → OS keychain)` / `(passphrase → OS keychain)` / none. The request sends `auth`, `keyPath`, `passphrase` in key mode.
- [ ] **Step 4: Run** the unit tests and `npm run typecheck` — expect PASS.
- [ ] **Step 5: Commit** `feat(connect): choose password or private key in the connection form`.

### Task 6: E2E for key login

**Files:**
- Modify: `tests/e2e/helpers.ts` (`launchApp(userData, env = {})`)
- Create: `tests/e2e/keyLogin.spec.ts`

- [ ] **Step 1: Write the spec** (serial): an encrypted ed25519 key in a temp folder, the fake server with its public key, `MC_E2E_KEY_FILE` set. (a) First run: fill host, port, username, choose **Private key**, click **Choose key file…**, see `ED25519`, fill the passphrase, Test & connect, trust the host key, the Main navigation shows. (b) Relaunch: auto-connects to the Main navigation without the form. (c) Restart the fake server with another public key, relaunch: the Edit connection form shows `refused this key`.
- [ ] **Step 2: Build and run** `npm run build && npx playwright test tests/e2e/keyLogin.spec.ts` — expect PASS (fix and repeat if not).
- [ ] **Step 3: Run** `npx playwright test tests/e2e/launch.spec.ts tests/e2e/app.spec.ts` to check the password path still works.
- [ ] **Step 4: Commit** `test(e2e): sign in with an SSH key, auto-connect and a refused key`.

### Task 7: Mockup, docs and full verification

**Files:**
- Modify: `mockup/src/Connect.dc.html` (method switch, key row; `python mockup/build.py`), `docs/PRD-mission-control-hermes.md` (F-CONN-7 built, v2 list, risk row), `docs/manual-vps-checklist.md` (steps 151-154), `CLAUDE.md` (one paragraph), the spec (`-o IdentityFile` instead of `-i`, `stat` instead of `lstat`)

- [ ] **Step 1:** Mockup: state `auth` (`'password'`), `setPw` / `setKey` handlers, `isKey` / `isPw` booleans and `pwPressed` / `keyPressed` strings from `renderVals`; key row shows `id_ed25519 · ED25519 SHA256:p2Qy…Lw4` with **Change** and a passphrase field. Rebuild with `python mockup/build.py`.
- [ ] **Step 2:** Docs as listed.
- [ ] **Step 3:** Full run: `npm run typecheck`, `npm test`, `npm run test:py`, `npm run test:e2e`. Fix anything that fails.
- [ ] **Step 4: Commit** `docs: SSH key login in the PRD, checklist, CLAUDE.md and the Connect mockup`.
