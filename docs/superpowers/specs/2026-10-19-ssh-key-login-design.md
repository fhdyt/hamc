# SSH key login (F-CONN-7, moved up from v2)

## Goal

Let the user log in to the VPS with an SSH private key instead of a password (PRD F-CONN-7, risk table §11: password
logins on a public IP invite brute force). One connection uses one method, chosen in the connection form.

## Decisions

- Key source: **a file only**, picked with the native open dialog. The app stores the path and reads the file on every
  connect; the key is never copied into `app.db`. No ssh-agent / Pageant support.
- Passphrase: treated like the password today. With "remember" on and a usable keychain it is encrypted through
  `safeStorage`; without a keychain the other fields are remembered and only the passphrase is asked for on launch
  (F-CONN-4, F-CONN-12).
- Method: **one per connection** (Password or Private key). Only that method's secret is stored; switching methods
  drops the old secret. No "try the key, then the password".
- Approach A: main owns the dialog and remembers the picked path. The renderer can only send back that path or the
  saved one, as with uploads; the key's contents never reach the renderer.

## Rules

- Zero-Change holds: the app never installs the public key on the VPS, never edits `~/.ssh/authorized_keys`, and the
  form says the key must already be authorized there.
- The key's contents and the passphrase are never logged and never leave the main process. `app.log` gets
  `auth: key <type> <fingerprint>` or `auth: password`.
- `~/.ssh` is only read for the file the user picked; nothing there is written.

## Data

- `app.db` migration 5:
  `ALTER TABLE connections ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'password'; ALTER TABLE connections ADD COLUMN key_path TEXT;`
  `password_enc` stays and holds the secret of the active method (password or passphrase), so existing installs keep
  working unchanged.
- `SavedConnection`: `hasPassword` becomes `hasSecret`, plus `authMethod: 'password' | 'key'`, `keyPath: string | null`
  and `keyInfo: KeyInfo | null` (worked out from the file when the saved connection is read; null when the file is
  gone).
- `UpsertConnection`: `authMethod`, `keyPath`, `secretEnc`. A change of method or of key path clears the stored secret
  unless a new one is given. `forgetConnection` clears all of it, as today.

## Contract (`src/shared/ipc.ts`)

- `ConnectRequestSchema` gains `auth: z.enum(['password', 'key']).default('password')`, `keyPath: z.string().max(4096).optional()`
  and `passphrase: z.string().max(1024).optional()`. `password` stays.
- `KeyInfo = { path, name, type, fingerprint, encrypted }`: `name` is the file name, `type` is `ED25519 | ECDSA | RSA | DSA`,
  `fingerprint` is `SHA256:…` of the public part (same format as the host key fingerprint).
- `PickKeyResult = { ok: true; key: KeyInfo } | { ok: false; reason: 'cancelled' | 'unreadable' | 'not-a-key' | 'ppk3' | 'too-big'; message?: string }`.
- Channel `mc:conn:pick-key`, `MissionApi.pickKey()`.

## Main process

- `src/main/connection/keyFile.ts` (new, pure where possible):
  - `readKeyFile(path)`: `lstat` must be a regular file of at most 64 KiB, then read.
  - `inspectKey(buf, passphrase?)` with ssh2 `utils.parseKey`. Results: ok (type, public fingerprint, encrypted),
    `needs-passphrase`, `bad-passphrase`, `ppk3` (a `PuTTY-User-Key-File-3` header: "Export it from PuTTYgen as an
    OpenSSH key (Conversions → Export OpenSSH key)."), `not-a-key`. ssh2 refuses an encrypted key without its passphrase,
    so for an encrypted OpenSSH key the type and fingerprint come from the public key in the file's unencrypted header
    (`openssh-key-v1`, cipher, kdf, kdf options, count, then the public key string), parsed by `keyFile.ts` itself. An
    encrypted PEM or PPK v2 key shows `encrypted` with no fingerprint; the fingerprint appears after the first
    successful connect.
  - `KeyPicks`: the set of paths returned by the dialog in this run. `allowedKeyPath(path, saved)` is true only for one
    of those or the saved `key_path`.
- `ConnectParams` becomes `{ host, port, username } & ({ password: string } | { privateKey: Buffer; passphrase?: string })`.
  `ConnectionManager.connect` passes `password` or `privateKey`/`passphrase` to ssh2 and nothing else (no
  `tryKeyboard`, no agent).
- `MissionSession.connect`, key branch:
  1. `keyPath` from the request (checked with `allowedKeyPath`) or the saved one for the same target. Missing →
     `auth` "Choose the key file."
  2. Passphrase from the request, else the keychain (same target and same key path), else the pending credentials of a
     host key prompt.
  3. `readKeyFile` + `inspectKey` before the handshake. Each failure is a `ConnectResult` of kind `auth` with its own
     message: "The key file was not found: <path>", "This key needs its passphrase.", "The passphrase is wrong.", the
     PPK v3 text, "This file is not a private key." The startup step `credentials` shows `key <name>` or the reason.
  4. A server that refuses the key (`All configured authentication methods failed`) is `auth` with "The server refused
     this key. Check that its public key is in ~/.ssh/authorized_keys of <user>." `classifyConnectError` /
     `friendlyMessage` get the method.
  5. `params` keeps the key buffer and passphrase in memory for reconnects (as the password today); `pending` (host key
     prompt) keeps them for 5 minutes like the password.
  6. On success `upsertConnection` stores `auth_method`, `key_path` and the encrypted passphrase (only when the key is
     encrypted, remember is on and the keychain is available).
- `launchOutcome`: `auth` already opens Edit connection; nothing changes there.
- IPC `mc:conn:pick-key`: `dialog.showOpenDialog` with `openFile` and `showHiddenFiles`, default folder `~/.ssh` when it
  exists, no extension filter (key files usually have none). The picked file is inspected; only `KeyInfo` goes back.

## Terminal (system ssh server tabs)

- `SshTarget` gains `identity?: string`. `ConnectionManager.sshTarget()` fills it with the key path when the connection
  used a key that OpenSSH can read (not PPK).
- `sshArgs` adds `-i <sshConfigPath(identity)> -o IdentitiesOnly=yes` when `identity` is set. A passphrase is asked by
  ssh itself and typed by the user; the app still never types into a shell.
- A connection with a PPK key opens server tabs with the built-in ssh2 shell (as when no `ssh` is found), and the tab
  says why once: "This key is in PuTTY format, which the system ssh cannot read: using the built-in shell."

## Renderer

- `lib/connectForm.ts`: `FormValues` gains `auth`, `keyPath`, `keyEncrypted`, `passphrase`, `hasSavedSecret`,
  `sameKey`. Key mode needs a key (`field: 'key'`, "Choose the key file.") and, for an encrypted key, a passphrase
  unless one is saved for the same target and key (`field: 'passphrase'`).
- `ConnectionForm.tsx`: a two-button radio group **Password | Private key** (`role="radiogroup"`, arrow keys) above the
  secret field, defaulting to the saved method.
  - Password mode is the form of today.
  - Key mode: **Choose key file…** (calls `pickKey`), then a line with the file name, `ED25519 SHA256:…` and **Change**;
    a dialog error shows under it. The passphrase field appears only for an encrypted key, with the hint "(leave empty
    to keep the saved passphrase)" in edit mode when one is saved.
  - Help text in key mode: "The public key must already be in ~/.ssh/authorized_keys on the server. The app does not
    add it." The remember label says `(password → OS keychain)` or `(passphrase → OS keychain)`; for a key without a
    passphrase it says nothing about the keychain.
- `EditConnectionDialog.tsx` uses the same form; changing method there and pressing Test & save reconnects with it.
- Mockup: `mockup/src/Connect.dc.html` gets the method switch and the key row (then `python mockup/build.py`).

## Not done

- ssh-agent, Pageant, hardware keys, certificates (`-cert.pub`), keyboard-interactive / 2FA.
- Copying the key into the app, generating keys, or installing the public key on the server.
- Password as a fallback after a refused key.

## Tests

- Unit: `keyFile` (ed25519 / ecdsa / rsa OpenSSH, encrypted OpenSSH with right and wrong passphrase, PEM RSA, PPK v2,
  PPK v3, a random file, a file over 64 KiB, a directory), `allowedKeyPath`, `connectForm` key rules, `sshArgs` with
  and without `identity`, `settingsStore` migration 5 (an old row reads as `password`) and the method switch clearing
  the secret. Test keys are generated in the test with `ssh2 utils.generateKeyPairSync` (no keys checked into the
  repo, except a fixed PPK v3 text that only needs its header).
- Integration (`tests/integration/session.test.ts` against `fakeSshServer`, which gains `publicKey` in its options and
  accepts `publickey` auth with signature check): key connect, saved passphrase reused on reconnect and on a new
  `connect` with `useSaved`, refused key gives `auth` with the refused text, the key path from the renderer that was
  neither picked nor saved is refused, nothing of the key or passphrase in `app.log`.
- E2E (`tests/e2e/connect.spec.ts`): the open dialog is a dependency like `SessionDeps.saveDialog` (new
  `openKeyDialog`). `index.ts` replaces it when `MC_E2E_KEY_FILE` is set (the E2E helper sets it to a key written in
  the test's temp folder); the variable only chooses which file the "dialog" returns, so it widens nothing an
  environment variable could not already do; connect with an unencrypted ed25519 key, then relaunch and
  auto-connect; an encrypted key asks for the passphrase and auto-connects after relaunch; a refused key opens Edit
  connection on launch.
- Manual VPS checklist steps 151-154: key login with ed25519 without and with passphrase, a refused key, a server tab
  in the terminal using the same key, and `~/.ssh/authorized_keys` unchanged by the app.

## Docs

- PRD: F-CONN-7 marked built (P2 → done), the v2 candidate list loses "Login SSH key", §11 risk row points to it.
- CLAUDE.md: one paragraph under the M1 notes; `docs/release.md` unchanged.
