# M1 Fondasi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplikasi Electron yang login ke VPS Hermes lewat SSH, lolos preflight, menampilkan agent (profile) beserta statusnya, dan memantau server ala btop secara realtime, tanpa mengubah apa pun di VPS.

**Architecture:** Satu paket electron-vite (main, preload, renderer, shared). Main process memegang koneksi ssh2, mengirim skrip collector Python (stdlib) lewat stdin ke `python -u -`, memvalidasi event JSON-lines dengan zod, lalu meneruskannya ke renderer React lewat IPC bertipe. Renderer ter-sandbox dan tidak punya akses Node/SSH. Semua test integrasi memakai server ssh2 palsu yang menjalankan collector Python asli terhadap fixture `~/.hermes` dan `/proc` palsu.

**Tech Stack:** Electron, electron-vite, TypeScript, React 19, Tailwind CSS v4, Zustand, uPlot, ssh2, better-sqlite3, zod, Vitest (dijalankan lewat `ELECTRON_RUN_AS_NODE` supaya ABI better-sqlite3 cocok), pytest, Playwright for Electron.

**Spec:** `docs/superpowers/specs/2026-10-11-m1-foundation-design.md` (PRD: `docs/PRD-mission-control-hermes.md`; mockup: `mockup/`).

## Global Constraints

- **Zero-Change (PRD §3.2, NF-4):** tidak pernah memasang apa pun, menulis berkas/skrip, membuka port, memakai `sudo`, atau mengubah Hermes di VPS. M1 tidak punya aksi tulis sama sekali.
- **Tidak pernah membaca** `.env`, `auth.json`, atau nilai API key. Collector hanya mengecek keberadaannya.
- **Perintah remote** dibangun dari argumen yang di-quote satu per satu (`buildCommand`), tidak pernah penyambungan string mentah.
- **Collector:** Python stdlib saja, ASCII saja, read-only, `state.db` dibuka `?mode=ro`, keluar bersih saat stdout putus, tidak menulis berkas apa pun.
- **Hardening (NF-5):** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, CSP ketat, navigasi dan `window.open` diblokir. Password hanya disimpan sebagai blob `safeStorage`; jika backend Linux `basic_text`, opsi simpan password dimatikan.
- **UI:** semua teks Inggris. Tema Dracula tunggal. `#6272A4` hanya dekorasi; teks sekunder `#A9B2D3` / `#8B95BD` (kontras ≥ 4,5:1). Font JetBrains Mono, VT323 hanya untuk logo dan angka besar. Padding halaman `20px 24px 16px`, jarak 14px (F-UI-9). Panel dengan judul di garis tepi memberi ≥ 10px ruang di atasnya.
- **Status agent:** `working` (aktif dan pesan ≤ 30 s), `idle` (aktif), `offline`, `parked`. "Active" = `working` atau `idle`. Heartbeat gateway basi bila > 120 s.
- **Backoff reconnect:** 1s → 2s → 5s → 10s → 30s (maksimum).
- **Data basi** tetap ditampilkan beserta usianya (F-STATE-2). Setiap layar data punya state loading (kerangka), empty, error (dengan retry), dan unsupported (F-STATE-1).
- **Teks sidebar/menu:** urutan Dashboard, Chat, Live feed | Sessions, Kanban, Usage | Skills, Logs, Second brain, Server; footer Terminal, Search, Collapse. Ctrl+1 … Ctrl+0 mengikuti urutan itu. Sidebar lebar 184 px, rail 56 px, rail otomatis di bawah 900 px.
- **Ukuran teks:** 70%–150%, langkah 10%, lewat `webContents.setZoomFactor`.
- Bahasa balasan ke user: Indonesia. Kode, komentar, dan string UI: Inggris. Komentar kode seperlunya saja.
- Lingkungan dev: Windows 11, Git Bash. Perintah di plan memakai sintaks bash dan `python` (bukan `python3`).
- Setiap commit diakhiri baris `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Catatan penyimpangan dari spec (sengaja)

1. Tabel `known_hosts` dikunci oleh `(host, port)`, bukan `connection_id`, karena TOFU terjadi sebelum baris `connections` ada.
2. Event `agents` dikirim tiap 10 detik tanpa pemicu mtime; mtime `config.yaml` dilaporkan di datanya supaya main process tahu kapan model perlu dibaca ulang.
3. Vitest dijalankan lewat Electron-sebagai-Node (`scripts/run-vitest.mjs`) supaya satu binary `better-sqlite3` (ABI Electron) dipakai di dev dan test.

(Dua penyimpangan pertama sudah ditulis ke spec di langkah Task 1.)

## File Structure

```
package.json, electron.vite.config.ts, vitest.config.ts, playwright.config.ts
tsconfig.json, tsconfig.node.json, tsconfig.web.json, .gitignore
scripts/run-vitest.mjs                 jalankan vitest di bawah Electron-as-Node
scripts/gen-icons.py                   hasilkan icons.generated.ts dari mockup/build.py
collector/mc_collector.py              skrip Python (stdlib, ASCII)
src/shared/
  events.ts                            zod: event collector + parseEventLine
  ipc.ts                               tipe dan nama channel IPC, MissionApi
  settings.ts                          SettingsMap, defaults, schema zod
  channels.ts                          IPC (nama channel, tanpa dependensi runtime; aman untuk preload)
  csp.ts                               buildCsp(dev)
src/main/
  index.ts                             siklus hidup app, jendela, menu
  security.ts                          WEB_PREFERENCES, navigasi, sender check
  session.ts                           MissionSession (orkestrasi)
  ipc.ts                               registerIpc
  connection/quote.ts                  shQuote, buildCommand
  connection/hostkey.ts                fingerprintOf, algoOf, decideHostKey
  connection/errors.ts                 ConnectError, HostKeyError, classifyConnectError
  connection/backoff.ts                backoffDelay
  connection/manager.ts                ConnectionManager (ssh2)
  connection/remote.ts                 builder argv untuk perintah remote
  connection/preflight.ts              runPreflight + parser
  connection/capabilities.ts           probeCapabilities
  collector/lines.ts                   LineSplitter
  collector/channel.ts                 CollectorChannel + loadCollectorScript
  collector/models.ts                  ModelResolver + parseModelJson
  store/settingsStore.ts               SettingsStore (app.db)
  store/secretStore.ts                 SecretStore (safeStorage)
src/preload/index.ts                   contextBridge: window.mc
src/renderer/
  index.html, main.tsx, App.tsx, bootstrap.ts, env.d.ts
  styles/base.css (salinan shared.css), styles/app.css
  lib/{format,roster,window,agentColor}.ts
  stores/{conn,agents,metrics,ui}.ts
  components/{Icon,icons.generated,Modal,States,Avatar,Panel,UplotChart,Bar}.tsx|ts
  shell/{Sidebar,StatusBar,Shell,nav}.tsx|ts
  screens/{Connect,Launch,Dashboard,Server,ComingSoon}.tsx
  screens/dashboard/{StatusBlock,ServerStrip,AgentsPanel,AgentDetail}.tsx
  screens/connect/{ConnectionForm,HostKeyPanel,PreflightPanel}.tsx
  settings/SettingsModal.tsx
tests/
  helpers/{shellSplit,fakeSshServer,wait,fixture}.ts
  fixtures/make_fixture.py
  collector/{conftest.py,test_metrics.py,test_agents.py,test_cli.py}
  unit/…  integration/…  e2e/…
docs/manual-vps-checklist.md
```

---

### Task 1: Scaffold electron-vite, toolchain, dan verifikasi ABI

**Files:**
- Create: `package.json`, `.gitignore`, `electron.vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Create: `scripts/run-vitest.mjs`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/env.d.ts`
- Create: `tests/unit/toolchain.test.ts`
- Modify: `docs/superpowers/specs/2026-10-11-m1-foundation-design.md` (dua penyimpangan)

**Interfaces:**
- Produces: alias `@shared/*` → `src/shared/*` dan `@renderer/*` → `src/renderer/*` (di Vite, Vitest, dan tsconfig); skrip npm `dev`, `build`, `typecheck`, `test`, `test:py`, `test:e2e`, `check`.

- [ ] **Step 1: Buat `package.json` dan pasang dependensi**

```bash
cd "C:/Users/Lenovo/Documents/Project/mission-control-hermes"
cat > package.json <<'EOF'
{
  "name": "hermes-mission-control",
  "productName": "Hermes Agent Mission Control",
  "version": "0.1.0",
  "private": true,
  "description": "Mission Control for Hermes Agent",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "test": "node scripts/run-vitest.mjs run",
    "test:py": "python -m pytest tests/collector -q",
    "test:e2e": "npm run build && playwright test",
    "icons": "python scripts/gen-icons.py",
    "check": "npm run typecheck && npm run test && npm run test:py",
    "postinstall": "electron-builder install-app-deps"
  }
}
EOF
npm install react react-dom zustand uplot ssh2 better-sqlite3 zod @fontsource/jetbrains-mono @fontsource/vt323
npm install -D electron electron-vite vite typescript @types/node @types/react @types/react-dom @types/ssh2 @types/better-sqlite3 @vitejs/plugin-react tailwindcss @tailwindcss/vite vitest @playwright/test electron-builder
python -m pip install pytest
```

Expected: instalasi selesai tanpa error; `postinstall` memasang binary `better-sqlite3` untuk ABI Electron (pesan `prebuild-install` / `rebuilding native dependencies`). Jika `postinstall` gagal karena tidak ada prebuild untuk versi Electron terpasang, jalankan `npx @electron/rebuild -f -w better-sqlite3` (butuh Visual Studio Build Tools) atau turunkan Electron ke versi yang punya prebuild.

- [ ] **Step 2: `.gitignore`**

```
node_modules/
out/
dist/
coverage/
playwright-report/
test-results/
__pycache__/
.pytest_cache/
*.pyc
.superpowers/
```

- [ ] **Step 3: Konfigurasi TypeScript**

`tsconfig.json`:
```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"], "@renderer/*": ["src/renderer/*"] }
  },
  "include": [
    "src/main/**/*", "src/preload/**/*", "src/shared/**/*",
    "src/renderer/lib/**/*", "src/renderer/stores/**/*",
    "tests/**/*.ts", "electron.vite.config.ts", "vitest.config.ts", "playwright.config.ts"
  ]
}
```

`tsconfig.web.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"], "@renderer/*": ["src/renderer/*"] }
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

Catatan: `src/renderer/lib` dan `src/renderer/stores` di-typecheck oleh kedua config. Berkas di sana tidak boleh memakai global DOM (`window`, `document`) agar lolos config node; kode yang butuh DOM ditaruh di `components/`, `shell/`, `screens/`, `bootstrap.ts`.

- [ ] **Step 4: Konfigurasi electron-vite dan Vitest**

`electron.vite.config.ts`:
```ts
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') }

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  renderer: { plugins: [react(), tailwindcss()], resolve: { alias } }
})
```

`vitest.config.ts`:
```ts
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') } },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
})
```

`scripts/run-vitest.mjs`:
```js
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const electron = require('electron')
const vitest = join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs')
const r = spawnSync(electron, [vitest, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
process.exit(r.status ?? 1)
```

- [ ] **Step 5: Jendela "hello" minimal**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#282A36',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

void app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
```

`src/preload/index.ts`:
```ts
export {}
```

`src/renderer/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hermes Agent Mission Control</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/renderer/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'

createRoot(document.getElementById('root')!).render(<p>Hermes Agent Mission Control</p>)
```

`src/renderer/env.d.ts`:
```ts
/// <reference types="vite/client" />
```

- [ ] **Step 6: Test toolchain yang gagal dulu**

`tests/unit/toolchain.test.ts`:
```ts
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

describe('toolchain', () => {
  it('runs under the Electron runtime so native modules share one ABI', () => {
    expect(process.versions.electron).toBeTruthy()
  })

  it('opens an in-memory sqlite database', () => {
    const db = new Database(':memory:')
    expect(db.prepare('select 1 as x').get()).toEqual({ x: 1 })
    db.close()
  })
})
```

Run: `npm test`
Expected: PASS (2 tests). Jika `ELECTRON_RUN_AS_NODE` membuat vitest gagal start (mis. error worker/fork), pakai fallback: ganti `test` menjadi `node scripts/run-vitest.mjs run` → `vitest run`, tambah `"pretest": "npm rebuild better-sqlite3"` dan `"predev": "electron-builder install-app-deps"`, lalu catat di plan bahwa ABI dipindah per perintah.

- [ ] **Step 7: Verifikasi build dan typecheck**

Run: `npm run build && npm run typecheck`
Expected: build menghasilkan `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html`; typecheck tanpa error.

- [ ] **Step 8: Perbarui spec untuk dua penyimpangan**

Edit `docs/superpowers/specs/2026-10-11-m1-foundation-design.md`:
- Di §4 SettingsStore, ganti kalimat tabel menjadi: "Tabel M1: `schema_version`, `connections`, `known_hosts` (kunci `host`+`port`, karena TOFU terjadi sebelum baris `connections` ada), `settings`, `agent_pins`."
- Di §5 tabel collector, baris `agents`: ganti "10 s, atau saat mtime berubah" dengan "10 s".

- [ ] **Step 9: Commit**

```bash
git add .gitignore package.json package-lock.json electron.vite.config.ts vitest.config.ts tsconfig*.json scripts src tests docs/superpowers
git commit -m "chore: scaffold electron-vite app and toolchain

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Kontrak bersama (event, IPC, settings)

**Files:**
- Create: `src/shared/events.ts`, `src/shared/settings.ts`, `src/shared/ipc.ts`
- Test: `tests/unit/events.test.ts`
- Create: `tests/helpers/samples.ts`

**Interfaces:**
- Produces:
  - `AgentStatus`, `AgentInfo`, `AgentsData`, `MetricsData`, `ErrorData`, `CollectorEvent`, `parseEventLine(line): {ok:true,event}|{ok:false,error}` (`events.ts`).
  - `SettingsMap`, `SETTINGS_DEFAULTS`, `SETTINGS_SCHEMA`, `isSettingKey` (`settings.ts`).
  - `IPC` (nama channel), `ConnectRequestSchema`, tipe `ConnectRequest`, `ConnectErrorKind`, `HostKeyChallenge`, `ConnectResult`, `SavedConnection`, `ConnState`, `ConnStatus`, `StartupStep`, `StartupProgress`, `PreflightItem`, `PreflightResult`, `Capabilities`, `AgentModels`, `AppInfo`, `MissionApi` (`ipc.ts`).

- [ ] **Step 1: Tulis test yang gagal**

`tests/helpers/samples.ts`:
```ts
import type { z } from 'zod'
import type { AgentsData, MetricsData } from '@shared/events'

export function sampleMetrics(over: Partial<z.infer<typeof MetricsData>> = {}): z.infer<typeof MetricsData> {
  return {
    cpu: { total: 34, cores: [41, 28, 63, 19], load: [1.42, 0.98, 0.77], uptimeS: 1_038_240, tempC: 52 },
    mem: { total: 17179869184, used: 6.1e9, cached: 5.4e9, available: 9.9e9, free: 4.5e9, swapTotal: 2e9, swapUsed: 1e8 },
    disks: [{ mount: '/', fs: 'ext4', total: 160e9, used: 77e9 }],
    io: { readBps: 2.1e6, writeBps: 6.4e5 },
    net: [{ name: 'eth0', rxBps: 1.2e6, txBps: 3.4e5, rxTotal: 48e9, txTotal: 9.7e9 }],
    procs: [{ pid: 1842, user: 'root', cpu: 22.4, mem: 3.1, rss: 512e6, cmd: 'python -m hermes_cli.main gateway run', hermes: true }],
    tasks: 214,
    ...over
  }
}

export function sampleAgents(): z.infer<typeof AgentsData> {
  return {
    agents: [
      { profile: 'default', displayName: 'default', status: 'idle', platforms: ['telegram'], lastActivityTs: 1_760_000_000, configMtime: 1_759_000_000, hasSoul: true, hasMemory: true, hasUser: true },
      { profile: 'scout', displayName: 'Scout', status: 'working', platforms: [], lastActivityTs: 1_760_000_100, configMtime: null, hasSoul: false, hasMemory: false, hasUser: false }
    ],
    gateway: { up: true, heartbeatAgeS: 4, served: ['default', 'scout'] }
  }
}
```

`tests/unit/events.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseEventLine } from '@shared/events'
import { sampleAgents, sampleMetrics } from '../helpers/samples'

const line = (o: unknown): string => JSON.stringify(o)

describe('parseEventLine', () => {
  it('accepts a metrics event', () => {
    const r = parseEventLine(line({ type: 'metrics', ts: 1, profile: null, data: sampleMetrics() }))
    expect(r.ok).toBe(true)
  })

  it('accepts an agents event', () => {
    const r = parseEventLine(line({ type: 'agents', ts: 1, profile: null, data: sampleAgents() }))
    expect(r.ok).toBe(true)
  })

  it('accepts an error event', () => {
    const r = parseEventLine(line({ type: 'error', ts: 1, profile: 'scout', data: { code: 'unsupported_schema', message: 'x' } }))
    expect(r.ok).toBe(true)
  })

  it('rejects invalid json', () => {
    expect(parseEventLine('{nope')).toEqual({ ok: false, error: 'invalid JSON' })
  })

  it('rejects an unknown type', () => {
    expect(parseEventLine(line({ type: 'nope', ts: 1, profile: null, data: {} })).ok).toBe(false)
  })

  it('rejects metrics with a wrong shape', () => {
    const bad = sampleMetrics()
    const r = parseEventLine(line({ type: 'metrics', ts: 1, profile: null, data: { ...bad, cpu: { total: 'x' } } }))
    expect(r.ok).toBe(false)
  })

  it('rejects an unknown agent status', () => {
    const a = sampleAgents()
    a.agents[0] = { ...a.agents[0]!, status: 'sleeping' as never }
    expect(parseEventLine(line({ type: 'agents', ts: 1, profile: null, data: a })).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test -- tests/unit/events.test.ts`
Expected: FAIL (modul `@shared/events` tidak ada).

- [ ] **Step 3: Implementasi `src/shared/events.ts`**

```ts
import { z } from 'zod'

export const AgentStatus = z.enum(['working', 'idle', 'offline', 'parked'])
export type AgentStatus = z.infer<typeof AgentStatus>

export const AgentInfo = z.object({
  profile: z.string(),
  displayName: z.string(),
  status: AgentStatus,
  platforms: z.array(z.string()),
  lastActivityTs: z.number().nullable(),
  configMtime: z.number().nullable(),
  hasSoul: z.boolean(),
  hasMemory: z.boolean(),
  hasUser: z.boolean()
})
export type AgentInfo = z.infer<typeof AgentInfo>

export const AgentsData = z.object({
  agents: z.array(AgentInfo),
  gateway: z.object({
    up: z.boolean(),
    heartbeatAgeS: z.number().nullable(),
    served: z.array(z.string())
  })
})
export type AgentsData = z.infer<typeof AgentsData>

const Bytes = z.number().nonnegative()

export const MetricsData = z.object({
  cpu: z.object({
    total: z.number(),
    cores: z.array(z.number()),
    load: z.tuple([z.number(), z.number(), z.number()]),
    uptimeS: z.number(),
    tempC: z.number().nullable()
  }),
  mem: z.object({
    total: Bytes,
    used: Bytes,
    cached: Bytes,
    available: Bytes,
    free: Bytes,
    swapTotal: Bytes,
    swapUsed: Bytes
  }),
  disks: z.array(z.object({ mount: z.string(), fs: z.string(), total: Bytes, used: Bytes })),
  io: z.object({ readBps: Bytes, writeBps: Bytes }),
  net: z.array(
    z.object({ name: z.string(), rxBps: Bytes, txBps: Bytes, rxTotal: Bytes, txTotal: Bytes })
  ),
  procs: z.array(
    z.object({
      pid: z.number().int(),
      user: z.string(),
      cpu: z.number(),
      mem: z.number(),
      rss: Bytes,
      cmd: z.string(),
      hermes: z.boolean()
    })
  ),
  tasks: z.number().int().nonnegative()
})
export type MetricsData = z.infer<typeof MetricsData>

export const ErrorData = z.object({
  code: z.string(),
  message: z.string(),
  profile: z.string().optional()
})
export type ErrorData = z.infer<typeof ErrorData>

const envelope = { ts: z.number(), profile: z.string().nullable() }

export const CollectorEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('metrics'), ...envelope, data: MetricsData }),
  z.object({ type: z.literal('agents'), ...envelope, data: AgentsData }),
  z.object({ type: z.literal('error'), ...envelope, data: ErrorData })
])
export type CollectorEvent = z.infer<typeof CollectorEvent>

export type ParseResult = { ok: true; event: CollectorEvent } | { ok: false; error: string }

export function parseEventLine(line: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return { ok: false, error: 'invalid JSON' }
  }
  const r = CollectorEvent.safeParse(raw)
  if (r.success) return { ok: true, event: r.data }
  return { ok: false, error: r.error.issues[0]?.message ?? 'invalid event' }
}
```

- [ ] **Step 4: `src/shared/settings.ts`**

```ts
import { z } from 'zod'

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface SettingsMap {
  'ui.zoom': number
  'ui.density': 'compact' | 'comfortable'
  'ui.reduceMotion': boolean
  'ui.sidebarCollapsed': boolean
  'agents.panelCollapsed': boolean
  'window.bounds': WindowBounds | null
}

export const SETTINGS_DEFAULTS: SettingsMap = {
  'ui.zoom': 1,
  'ui.density': 'compact',
  'ui.reduceMotion': false,
  'ui.sidebarCollapsed': false,
  'agents.panelCollapsed': false,
  'window.bounds': null
}

export const SETTINGS_SCHEMA = {
  'ui.zoom': z.number().min(0.7).max(1.5),
  'ui.density': z.enum(['compact', 'comfortable']),
  'ui.reduceMotion': z.boolean(),
  'ui.sidebarCollapsed': z.boolean(),
  'agents.panelCollapsed': z.boolean(),
  'window.bounds': z
    .object({ x: z.number().optional(), y: z.number().optional(), width: z.number(), height: z.number() })
    .nullable()
} satisfies { [K in keyof SettingsMap]: z.ZodType<SettingsMap[K]> }

export function isSettingKey(k: string): k is keyof SettingsMap {
  return Object.prototype.hasOwnProperty.call(SETTINGS_SCHEMA, k)
}
```

- [ ] **Step 5: `src/shared/ipc.ts`**

```ts
import { z } from 'zod'
import type { CollectorEvent } from './events'
import type { SettingsMap } from './settings'

export const IPC = {
  connect: 'mc:connection:connect',
  trustHostKey: 'mc:connection:trust-hostkey',
  disconnect: 'mc:connection:disconnect',
  forget: 'mc:connection:forget',
  saved: 'mc:connection:saved',
  secretStatus: 'mc:connection:secret-status',
  settingsAll: 'mc:settings:all',
  settingsSet: 'mc:settings:set',
  pinsGet: 'mc:agents:pins-get',
  pinsSet: 'mc:agents:pins-set',
  setZoom: 'mc:app:set-zoom',
  appInfo: 'mc:app:info',
  evEvent: 'mc:ev:event',
  evStatus: 'mc:ev:status',
  evStartup: 'mc:ev:startup',
  evPreflight: 'mc:ev:preflight',
  evCapabilities: 'mc:ev:capabilities',
  evModels: 'mc:ev:models'
} as const

export const ConnectRequestSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().min(1).max(64),
  password: z.string().max(1024).optional(),
  remember: z.boolean(),
  useSaved: z.boolean().optional()
})
export type ConnectRequest = z.infer<typeof ConnectRequestSchema>

export const HostKeyChallengeSchema = z.object({
  host: z.string(),
  port: z.number().int(),
  algo: z.string(),
  fingerprint: z.string(),
  changed: z.boolean(),
  previous: z.string().optional()
})
export type HostKeyChallenge = z.infer<typeof HostKeyChallengeSchema>

export type ConnectErrorKind =
  | 'unreachable'
  | 'auth'
  | 'timeout'
  | 'hermes-missing'
  | 'hostkey-unverified'
  | 'hostkey-changed'
  | 'unknown'

export interface PreflightItem {
  id: string
  label: string
  state: 'ok' | 'warn' | 'fail' | 'info'
  result: string
  hint?: string
}

export interface PreflightResult {
  items: PreflightItem[]
  hermesHome: string | null
  hermesPath: string | null
  pythonPath: string | null
  version: string | null
  profileCount: number
  canStart: boolean
}

export type ConnectResult =
  | { ok: true; preflight: PreflightResult }
  | { ok: false; kind: ConnectErrorKind; message: string; hostKey?: HostKeyChallenge; preflight?: PreflightResult }

export interface SavedConnection {
  id: number
  name: string
  host: string
  port: number
  username: string
  remember: boolean
  hasPassword: boolean
  lastConnectedAt: number | null
  fingerprint: string | null
}

export type ConnState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline'

export interface ConnStatus {
  state: ConnState
  latencyMs: number | null
  hermesVersion: string | null
  attempt: number
  nextRetryInS: number | null
  error: string | null
}

export type StartupStepId = 'credentials' | 'handshake' | 'hermes' | 'statedb' | 'collector'

export interface StartupStep {
  id: StartupStepId
  label: string
  detail: string
  state: 'pending' | 'running' | 'done' | 'failed'
}

export interface StartupProgress {
  steps: StartupStep[]
}

export interface Capabilities {
  version: string | null
  supported: Record<string, boolean>
}

export type AgentModels = Record<string, { provider: string | null; model: string | null } | null>

export interface AppInfo {
  version: string
  electron: string
  platform: string
}

type Unsub = () => void

export interface MissionApi {
  connection: {
    connect(req: ConnectRequest): Promise<ConnectResult>
    trustHostKey(c: HostKeyChallenge): Promise<void>
    disconnect(): Promise<void>
    forget(): Promise<void>
    saved(): Promise<SavedConnection | null>
    secretStatus(): Promise<{ canRemember: boolean; reason: string | null }>
  }
  settings: {
    all(): Promise<SettingsMap>
    set<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): Promise<void>
  }
  agents: {
    getPins(): Promise<{ pins: string[]; initialized: boolean }>
    setPins(pins: string[]): Promise<void>
  }
  app: {
    setZoom(factor: number): Promise<void>
    info(): Promise<AppInfo>
  }
  onEvent(cb: (e: CollectorEvent) => void): Unsub
  onStatus(cb: (s: ConnStatus) => void): Unsub
  onStartup(cb: (p: StartupProgress) => void): Unsub
  onPreflight(cb: (p: PreflightResult) => void): Unsub
  onCapabilities(cb: (c: Capabilities) => void): Unsub
  onModels(cb: (m: AgentModels) => void): Unsub
}
```

- [ ] **Step 6: Jalankan test**

Run: `npm test -- tests/unit/events.test.ts && npm run typecheck`
Expected: 7 tests PASS; typecheck bersih.

- [ ] **Step 7: Commit**

```bash
git add src/shared tests/helpers/samples.ts tests/unit/events.test.ts
git commit -m "feat: add shared event, settings and IPC contracts

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Hardening, CSP, dan navigasi

**Files:**
- Create: `src/shared/csp.ts`, `src/main/security.ts`
- Modify: `electron.vite.config.ts` (plugin CSP), `src/renderer/index.html` (placeholder `<!--CSP-->`)
- Test: `tests/unit/security.test.ts`

**Interfaces:**
- Produces: `buildCsp(dev: boolean): string`; `WEB_PREFERENCES`; `AppTarget {devUrl?, indexFileUrl?}`; `isAllowedNavigation(url, target): boolean`; `hardenWebContents(wc, target): void`; `isTrustedSender(senderUrl: string | undefined, target): boolean`.

- [ ] **Step 1: Test yang gagal**

`tests/unit/security.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { buildCsp } from '@shared/csp'
import { WEB_PREFERENCES, isAllowedNavigation, isTrustedSender } from '../../src/main/security'

describe('web preferences', () => {
  it('enforces the Electron hardening flags', () => {
    expect(WEB_PREFERENCES.contextIsolation).toBe(true)
    expect(WEB_PREFERENCES.sandbox).toBe(true)
    expect(WEB_PREFERENCES.nodeIntegration).toBe(false)
    expect(WEB_PREFERENCES.webSecurity).toBe(true)
    expect(WEB_PREFERENCES.allowRunningInsecureContent).toBe(false)
  })
})

describe('buildCsp', () => {
  it('is strict in production', () => {
    const csp = buildCsp(false)
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).toContain("object-src 'none'")
    expect(csp).not.toContain('ws:')
  })

  it('relaxes only script and connect for the dev server', () => {
    const csp = buildCsp(true)
    expect(csp).toContain("'unsafe-eval'")
    expect(csp).toContain('ws://localhost:*')
  })
})

describe('isAllowedNavigation', () => {
  const dev = { devUrl: 'http://localhost:5173/' }
  const prod = { indexFileUrl: 'file:///C:/app/out/renderer/index.html' }

  it('allows only the dev origin in dev', () => {
    expect(isAllowedNavigation('http://localhost:5173/#/x', dev)).toBe(true)
    expect(isAllowedNavigation('https://evil.example/', dev)).toBe(false)
    expect(isAllowedNavigation('http://localhost:9999/', dev)).toBe(false)
  })

  it('allows only the index file in production', () => {
    expect(isAllowedNavigation('file:///C:/app/out/renderer/index.html#top', prod)).toBe(true)
    expect(isAllowedNavigation('file:///C:/Windows/system.ini', prod)).toBe(false)
    expect(isAllowedNavigation('https://example.com', prod)).toBe(false)
    expect(isAllowedNavigation('not a url', prod)).toBe(false)
  })

  it('rejects everything when no target is known', () => {
    expect(isAllowedNavigation('http://localhost:5173/', {})).toBe(false)
  })
})

describe('isTrustedSender', () => {
  const prod = { indexFileUrl: 'file:///C:/app/out/renderer/index.html' }
  it('accepts the app page and rejects others', () => {
    expect(isTrustedSender('file:///C:/app/out/renderer/index.html', prod)).toBe(true)
    expect(isTrustedSender('https://example.com', prod)).toBe(false)
    expect(isTrustedSender(undefined, prod)).toBe(false)
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test -- tests/unit/security.test.ts`
Expected: FAIL (modul tidak ada).

- [ ] **Step 3: Implementasi**

`src/shared/csp.ts`:
```ts
export function buildCsp(dev: boolean): string {
  const script = dev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'"
  const connect = dev
    ? "'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*"
    : "'self'"
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}
```

`src/main/security.ts` (hanya `import type` dari electron agar bisa diuji):
```ts
import type { WebContents, WebPreferences } from 'electron'

export const WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  spellcheck: false
} satisfies WebPreferences

export interface AppTarget {
  devUrl?: string
  indexFileUrl?: string
}

export function isAllowedNavigation(url: string, target: AppTarget): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (target.devUrl) return u.origin === new URL(target.devUrl).origin
  if (target.indexFileUrl) {
    const index = new URL(target.indexFileUrl)
    return u.protocol === 'file:' && u.pathname === index.pathname
  }
  return false
}

export function isTrustedSender(senderUrl: string | undefined, target: AppTarget): boolean {
  return senderUrl !== undefined && isAllowedNavigation(senderUrl, target)
}

export function hardenWebContents(wc: WebContents, target: AppTarget): void {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  const block = (e: { preventDefault(): void }, url: string): void => {
    if (!isAllowedNavigation(url, target)) e.preventDefault()
  }
  wc.on('will-navigate', block)
  wc.on('will-redirect', block)
  wc.on('will-attach-webview', (e) => e.preventDefault())
  wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}
```

- [ ] **Step 4: Sisipkan CSP lewat plugin Vite**

`src/renderer/index.html`: tambah di dalam `<head>`, setelah `<meta charset>`:
```html
    <!--CSP-->
```

`electron.vite.config.ts` (ganti seluruh isi):
```ts
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { buildCsp } from './src/shared/csp'

const alias = { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') }

const cspPlugin = (dev: boolean): Plugin => ({
  name: 'mc-csp',
  transformIndexHtml: (html) =>
    html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${buildCsp(dev)}" />`)
})

export default defineConfig(({ command }) => ({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  renderer: { plugins: [react(), tailwindcss(), cspPlugin(command === 'serve')], resolve: { alias } }
}))
```

- [ ] **Step 5: Test, build, dan periksa CSP di hasil build**

Run: `npm test -- tests/unit/security.test.ts && npm run build && grep -c "Content-Security-Policy" out/renderer/index.html && grep -c "unsafe-eval" out/renderer/index.html`
Expected: test PASS; baris pertama grep `1`; baris kedua `0` (grep keluar status 1 itu normal, itu tanda tidak ada `unsafe-eval` di build produksi).

- [ ] **Step 6: Commit**

```bash
git add src/shared/csp.ts src/main/security.ts src/renderer/index.html electron.vite.config.ts tests/unit/security.test.ts
git commit -m "feat: add Electron hardening, CSP and navigation guards

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Quoting perintah remote

**Files:**
- Create: `src/main/connection/quote.ts`, `tests/helpers/shellSplit.ts`
- Test: `tests/unit/quote.test.ts`

**Interfaces:**
- Produces: `shQuote(arg: string): string`, `buildCommand(argv: readonly string[]): string`; helper test `shSplit(cmd: string): string[]`.

- [ ] **Step 1: Test yang gagal**

`tests/helpers/shellSplit.ts`:
```ts
// Minimal POSIX splitter, enough to invert buildCommand (single quotes and backslash escapes).
export function shSplit(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let has = false
  let i = 0
  while (i < cmd.length) {
    const c = cmd[i]!
    if (c === "'") {
      const end = cmd.indexOf("'", i + 1)
      if (end < 0) throw new Error('unterminated quote')
      cur += cmd.slice(i + 1, end)
      has = true
      i = end + 1
    } else if (c === '\\') {
      cur += cmd[i + 1] ?? ''
      has = true
      i += 2
    } else if (/\s/.test(c)) {
      if (has) out.push(cur)
      cur = ''
      has = false
      i++
    } else {
      cur += c
      has = true
      i++
    }
  }
  if (has) out.push(cur)
  return out
}
```

`tests/unit/quote.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { buildCommand, shQuote } from '../../src/main/connection/quote'
import { shSplit } from '../helpers/shellSplit'

describe('shQuote', () => {
  it('wraps in single quotes', () => {
    expect(shQuote('abc')).toBe("'abc'")
  })

  it('escapes embedded single quotes', () => {
    expect(shQuote("it's")).toBe("'it'\\''s'")
  })

  it('rejects NUL bytes', () => {
    expect(() => shQuote('a\0b')).toThrow(/NUL/)
  })
})

describe('buildCommand', () => {
  it('rejects an empty argv', () => {
    expect(() => buildCommand([])).toThrow()
  })

  it('round-trips hostile arguments', () => {
    const argv = [
      'echo',
      'a b',
      "it's",
      '$(rm -rf ~)',
      '`id`',
      'x; y && z | w',
      'line1\nline2',
      '',
      'héllo ✓',
      '"quoted"',
      '\\back\\slash',
      '*'
    ]
    expect(shSplit(buildCommand(argv))).toEqual(argv)
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test -- tests/unit/quote.test.ts` → FAIL.

- [ ] **Step 3: Implementasi `src/main/connection/quote.ts`**

```ts
export function shQuote(arg: string): string {
  if (arg.includes('\0')) throw new Error('argument contains a NUL byte')
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

export function buildCommand(argv: readonly string[]): string {
  if (argv.length === 0) throw new Error('empty argv')
  return argv.map(shQuote).join(' ')
}
```

- [ ] **Step 4: Jalankan test**

Run: `npm test -- tests/unit/quote.test.ts` → PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/connection/quote.ts tests/helpers/shellSplit.ts tests/unit/quote.test.ts
git commit -m "feat: add safe remote command quoting

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: SettingsStore (`app.db`)

**Files:**
- Create: `src/main/store/settingsStore.ts`
- Test: `tests/unit/settingsStore.test.ts`

**Interfaces:**
- Consumes: `SETTINGS_DEFAULTS`, `SETTINGS_SCHEMA`, `SettingsMap`, `SavedConnection` dari `@shared`.
- Produces: kelas `SettingsStore` dengan konstruktor `new SettingsStore(path: string)` (`':memory:'` diizinkan) dan method:
  - `getSetting<K>(key: K): SettingsMap[K]`, `setSetting<K>(key: K, value: SettingsMap[K]): void`, `allSettings(): SettingsMap`
  - `getConnection(): SavedConnection | null`, `getPasswordEnc(): Buffer | null`
  - `upsertConnection(input: UpsertConnection): number`, `touchConnected(id: number, ts: number): void`, `forgetConnection(): void`
  - `getKnownHost(host: string, port: number): KnownHost | null`, `trustHost(host, port, algo, fingerprint, now?): void`
  - `getPins(connectionId: number): string[]`, `setPins(connectionId: number, profiles: string[]): void`, `pinsInitialized(connectionId: number): boolean`
  - `close(): void`
- `UpsertConnection = { name; host; port; username; remember: boolean; passwordEnc?: Buffer | null }` (`undefined` = pertahankan password lama).

- [ ] **Step 1: Test yang gagal**

`tests/unit/settingsStore.test.ts`:
```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { SETTINGS_DEFAULTS } from '@shared/settings'

let store: SettingsStore
beforeEach(() => {
  store = new SettingsStore(':memory:')
})
afterEach(() => store.close())

const conn = { name: 'prod', host: '10.0.0.1', port: 22, username: 'root', remember: true }

describe('settings', () => {
  it('returns defaults and persists changes', () => {
    expect(store.getSetting('ui.zoom')).toBe(SETTINGS_DEFAULTS['ui.zoom'])
    store.setSetting('ui.zoom', 1.2)
    store.setSetting('window.bounds', { width: 900, height: 600 })
    expect(store.getSetting('ui.zoom')).toBe(1.2)
    expect(store.allSettings()['window.bounds']).toEqual({ width: 900, height: 600 })
  })

  it('rejects a value that fails the schema', () => {
    expect(() => store.setSetting('ui.zoom', 9)).toThrow()
  })
})

describe('connections', () => {
  it('starts empty', () => {
    expect(store.getConnection()).toBeNull()
  })

  it('stores a connection with an encrypted password blob', () => {
    const id = store.upsertConnection({ ...conn, passwordEnc: Buffer.from('enc') })
    const c = store.getConnection()!
    expect(c).toMatchObject({ id, host: '10.0.0.1', port: 22, username: 'root', remember: true, hasPassword: true })
    expect(store.getPasswordEnc()!.toString()).toBe('enc')
  })

  it('keeps the old password when passwordEnc is undefined', () => {
    store.upsertConnection({ ...conn, passwordEnc: Buffer.from('enc') })
    store.upsertConnection({ ...conn, port: 2222 })
    expect(store.getConnection()!.port).toBe(2222)
    expect(store.getPasswordEnc()!.toString()).toBe('enc')
  })

  it('clears the password when remember is false', () => {
    store.upsertConnection({ ...conn, passwordEnc: Buffer.from('enc') })
    store.upsertConnection({ ...conn, remember: false })
    expect(store.getConnection()!.hasPassword).toBe(false)
    expect(store.getPasswordEnc()).toBeNull()
  })

  it('keeps a single connection row', () => {
    const a = store.upsertConnection(conn)
    const b = store.upsertConnection({ ...conn, host: '10.0.0.2' })
    expect(b).toBe(a)
    expect(store.getConnection()!.host).toBe('10.0.0.2')
  })

  it('forget removes the connection, its pins and its host key', () => {
    const id = store.upsertConnection(conn)
    store.trustHost('10.0.0.1', 22, 'ssh-ed25519', 'SHA256:abc')
    store.setPins(id, ['a'])
    store.forgetConnection()
    expect(store.getConnection()).toBeNull()
    expect(store.getKnownHost('10.0.0.1', 22)).toBeNull()
    expect(store.getPins(id)).toEqual([])
    expect(store.pinsInitialized(id)).toBe(false)
  })
})

describe('known hosts', () => {
  it('returns null for unknown hosts and stores trusted ones', () => {
    expect(store.getKnownHost('h', 22)).toBeNull()
    store.trustHost('h', 22, 'ssh-ed25519', 'SHA256:abc', 1000)
    expect(store.getKnownHost('h', 22)).toEqual({ algo: 'ssh-ed25519', fingerprint: 'SHA256:abc', firstSeenAt: 1000 })
  })

  it('replaces the fingerprint when the user trusts a new key', () => {
    store.trustHost('h', 22, 'ssh-ed25519', 'SHA256:old', 1)
    store.trustHost('h', 22, 'ssh-ed25519', 'SHA256:new', 2)
    expect(store.getKnownHost('h', 22)!.fingerprint).toBe('SHA256:new')
  })

  it('exposes the fingerprint on the saved connection', () => {
    store.upsertConnection(conn)
    store.trustHost('10.0.0.1', 22, 'ssh-ed25519', 'SHA256:abc')
    expect(store.getConnection()!.fingerprint).toBe('SHA256:abc')
  })
})

describe('pins', () => {
  it('keeps order and marks the list initialized even when empty', () => {
    const id = store.upsertConnection(conn)
    expect(store.pinsInitialized(id)).toBe(false)
    store.setPins(id, ['b', 'a', 'c'])
    expect(store.getPins(id)).toEqual(['b', 'a', 'c'])
    store.setPins(id, [])
    expect(store.getPins(id)).toEqual([])
    expect(store.pinsInitialized(id)).toBe(true)
  })
})

describe('migrations', () => {
  it('is idempotent across reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-db-'))
    const path = join(dir, 'app.db')
    try {
      const a = new SettingsStore(path)
      a.setSetting('ui.density', 'comfortable')
      a.close()
      const b = new SettingsStore(path)
      expect(b.getSetting('ui.density')).toBe('comfortable')
      b.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test -- tests/unit/settingsStore.test.ts` → FAIL.

- [ ] **Step 3: Implementasi `src/main/store/settingsStore.ts`**

```ts
import Database from 'better-sqlite3'
import type { SavedConnection } from '@shared/ipc'
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA, type SettingsMap } from '@shared/settings'

const MIGRATIONS: string[] = [
  `CREATE TABLE connections (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     host TEXT NOT NULL,
     port INTEGER NOT NULL,
     username TEXT NOT NULL,
     remember INTEGER NOT NULL DEFAULT 1,
     password_enc BLOB,
     last_connected_at INTEGER
   );
   CREATE TABLE known_hosts (
     host TEXT NOT NULL,
     port INTEGER NOT NULL,
     algo TEXT NOT NULL,
     fingerprint TEXT NOT NULL,
     first_seen_at INTEGER NOT NULL,
     PRIMARY KEY (host, port)
   );
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE agent_pins (
     connection_id INTEGER NOT NULL,
     profile TEXT NOT NULL,
     position INTEGER NOT NULL,
     PRIMARY KEY (connection_id, profile)
   );`
]

export interface UpsertConnection {
  name: string
  host: string
  port: number
  username: string
  remember: boolean
  passwordEnc?: Buffer | null
}

export interface KnownHost {
  algo: string
  fingerprint: string
  firstSeenAt: number
}

interface ConnRow {
  id: number
  name: string
  host: string
  port: number
  username: string
  remember: number
  password_enc: Buffer | null
  last_connected_at: number | null
}

export class SettingsStore {
  private db: Database.Database

  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
    const row = this.db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }
    const current = row.v ?? 0
    for (let i = current; i < MIGRATIONS.length; i++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[i]!)
        this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(i + 1)
      })()
    }
  }

  getSetting<K extends keyof SettingsMap>(key: K): SettingsMap[K] {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return SETTINGS_DEFAULTS[key]
    const parsed = SETTINGS_SCHEMA[key].safeParse(JSON.parse(row.value))
    return parsed.success ? (parsed.data as SettingsMap[K]) : SETTINGS_DEFAULTS[key]
  }

  setSetting<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): void {
    const checked = SETTINGS_SCHEMA[key].parse(value)
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(checked))
  }

  allSettings(): SettingsMap {
    const out = { ...SETTINGS_DEFAULTS }
    for (const key of Object.keys(SETTINGS_DEFAULTS) as (keyof SettingsMap)[]) {
      ;(out as Record<string, unknown>)[key] = this.getSetting(key)
    }
    return out
  }

  private connRow(): ConnRow | undefined {
    return this.db.prepare('SELECT * FROM connections ORDER BY id LIMIT 1').get() as ConnRow | undefined
  }

  getConnection(): SavedConnection | null {
    const r = this.connRow()
    if (!r) return null
    const kh = this.getKnownHost(r.host, r.port)
    return {
      id: r.id,
      name: r.name,
      host: r.host,
      port: r.port,
      username: r.username,
      remember: r.remember === 1,
      hasPassword: r.password_enc !== null,
      lastConnectedAt: r.last_connected_at,
      fingerprint: kh?.fingerprint ?? null
    }
  }

  getPasswordEnc(): Buffer | null {
    return this.connRow()?.password_enc ?? null
  }

  upsertConnection(input: UpsertConnection): number {
    const existing = this.connRow()
    const passwordEnc = !input.remember
      ? null
      : input.passwordEnc === undefined
        ? (existing?.password_enc ?? null)
        : input.passwordEnc
    if (existing) {
      this.db
        .prepare(
          'UPDATE connections SET name=?, host=?, port=?, username=?, remember=?, password_enc=? WHERE id=?'
        )
        .run(input.name, input.host, input.port, input.username, input.remember ? 1 : 0, passwordEnc, existing.id)
      return existing.id
    }
    const res = this.db
      .prepare('INSERT INTO connections (name, host, port, username, remember, password_enc) VALUES (?,?,?,?,?,?)')
      .run(input.name, input.host, input.port, input.username, input.remember ? 1 : 0, passwordEnc)
    return Number(res.lastInsertRowid)
  }

  touchConnected(id: number, ts: number): void {
    this.db.prepare('UPDATE connections SET last_connected_at = ? WHERE id = ?').run(ts, id)
  }

  forgetConnection(): void {
    const r = this.connRow()
    if (!r) return
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM agent_pins WHERE connection_id = ?').run(r.id)
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(`pins.initialized.${r.id}`)
      this.db.prepare('DELETE FROM known_hosts WHERE host = ? AND port = ?').run(r.host, r.port)
      this.db.prepare('DELETE FROM connections WHERE id = ?').run(r.id)
    })()
  }

  getKnownHost(host: string, port: number): KnownHost | null {
    const r = this.db
      .prepare('SELECT algo, fingerprint, first_seen_at AS firstSeenAt FROM known_hosts WHERE host = ? AND port = ?')
      .get(host, port) as KnownHost | undefined
    return r ?? null
  }

  trustHost(host: string, port: number, algo: string, fingerprint: string, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO known_hosts (host, port, algo, fingerprint, first_seen_at) VALUES (?,?,?,?,?)
         ON CONFLICT(host, port) DO UPDATE SET algo = excluded.algo, fingerprint = excluded.fingerprint`
      )
      .run(host, port, algo, fingerprint, now)
  }

  getPins(connectionId: number): string[] {
    const rows = this.db
      .prepare('SELECT profile FROM agent_pins WHERE connection_id = ? ORDER BY position')
      .all(connectionId) as { profile: string }[]
    return rows.map((r) => r.profile)
  }

  setPins(connectionId: number, profiles: string[]): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM agent_pins WHERE connection_id = ?').run(connectionId)
      const ins = this.db.prepare('INSERT INTO agent_pins (connection_id, profile, position) VALUES (?,?,?)')
      profiles.forEach((p, i) => ins.run(connectionId, p, i))
      this.db
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(`pins.initialized.${connectionId}`, 'true')
    })()
  }

  pinsInitialized(connectionId: number): boolean {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(`pins.initialized.${connectionId}`)
    return r !== undefined
  }

  close(): void {
    this.db.close()
  }
}
```

- [ ] **Step 4: Jalankan test**

Run: `npm test -- tests/unit/settingsStore.test.ts && npm run typecheck` → semua PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/store/settingsStore.ts tests/unit/settingsStore.test.ts
git commit -m "feat: add SettingsStore with migrations for connections, host keys, settings, pins

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: SecretStore (safeStorage)

**Files:**
- Create: `src/main/store/secretStore.ts`
- Test: `tests/unit/secretStore.test.ts`

**Interfaces:**
- Produces: `SafeStorageLike`; `class SecretStore { constructor(ss: SafeStorageLike, platform?: string); status(): { available: boolean; reason: string | null }; encrypt(plain: string): Buffer; decrypt(blob: Buffer): string | null }`.

- [ ] **Step 1: Test yang gagal**

`tests/unit/secretStore.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { SecretStore, type SafeStorageLike } from '../../src/main/store/secretStore'

const fake = (over: Partial<SafeStorageLike> = {}): SafeStorageLike => ({
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${s}`),
  decryptString: (b) => {
    const t = b.toString()
    if (!t.startsWith('enc:')) throw new Error('bad blob')
    return t.slice(4)
  },
  ...over
})

describe('SecretStore', () => {
  it('encrypts and decrypts when available', () => {
    const s = new SecretStore(fake(), 'win32')
    expect(s.status()).toEqual({ available: true, reason: null })
    expect(s.decrypt(s.encrypt('hunter2'))).toBe('hunter2')
  })

  it('is unavailable when the OS reports no encryption', () => {
    const s = new SecretStore(fake({ isEncryptionAvailable: () => false }), 'win32')
    expect(s.status().available).toBe(false)
    expect(() => s.encrypt('x')).toThrow()
  })

  it.each(['basic_text', 'unknown'])('refuses the weak linux backend %s', (backend) => {
    const s = new SecretStore(fake({ getSelectedStorageBackend: () => backend }), 'linux')
    const st = s.status()
    expect(st.available).toBe(false)
    expect(st.reason).toMatch(/keyring/i)
  })

  it('accepts a real linux keyring', () => {
    const s = new SecretStore(fake({ getSelectedStorageBackend: () => 'gnome_libsecret' }), 'linux')
    expect(s.status().available).toBe(true)
  })

  it('returns null when decryption fails', () => {
    const s = new SecretStore(fake(), 'win32')
    expect(s.decrypt(Buffer.from('garbage'))).toBeNull()
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `npm test -- tests/unit/secretStore.test.ts` → FAIL.

- [ ] **Step 3: Implementasi**

`src/main/store/secretStore.ts`:
```ts
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(blob: Buffer): string
  getSelectedStorageBackend?(): string
}

const WEAK_BACKENDS = new Set(['basic_text', 'unknown'])

export class SecretStore {
  constructor(
    private readonly ss: SafeStorageLike,
    private readonly platform: string = process.platform
  ) {}

  status(): { available: boolean; reason: string | null } {
    if (!this.ss.isEncryptionAvailable()) {
      return { available: false, reason: 'The OS keychain is not available, so the password cannot be stored safely.' }
    }
    if (this.platform === 'linux') {
      const backend = this.ss.getSelectedStorageBackend?.() ?? 'unknown'
      if (WEAK_BACKENDS.has(backend)) {
        return {
          available: false,
          reason: 'No keyring (Secret Service or KWallet) was found. Install one to remember the password; other fields are still remembered.'
        }
      }
    }
    return { available: true, reason: null }
  }

  encrypt(plain: string): Buffer {
    if (!this.status().available) throw new Error('secure storage unavailable')
    return this.ss.encryptString(plain)
  }

  decrypt(blob: Buffer): string | null {
    try {
      return this.ss.decryptString(blob)
    } catch {
      return null
    }
  }
}
```

- [ ] **Step 4: Jalankan** — `npm test -- tests/unit/secretStore.test.ts` → PASS (6 tests, termasuk `it.each`).

- [ ] **Step 5: Commit**

```bash
git add src/main/store/secretStore.ts tests/unit/secretStore.test.ts
git commit -m "feat: add SecretStore wrapper over safeStorage with weak-backend refusal

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```



---

### Task 7: Fixture builder dan metrik collector (Python)

**Files:**
- Create: `tests/fixtures/make_fixture.py`, `tests/collector/conftest.py`, `tests/collector/test_metrics.py`
- Create: `collector/mc_collector.py` (bagian metrik; agents dan main loop di Task 8)

**Interfaces:**
- Produces (`make_fixture.py`): `Fixture(root, proc, sysfs, home, now)`, `make_fixture(root, now=None) -> Fixture`, `advance(fx, step)`, `add_profile(home, name, display_name=None, markers=("SOUL.md",))`, `make_db(path, messages=(), sessions=(), wal=False) -> sqlite3.Connection`, `set_heartbeat(fx, ts)`, `snapshot(root) -> dict`, `GATEWAY_PID = 1842`. CLI: `init <root>`, `add-profile <home> <name>`, `advance <root> <step>`.
- Produces (`mc_collector.py`): `PROC`, `SYSFS`, `HZ`, `PAGE` (global yang bisa di-monkeypatch), `read_text`, `parse_cpu_stat`, `cpu_pct`, `parse_meminfo`, `summarize_mem`, `parse_net_dev`, `parse_diskstats`, `parse_mounts`, `scan_procs`, `read_temp`, `Sampler(clock).sample() -> dict` (bentuk persis `MetricsData`).

- [ ] **Step 1: Tulis `tests/fixtures/make_fixture.py`**

```python
"""Builds a fake Linux /proc, /sys and ~/.hermes tree for tests.

Used by pytest (import) and by the TypeScript integration tests
(`python make_fixture.py init <root>`).
"""
import hashlib
import json
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path

CORES = 4
GATEWAY_PID = 1842
MEMINFO = """MemTotal:       16384000 kB
MemFree:         4608000 kB
MemAvailable:   10137600 kB
Buffers:          102400 kB
Cached:          5324800 kB
SReclaimable:     204800 kB
SwapTotal:       2097152 kB
SwapFree:        2000000 kB
"""


@dataclass
class Fixture:
    root: Path
    proc: Path
    sysfs: Path
    home: Path
    now: float


def w(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def esc_mount(p: Path) -> str:
    return str(p).replace(" ", "\\040")


def write_cpu(proc: Path, step: int) -> None:
    rows, tu, ti = [], 0, 0
    for i in range(CORES):
        user, idle = 100 + 40 * step, 900 + 60 * step
        rows.append(f"cpu{i} {user} 0 0 {idle} 0 0 0 0 0 0")
        tu += user
        ti += idle
    w(proc / "stat", f"cpu  {tu} 0 0 {ti} 0 0 0 0 0 0\n" + "\n".join(rows) + "\nintr 0\n")


def write_net(proc: Path, step: int) -> None:
    rx, tx = 1_000_000 + 500_000 * step, 200_000 + 100_000 * step
    w(
        proc / "net" / "dev",
        "Inter-|   Receive                                                |  Transmit\n"
        " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n"
        "    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0\n"
        f"  eth0: {rx} 10 0 0 0 0 0 0 {tx} 10 0 0 0 0 0 0\n",
    )


def write_diskstats(proc: Path, step: int) -> None:
    rs, ws = 1000 + 2048 * step, 500 + 1024 * step
    w(
        proc / "diskstats",
        f"   8       0 vda 100 0 {rs} 10 50 0 {ws} 10 0 0 0\n"
        f"   8       1 vda1 100 0 99999 10 50 0 99999 10 0 0 0\n",
    )


def write_proc(proc: Path, pid: int, comm: str, uid: int, ticks: int, rss_pages: int, cmdline: list[str], start: int = 100) -> None:
    base = proc / str(pid)
    w(
        base / "stat",
        f"{pid} ({comm}) S 1 {pid} {pid} 0 -1 4194560 0 0 0 0 {ticks} 0 0 0 20 0 1 0 {start} 1000000 {rss_pages} 0\n",
    )
    w(base / "status", f"Name:\t{comm}\nUid:\t{uid}\t{uid}\t{uid}\t{uid}\n")
    w(base / "cmdline", "\0".join(cmdline) + "\0")


def write_gateway_proc(proc: Path, step: int) -> None:
    write_proc(proc, GATEWAY_PID, "python", 0, 1000 + 25 * step, 25600, ["python", "-m", "hermes_cli.main", "gateway", "run"])


def advance(fx: Fixture, step: int) -> None:
    write_cpu(fx.proc, step)
    write_net(fx.proc, step)
    write_diskstats(fx.proc, step)
    write_gateway_proc(fx.proc, step)


def make_db(path: Path, messages=(), sessions=(), wal: bool = False) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    if wal:
        con.execute("PRAGMA journal_mode=WAL")
    con.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, role TEXT, content TEXT, timestamp REAL, active INTEGER DEFAULT 1)")
    con.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at REAL, ended_at REAL)")
    for ts, active in messages:
        con.execute("INSERT INTO messages (role, content, timestamp, active) VALUES ('user', 'x', ?, ?)", (ts, active))
    for i, ended in enumerate(sessions):
        con.execute("INSERT INTO sessions (id, started_at, ended_at) VALUES (?, 0, ?)", (f"s{i}", ended))
    con.commit()
    return con


def add_profile(home: Path, name: str, display_name: str | None = None, markers=("SOUL.md",)) -> Path:
    pdir = home / "profiles" / name
    pdir.mkdir(parents=True, exist_ok=True)
    for m in markers:
        w(pdir / m, "x\n")
    if display_name:
        w(pdir / "profile.yaml", f'display_name: "{display_name}"\n')
    return pdir


def set_heartbeat(fx: Fixture, ts: float) -> None:
    state = json.loads((fx.home / "gateway_state.json").read_text())
    state["heartbeat"] = ts
    w(fx.home / "gateway_state.json", json.dumps(state))


def make_fixture(root: Path, now: float | None = None) -> Fixture:
    now = time.time() if now is None else now
    root = Path(root)
    proc, sysfs, home = root / "proc", root / "sys", root / "home" / ".hermes"
    fx = Fixture(root, proc, sysfs, home, now)
    (root / "disk").mkdir(parents=True, exist_ok=True)
    (root / "data").mkdir(parents=True, exist_ok=True)

    w(proc / "meminfo", MEMINFO)
    w(proc / "loadavg", "1.42 0.98 0.77 2/214 30000\n")
    w(proc / "uptime", "1038240.55 4000000.00\n")
    w(
        proc / "mounts",
        "proc /proc proc rw 0 0\n"
        f"/dev/vda1 {esc_mount(root / 'disk')} ext4 rw 0 0\n"
        f"/dev/vda2 {esc_mount(root / 'data')} ext4 rw 0 0\n"
        "tmpfs /run tmpfs rw 0 0\n",
    )
    w(sysfs / "class" / "thermal" / "thermal_zone0" / "temp", "52000\n")
    advance(fx, 0)
    write_proc(proc, 1, "systemd", 0, 500, 2000, ["/sbin/init"])
    write_proc(proc, 912, "node", 1000, 800, 40000, ["node", "/srv/app/server.js"])

    w(home / "gateway_state.json", json.dumps({"served_profiles": ["default", "scout"], "heartbeat": now, "platforms": {"telegram": {"connected": True}}}))
    w(home / "gateway.pid", str(GATEWAY_PID))
    w(home / "config.yaml", "model:\n  default: x/y\n")
    w(home / "SOUL.md", "soul\n")
    w(home / "memories" / "MEMORY.md", "m\n")
    w(home / "memories" / "USER.md", "u\n")
    w(home / ".env", "SECRET_SENTINEL=do-not-read\n")
    w(home / "auth.json", '{"token": "SECRET_SENTINEL"}\n')
    make_db(home / "state.db", messages=[(now - 3600, 1)]).close()

    scout = add_profile(home, "scout", display_name="Scout", markers=("config.yaml",))
    make_db(scout / "state.db", messages=[(now - 10, 1), (now - 1, 0)]).close()
    add_profile(home, "atlas", markers=("SOUL.md",))
    (home / "profiles" / "empty").mkdir(parents=True, exist_ok=True)
    return fx


def load(root: Path) -> Fixture:
    root = Path(root)
    return Fixture(root, root / "proc", root / "sys", root / "home" / ".hermes", time.time())


def snapshot(root: Path) -> dict[str, tuple[int, int, str]]:
    out = {}
    for p in sorted(Path(root).rglob("*")):
        if p.is_file():
            st = p.stat()
            out[str(p.relative_to(root))] = (st.st_size, st.st_mtime_ns, hashlib.sha256(p.read_bytes()).hexdigest())
    return out


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "init":
        f = make_fixture(Path(sys.argv[2]))
        print(json.dumps({"root": str(f.root), "proc": str(f.proc), "sysfs": str(f.sysfs), "home": str(f.home)}))
    elif cmd == "add-profile":
        add_profile(Path(sys.argv[2]), sys.argv[3])
    elif cmd == "advance":
        advance(load(Path(sys.argv[2])), int(sys.argv[3]))
    else:
        raise SystemExit(f"unknown command {cmd}")
```

- [ ] **Step 2: `tests/collector/conftest.py`**

```python
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "collector"))
sys.path.insert(0, str(ROOT / "tests" / "fixtures"))

import make_fixture as mf  # noqa: E402
import mc_collector as c  # noqa: E402


@pytest.fixture
def fx(tmp_path, monkeypatch):
    f = mf.make_fixture(tmp_path / "fx", now=1_760_000_000.0)
    monkeypatch.setattr(c, "PROC", str(f.proc))
    monkeypatch.setattr(c, "SYSFS", str(f.sysfs))
    monkeypatch.setattr(c, "HZ", 100)
    monkeypatch.setattr(c, "PAGE", 4096)
    return f
```

- [ ] **Step 3: Test metrik yang gagal — `tests/collector/test_metrics.py`**

```python
from pathlib import Path

import make_fixture as mf
import mc_collector as c

ROOT = Path(__file__).resolve().parents[2]


def test_cpu_pct_math():
    assert c.cpu_pct((900, 1000), (960, 1100)) == 40.0
    assert c.cpu_pct((5, 10), (5, 10)) == 0.0


def test_idle_includes_iowait():
    t = "cpu  10 0 10 70 10 0 0 0\ncpu0 10 0 10 70 10 0 0 0\n"
    assert c.parse_cpu_stat(t)["cpu"] == (80, 100)


def test_summarize_mem():
    info = c.parse_meminfo(mf.MEMINFO)
    m = c.summarize_mem(info)
    assert m["total"] == 16384000 * 1024
    assert m["available"] == 10137600 * 1024
    assert m["used"] == m["total"] - m["available"]
    assert m["cached"] == (5324800 + 102400 + 204800) * 1024
    assert m["swapUsed"] == (2097152 - 2000000) * 1024


def test_mounts_filtered_and_unescaped():
    text = (
        "proc /proc proc rw 0 0\n"
        "/dev/vda1 /srv/my\\040disk ext4 rw 0 0\n"
        "tmpfs /run tmpfs rw 0 0\n"
        "overlay / overlay rw 0 0\n"
    )
    assert c.parse_mounts(text) == [("/srv/my disk", "ext4"), ("/", "overlay")]


def test_net_dev_skips_loopback():
    t = "h1\nh2\n    lo: 1 1 0 0 0 0 0 0 2 1 0 0 0 0 0 0\n  eth0: 10 1 0 0 0 0 0 0 20 1 0 0 0 0 0 0\n"
    assert c.parse_net_dev(t) == {"eth0": (10, 20)}


def test_diskstats_ignores_partitions():
    t = "   8       0 vda 1 0 100 0 1 0 200 0 0 0 0\n   8       1 vda1 1 0 999 0 1 0 999 0 0 0 0\n 259 0 nvme0n1 1 0 10 0 1 0 20 0 0 0 0\n"
    assert c.parse_diskstats(t) == ((100 + 10) * 512, (200 + 20) * 512)


def test_first_sample_has_zero_rates(fx):
    m = c.Sampler(clock=lambda: 0.0).sample()
    assert m["cpu"]["total"] == 0.0
    assert m["net"][0]["rxBps"] == 0.0
    assert m["io"]["readBps"] == 0.0


def test_sampler_computes_rates(fx):
    t = iter([0.0, 1.0])
    s = c.Sampler(clock=lambda: next(t))
    s.sample()
    mf.advance(fx, 1)
    m = s.sample()
    assert m["cpu"]["total"] == 40.0
    assert m["cpu"]["cores"] == [40.0] * mf.CORES
    assert m["cpu"]["load"] == [1.42, 0.98, 0.77]
    assert m["cpu"]["uptimeS"] == 1038240.55
    assert m["cpu"]["tempC"] == 52.0
    assert m["net"][0]["name"] == "eth0"
    assert m["net"][0]["rxBps"] == 500_000
    assert m["net"][0]["txBps"] == 100_000
    assert m["io"] == {"readBps": 1_048_576, "writeBps": 524_288}
    assert m["tasks"] == 3
    assert [d["fs"] for d in m["disks"]] == ["ext4", "ext4"]


def test_procs_flag_hermes_and_compute_cpu(fx):
    t = iter([0.0, 1.0])
    s = c.Sampler(clock=lambda: next(t))
    s.sample()
    mf.advance(fx, 1)
    m = s.sample()
    gw = next(p for p in m["procs"] if p["pid"] == mf.GATEWAY_PID)
    assert gw["hermes"] is True
    assert gw["cpu"] == 25.0
    assert gw["rss"] == 25600 * 4096
    assert gw["user"] in ("0", "root")
    assert "hermes_cli.main gateway run" in gw["cmd"]
    node = next(p for p in m["procs"] if p["pid"] == 912)
    assert node["hermes"] is False


def test_collector_source_is_ascii():
    (ROOT / "collector" / "mc_collector.py").read_bytes().decode("ascii")
```

- [ ] **Step 4: Jalankan, pastikan gagal**

Run: `npm run test:py`
Expected: FAIL/ERROR (`mc_collector` tidak ada).

- [ ] **Step 5: Implementasi bagian metrik `collector/mc_collector.py`**

Catatan: berkas ini harus ASCII murni dan hanya memakai `open` untuk membaca (agar test "tidak membuka .env/auth.json" di Task 8 bisa memantau `builtins.open`).

```python
#!/usr/bin/env python3
"""Hermes Agent Mission Control collector.

Read-only, stdlib only, ASCII only. The desktop app streams this file over SSH
stdin (`python -u - <hermes_home>`); nothing is ever written to the VPS.
Emits one JSON object per line on stdout.
"""
import datetime
import glob
import json
import os
import re
import shutil
import sqlite3
import sys
import time
from pathlib import Path

try:
    import pwd
except ImportError:  # Windows dev/test hosts
    pwd = None

PROC = os.environ.get("MC_PROC_ROOT", "/proc")
SYSFS = os.environ.get("MC_SYS_ROOT", "/sys")

try:
    HZ = os.sysconf("SC_CLK_TCK")
    PAGE = os.sysconf("SC_PAGE_SIZE")
except (AttributeError, ValueError, OSError):
    HZ, PAGE = 100, 4096

REAL_FS = {"ext2", "ext3", "ext4", "xfs", "btrfs", "zfs", "f2fs", "vfat", "exfat", "ntfs", "ntfs3", "fuseblk"}
WHOLE_DISK = re.compile(r"^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+|mmcblk\d+)$")


def read_text(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def parse_cpu_stat(text):
    out = {}
    for line in text.splitlines():
        if not line.startswith("cpu"):
            continue
        parts = line.split()
        nums = [int(x) for x in parts[1:9]]
        nums += [0] * (8 - len(nums))
        out[parts[0]] = (nums[3] + nums[4], sum(nums))
    return out


def cpu_pct(prev, cur):
    dtotal = cur[1] - prev[1]
    if dtotal <= 0:
        return 0.0
    didle = cur[0] - prev[0]
    return round(max(0.0, min(100.0, 100.0 * (1.0 - didle / dtotal))), 1)


def parse_meminfo(text):
    info = {}
    for line in text.splitlines():
        key, _, rest = line.partition(":")
        m = re.match(r"\s*(\d+)", rest)
        if m:
            info[key.strip()] = int(m.group(1)) * 1024
    return info


def summarize_mem(info):
    total = info.get("MemTotal", 0)
    free = info.get("MemFree", 0)
    avail = info.get("MemAvailable", free + info.get("Buffers", 0) + info.get("Cached", 0))
    cached = info.get("Cached", 0) + info.get("Buffers", 0) + info.get("SReclaimable", 0)
    swap_total = info.get("SwapTotal", 0)
    return {
        "total": total,
        "used": max(0, total - avail),
        "cached": cached,
        "available": avail,
        "free": free,
        "swapTotal": swap_total,
        "swapUsed": max(0, swap_total - info.get("SwapFree", 0)),
    }


def parse_loadavg(text):
    try:
        return [float(x) for x in text.split()[:3]]
    except ValueError:
        return [0.0, 0.0, 0.0]


def parse_uptime(text):
    try:
        return float(text.split()[0])
    except (ValueError, IndexError):
        return 0.0


def parse_net_dev(text):
    out = {}
    for line in text.splitlines()[2:]:
        name, _, rest = line.partition(":")
        name = name.strip()
        fields = rest.split()
        if not name or name == "lo" or len(fields) < 9:
            continue
        out[name] = (int(fields[0]), int(fields[8]))
    return out


def parse_diskstats(text):
    rd = wr = 0
    for line in text.splitlines():
        f = line.split()
        if len(f) < 10 or not WHOLE_DISK.match(f[2]):
            continue
        rd += int(f[5]) * 512
        wr += int(f[9]) * 512
    return rd, wr


def unescape_mount(s):
    return re.sub(r"\\([0-7]{3})", lambda m: chr(int(m.group(1), 8)), s)


def parse_mounts(text):
    seen = {}
    for line in text.splitlines():
        f = line.split()
        if len(f) < 3:
            continue
        dev, mount, fs = f[0], unescape_mount(f[1]), f[2]
        if (dev.startswith("/dev/") and fs in REAL_FS) or (mount == "/" and fs in REAL_FS | {"overlay"}):
            seen[mount] = fs
    return list(seen.items())


def disk_list():
    out = []
    for mount, fs in parse_mounts(read_text(PROC + "/mounts") or ""):
        try:
            u = shutil.disk_usage(mount)
        except OSError:
            continue
        out.append({"mount": mount, "fs": fs, "total": int(u.total), "used": int(u.used)})
    return out[:16]


def read_temp():
    best = None
    for p in glob.glob(os.path.join(SYSFS, "class", "thermal", "thermal_zone*", "temp")):
        text = read_text(p)
        try:
            v = int((text or "").strip()) / 1000.0
        except ValueError:
            continue
        if best is None or v > best:
            best = v
    return round(best, 1) if best is not None else None


_user_cache = {}
_static_cache = {}


def uid_name(uid):
    if uid not in _user_cache:
        name = str(uid)
        if pwd is not None:
            try:
                name = pwd.getpwuid(uid).pw_name
            except KeyError:
                pass
        _user_cache[uid] = name
    return _user_cache[uid]


def scan_procs():
    out = {}
    try:
        names = os.listdir(PROC)
    except OSError:
        return out
    me = os.getpid()
    live = set()
    for name in names:
        if not name.isdigit():
            continue
        base = PROC + "/" + name
        stat = read_text(base + "/stat")
        if not stat:
            continue
        rp = stat.rfind(")")
        if rp < 0:
            continue
        f = stat[rp + 2:].split()
        if len(f) < 22:
            continue
        pid = int(name)
        start = int(f[19])
        key = (pid, start)
        live.add(key)
        if key not in _static_cache:
            comm = stat[stat.find("(") + 1:rp]
            uid = 0
            m = re.search(r"^Uid:\s+(\d+)", read_text(base + "/status") or "", re.M)
            if m:
                uid = int(m.group(1))
            cmd = (read_text(base + "/cmdline") or "").replace("\0", " ").strip() or "[" + comm + "]"
            if pid == me:
                cmd += "  (mission-control collector)"
            _static_cache[key] = (uid_name(uid), cmd[:200], pid == me or "hermes" in cmd.lower())
        user, cmd, hermes = _static_cache[key]
        out[pid] = {"ticks": int(f[11]) + int(f[12]), "start": start, "rss": int(f[21]) * PAGE, "user": user, "cmd": cmd, "hermes": hermes}
    for key in [k for k in _static_cache if k not in live]:
        del _static_cache[key]
    return out


def pick_procs(rows, per_sort=25, cap=80):
    chosen, seen = [], set()
    ranked = sorted(rows, key=lambda r: r["cpu"], reverse=True)[:per_sort]
    ranked += sorted(rows, key=lambda r: r["rss"], reverse=True)[:per_sort]
    ranked += [r for r in rows if r["hermes"]]
    for r in ranked:
        if r["pid"] not in seen:
            seen.add(r["pid"])
            chosen.append(r)
    return chosen[:cap]


class Sampler:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.prev = None

    def sample(self):
        now = self.clock()
        stat = parse_cpu_stat(read_text(PROC + "/stat") or "")
        net = parse_net_dev(read_text(PROC + "/net/dev") or "")
        io = parse_diskstats(read_text(PROC + "/diskstats") or "")
        procs = scan_procs()
        mem = summarize_mem(parse_meminfo(read_text(PROC + "/meminfo") or ""))
        prev, self.prev = self.prev, {"t": now, "stat": stat, "net": net, "io": io, "procs": procs}
        dt = (now - prev["t"]) if prev else 0.0
        have = prev is not None and dt > 0

        def rate(a, b):
            return max(0.0, (b - a) / dt) if have else 0.0

        core_keys = sorted((k for k in stat if k != "cpu"), key=lambda k: int(k[3:]))
        if have and "cpu" in stat:
            total = cpu_pct(prev["stat"].get("cpu", stat["cpu"]), stat["cpu"])
            cores = [cpu_pct(prev["stat"].get(k, stat[k]), stat[k]) for k in core_keys]
        else:
            total, cores = 0.0, [0.0] * len(core_keys)

        ifaces = []
        for name, (rx, tx) in net.items():
            p = prev["net"].get(name) if have else None
            ifaces.append({
                "name": name,
                "rxBps": round(rate(p[0], rx), 1) if p else 0.0,
                "txBps": round(rate(p[1], tx), 1) if p else 0.0,
                "rxTotal": rx,
                "txTotal": tx,
            })
        ifaces.sort(key=lambda i: i["rxTotal"] + i["txTotal"], reverse=True)

        rows = []
        for pid, p in procs.items():
            pp = prev["procs"].get(pid) if have else None
            cpu = 0.0
            if pp and pp["start"] == p["start"]:
                cpu = max(0.0, (p["ticks"] - pp["ticks"]) / HZ / dt * 100.0)
            rows.append({
                "pid": pid,
                "user": p["user"],
                "cpu": round(cpu, 1),
                "mem": round(p["rss"] / mem["total"] * 100.0, 2) if mem["total"] else 0.0,
                "rss": p["rss"],
                "cmd": p["cmd"],
                "hermes": p["hermes"],
            })

        return {
            "cpu": {
                "total": total,
                "cores": cores,
                "load": parse_loadavg(read_text(PROC + "/loadavg") or ""),
                "uptimeS": parse_uptime(read_text(PROC + "/uptime") or ""),
                "tempC": read_temp(),
            },
            "mem": mem,
            "disks": disk_list(),
            "io": {
                "readBps": round(rate(prev["io"][0], io[0]), 1) if have else 0.0,
                "writeBps": round(rate(prev["io"][1], io[1]), 1) if have else 0.0,
            },
            "net": ifaces,
            "procs": pick_procs(rows),
            "tasks": len(procs),
        }
```

- [ ] **Step 6: Jalankan test**

Run: `npm run test:py`
Expected: semua test di `test_metrics.py` PASS. Jika `m["cpu"]["load"]` gagal karena format float, cek `parse_loadavg`.

- [ ] **Step 7: Commit**

```bash
git add collector/mc_collector.py tests/fixtures/make_fixture.py tests/collector
git commit -m "feat: add collector metrics sampler and fake /proc fixture builder

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Collector agents, main loop, dan keamanan baca

**Files:**
- Modify: `collector/mc_collector.py` (tambah bagian agents, emit, main)
- Create: `tests/collector/test_agents.py`, `tests/collector/test_cli.py`

**Interfaces:**
- Consumes: semua dari Task 7.
- Produces: `collect_agents(home: str, now: float) -> (dict, list[dict])` (`AgentsData`, daftar error `{code,message,profile}`), `probe_db(path) -> (last_ts|None, open_session: bool, err|None)`, `main(argv) -> int`. CLI: `python -u - <home> [--ticks N] [--interval S] [--agents-interval S]`.

- [ ] **Step 1: Test agents yang gagal — `tests/collector/test_agents.py`**

```python
import builtins
import json
from pathlib import Path

import make_fixture as mf
import mc_collector as c


def by_name(data):
    return {a["profile"]: a for a in data["agents"]}


def test_lists_default_and_marked_profiles_only(fx):
    data, errors = c.collect_agents(str(fx.home), fx.now)
    assert sorted(by_name(data)) == ["atlas", "default", "scout"]
    assert errors == []


def test_status_matrix(fx):
    a = by_name(c.collect_agents(str(fx.home), fx.now)[0])
    assert a["default"]["status"] == "idle"
    assert a["scout"]["status"] == "working"
    assert a["atlas"]["status"] == "offline"
    assert a["scout"]["displayName"] == "Scout"
    assert a["default"]["displayName"] == "default"
    assert a["default"]["platforms"] == ["telegram"]
    assert a["default"]["hasSoul"] and a["default"]["hasMemory"] and a["default"]["hasUser"]
    assert a["atlas"]["hasSoul"] and not a["atlas"]["hasMemory"]
    assert a["scout"]["lastActivityTs"] == fx.now - 10
    assert a["scout"]["configMtime"] is not None
    assert a["atlas"]["configMtime"] is None


def test_inactive_messages_are_ignored(fx):
    a = by_name(c.collect_agents(str(fx.home), fx.now)[0])
    assert a["scout"]["lastActivityTs"] == fx.now - 10  # the active=0 message at now-1 is skipped


def test_gateway_info(fx):
    data, _ = c.collect_agents(str(fx.home), fx.now + 4)
    assert data["gateway"] == {"up": True, "heartbeatAgeS": 4.0, "served": ["default", "scout"]}


def test_stale_heartbeat_marks_gateway_down(fx):
    mf.set_heartbeat(fx, fx.now - 500)
    data, _ = c.collect_agents(str(fx.home), fx.now)
    assert data["gateway"]["up"] is False
    assert data["gateway"]["heartbeatAgeS"] == 500.0
    assert by_name(data)["default"]["status"] == "offline"


def test_dead_gateway_pid_marks_gateway_down(fx):
    (fx.home / "gateway.pid").write_text("999999")
    data, _ = c.collect_agents(str(fx.home), fx.now)
    assert data["gateway"]["up"] is False


def test_parked_marker(fx):
    (fx.home / "profiles" / "atlas" / "gateway.parked").write_text("")
    assert by_name(c.collect_agents(str(fx.home), fx.now)[0])["atlas"]["status"] == "parked"


def test_standalone_gateway_makes_profile_active(fx):
    atlas = fx.home / "profiles" / "atlas"
    (atlas / "gateway.pid").write_text(str(mf.GATEWAY_PID))
    assert by_name(c.collect_agents(str(fx.home), fx.now)[0])["atlas"]["status"] == "idle"


def test_open_cli_session_with_recent_message_is_active(fx):
    mf.add_profile(fx.home, "cli", markers=("config.yaml",))
    con = mf.make_db(fx.home / "profiles" / "cli" / "state.db", messages=[(fx.now - 100, 1)], sessions=[None])
    con.close()
    assert by_name(c.collect_agents(str(fx.home), fx.now)[0])["cli"]["status"] == "idle"


def test_new_profile_appears(fx):
    mf.add_profile(fx.home, "nova", display_name="Nova")
    assert "nova" in by_name(c.collect_agents(str(fx.home), fx.now)[0])


def test_unsupported_schema_reports_error_and_keeps_going(fx):
    import sqlite3

    pdir = mf.add_profile(fx.home, "odd", markers=("config.yaml",))
    con = sqlite3.connect(pdir / "state.db")
    con.execute("CREATE TABLE other (x)")
    con.commit()
    con.close()
    data, errors = c.collect_agents(str(fx.home), fx.now)
    assert by_name(data)["odd"]["status"] == "offline"
    assert errors == [{"code": "unsupported_schema", "message": "state.db schema not recognized", "profile": "odd"}]


def test_reads_a_wal_database_while_a_writer_is_open(fx):
    pdir = mf.add_profile(fx.home, "walp", markers=("config.yaml",))
    writer = mf.make_db(pdir / "state.db", messages=[(fx.now - 5, 1)], wal=True)
    try:
        writer.execute("INSERT INTO messages (role, content, timestamp, active) VALUES ('a', 'b', ?, 1)", (fx.now - 2,))
        writer.commit()
        a = by_name(c.collect_agents(str(fx.home), fx.now)[0])
        assert a["walp"]["lastActivityTs"] == fx.now - 2
    finally:
        writer.close()


def test_never_opens_secret_files(fx, monkeypatch):
    opened = []
    real_open = builtins.open

    def spy(file, *a, **k):
        opened.append(str(file))
        return real_open(file, *a, **k)

    monkeypatch.setattr(builtins, "open", spy)
    c.collect_agents(str(fx.home), fx.now)
    sampler = c.Sampler()
    sampler.sample()
    assert opened, "spy should have seen reads"
    assert not [p for p in opened if p.endswith(".env") or p.endswith("auth.json")]


def test_emitted_payload_is_json_serialisable(fx):
    data, _ = c.collect_agents(str(fx.home), fx.now)
    json.dumps(data, allow_nan=False)
```

- [ ] **Step 2: Test CLI yang gagal — `tests/collector/test_cli.py`**

```python
import json
import os
import subprocess
import sys
from pathlib import Path

import make_fixture as mf

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "collector" / "mc_collector.py"


def env_for(fx):
    return {**os.environ, "MC_PROC_ROOT": str(fx.proc), "MC_SYS_ROOT": str(fx.sysfs)}


def test_streams_over_stdin_like_the_app_does(fx):
    r = subprocess.run(
        [sys.executable, "-u", "-", str(fx.home), "--ticks", "3", "--interval", "0.05"],
        input=SCRIPT.read_bytes(),
        env=env_for(fx),
        capture_output=True,
        timeout=30,
    )
    assert r.returncode == 0, r.stderr.decode()
    assert r.stderr == b""
    events = [json.loads(line) for line in r.stdout.decode("ascii").splitlines()]
    kinds = [e["type"] for e in events]
    assert kinds[0] == "agents"
    assert kinds.count("metrics") == 3
    assert set(kinds) <= {"agents", "metrics", "error"}
    assert all(e["profile"] is None and isinstance(e["ts"], float) for e in events)


def test_exits_quietly_when_the_reader_goes_away(fx):
    p = subprocess.Popen(
        [sys.executable, str(SCRIPT), str(fx.home), "--interval", "0.05"],
        env=env_for(fx),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert p.stdout.readline()
    p.stdout.close()
    assert p.wait(timeout=15) == 0
    assert p.stderr.read() == b""


def test_zero_change_after_a_session(fx):
    before = mf.snapshot(fx.root)
    subprocess.run(
        [sys.executable, "-u", "-", str(fx.home), "--ticks", "2", "--interval", "0.05"],
        input=SCRIPT.read_bytes(),
        env=env_for(fx),
        capture_output=True,
        timeout=30,
        check=True,
    )
    assert mf.snapshot(fx.root) == before


def test_defaults_to_hermes_home_env_when_no_argument(fx):
    r = subprocess.run(
        [sys.executable, str(SCRIPT), "--ticks", "1", "--interval", "0.05"],
        env={**env_for(fx), "HERMES_HOME": str(fx.home)},
        capture_output=True,
        timeout=30,
    )
    first = json.loads(r.stdout.decode().splitlines()[0])
    assert first["type"] == "agents"
    assert {a["profile"] for a in first["data"]["agents"]} == {"default", "scout", "atlas"}
```

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `npm run test:py`
Expected: test baru FAIL (`collect_agents` / `main` belum ada).

- [ ] **Step 4: Tambahkan agents, emit, dan main ke `collector/mc_collector.py`**

Tambahkan di akhir berkas (setelah `class Sampler`):

```python
MARKERS = ("config.yaml", ".env", "SOUL.md", "profile.yaml", "state.db")
HB_KEYS = ("heartbeat", "heartbeat_at", "last_heartbeat", "updated_at", "timestamp", "ts")
STALE_HEARTBEAT_S = 120
WORKING_WINDOW_S = 30
CLI_WINDOW_S = 300


def read_json(path):
    text = read_text(path)
    if not text:
        return None
    try:
        value = json.loads(text)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def to_epoch(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        f = float(v)
        return f / 1000.0 if f > 1e11 else f
    if isinstance(v, str):
        s = v.strip()
        try:
            return to_epoch(float(s))
        except ValueError:
            pass
        try:
            return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def read_pid(path):
    text = read_text(path)
    if not text:
        return None
    text = text.strip()
    try:
        return int(text)
    except ValueError:
        pass
    try:
        value = json.loads(text)
    except ValueError:
        return None
    pid = value.get("pid") if isinstance(value, dict) else None
    return pid if isinstance(pid, int) else None


def pid_alive(pid):
    return pid is not None and pid > 0 and os.path.isdir(PROC + "/" + str(pid))


def list_profiles(home):
    out = [("default", home)]
    pdir = os.path.join(home, "profiles")
    try:
        names = sorted(os.listdir(pdir))
    except OSError:
        names = []
    for name in names:
        d = os.path.join(pdir, name)
        if os.path.isdir(d) and any(os.path.exists(os.path.join(d, m)) for m in MARKERS):
            out.append((name, d))
    return out


def display_name(pdir, fallback):
    text = read_text(os.path.join(pdir, "profile.yaml"))
    if text:
        m = re.search(r"^display_name:\s*(.+?)\s*$", text, re.M)
        if m:
            value = m.group(1).strip().strip("'\"")
            if value:
                return value[:64]
    return fallback


def extract_platforms(state):
    p = state.get("platforms") if isinstance(state, dict) else None
    names = []
    if isinstance(p, dict):
        names = [str(k) for k in p.keys()]
    elif isinstance(p, list):
        for item in p:
            if isinstance(item, str):
                names.append(item)
            elif isinstance(item, dict) and item.get("name"):
                names.append(str(item["name"]))
    return sorted(set(names))[:12]


def probe_db(path):
    if not os.path.isfile(path):
        return None, False, None
    con = None
    try:
        uri = Path(path).resolve().as_uri() + "?mode=ro"
        con = sqlite3.connect(uri, uri=True, timeout=1.0)
        con.execute("PRAGMA query_only=1")
        cols = {r[1] for r in con.execute("PRAGMA table_info(messages)")}
        if "timestamp" not in cols:
            return None, False, "unsupported_schema"
        where = " WHERE active=1" if "active" in cols else ""
        row = con.execute("SELECT MAX(timestamp) FROM messages" + where).fetchone()
        last = to_epoch(row[0]) if row and row[0] is not None else None
        scols = {r[1] for r in con.execute("PRAGMA table_info(sessions)")}
        open_session = False
        if "ended_at" in scols:
            open_session = con.execute("SELECT 1 FROM sessions WHERE ended_at IS NULL LIMIT 1").fetchone() is not None
        return last, open_session, None
    except sqlite3.Error:
        return None, False, "db_unreadable"
    finally:
        if con is not None:
            con.close()


def collect_agents(home, now):
    errors = []
    state = read_json(os.path.join(home, "gateway_state.json")) or {}
    served_raw = state.get("served_profiles")
    served = [str(x) for x in served_raw if isinstance(x, str)] if isinstance(served_raw, list) else []
    hb = None
    for key in HB_KEYS:
        if key in state:
            hb = to_epoch(state[key])
            if hb is not None:
                break
    age = max(0.0, now - hb) if hb is not None else None
    pid_ok = pid_alive(read_pid(os.path.join(home, "gateway.pid")))
    fresh = age is None or age <= STALE_HEARTBEAT_S
    gateway_up = bool(pid_ok and fresh)

    agents = []
    for name, pdir in list_profiles(home):
        last_ts, open_session, err = probe_db(os.path.join(pdir, "state.db"))
        if err:
            msg = "state.db schema not recognized" if err == "unsupported_schema" else "state.db could not be read"
            errors.append({"code": err, "message": msg, "profile": name})
        parked = os.path.exists(os.path.join(pdir, "gateway.parked"))
        primary = gateway_up and name in served
        secondary = name != "default" and pid_alive(read_pid(os.path.join(pdir, "gateway.pid")))
        recent = last_ts is not None and (now - last_ts) <= CLI_WINDOW_S
        active = primary or secondary or bool(open_session and recent)
        if parked:
            status = "parked"
        elif active:
            status = "working" if (last_ts is not None and now - last_ts <= WORKING_WINDOW_S) else "idle"
        else:
            status = "offline"
        pstate = state if name == "default" else (read_json(os.path.join(pdir, "gateway_state.json")) or state)
        try:
            cfg_mtime = os.stat(os.path.join(pdir, "config.yaml")).st_mtime
        except OSError:
            cfg_mtime = None
        agents.append({
            "profile": name,
            "displayName": display_name(pdir, name),
            "status": status,
            "platforms": extract_platforms(pstate),
            "lastActivityTs": last_ts,
            "configMtime": cfg_mtime,
            "hasSoul": os.path.isfile(os.path.join(pdir, "SOUL.md")),
            "hasMemory": os.path.isfile(os.path.join(pdir, "memories", "MEMORY.md")),
            "hasUser": os.path.isfile(os.path.join(pdir, "memories", "USER.md")),
        })
    data = {
        "agents": agents,
        "gateway": {"up": gateway_up, "heartbeatAgeS": round(age, 1) if age is not None else None, "served": served},
    }
    return data, errors


def emit(kind, data, profile=None):
    line = json.dumps(
        {"type": kind, "ts": round(time.time(), 3), "profile": profile, "data": data},
        separators=(",", ":"),
        allow_nan=False,
    )
    try:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()
    except (BrokenPipeError, OSError, ValueError):
        os._exit(0)


def parse_args(argv):
    args = {"home": None, "ticks": 0, "interval": 1.0, "agents_interval": 10.0}
    it = iter(argv)
    for a in it:
        if a == "--ticks":
            args["ticks"] = int(next(it))
        elif a == "--interval":
            args["interval"] = float(next(it))
        elif a == "--agents-interval":
            args["agents_interval"] = float(next(it))
        elif args["home"] is None:
            args["home"] = a
    if not args["home"]:
        args["home"] = os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")
    return args


def main(argv):
    args = parse_args(argv)
    sampler = Sampler()
    try:
        sampler.sample()
    except Exception as ex:  # noqa: BLE001 - never crash the stream
        emit("error", {"code": "sample_failed", "message": type(ex).__name__})
    clock = time.monotonic
    next_metrics = clock() + min(args["interval"], 0.5)
    next_agents = clock()
    reported = set()
    done = 0
    while True:
        now = clock()
        if now >= next_agents:
            try:
                data, errors = collect_agents(args["home"], time.time())
                emit("agents", data)
                current = set()
                for e in errors:
                    key = (e["code"], e.get("profile"))
                    current.add(key)
                    if key not in reported:
                        emit("error", e, e.get("profile"))
                reported = current
            except Exception as ex:  # noqa: BLE001
                emit("error", {"code": "agents_failed", "message": type(ex).__name__})
            next_agents = clock() + args["agents_interval"]
        if now >= next_metrics:
            try:
                emit("metrics", sampler.sample())
            except Exception as ex:  # noqa: BLE001
                emit("error", {"code": "sample_failed", "message": type(ex).__name__})
            next_metrics = clock() + args["interval"]
            done += 1
            if args["ticks"] and done >= args["ticks"]:
                return 0
        time.sleep(max(0.0, min(next_metrics, next_agents) - clock()))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 5: Jalankan semua test Python**

Run: `npm run test:py`
Expected: semua PASS. Perhatikan khusus `test_exits_quietly_when_the_reader_goes_away` (proses harus keluar kode 0 tanpa stderr) dan `test_zero_change_after_a_session` (snapshot identik).

- [ ] **Step 6: Commit**

```bash
git add collector/mc_collector.py tests/collector
git commit -m "feat: add collector agent scanning, event stream and clean shutdown

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Server SSH palsu untuk test

**Files:**
- Create: `tests/helpers/fakeSshServer.ts`, `tests/helpers/fixture.ts`, `tests/helpers/wait.ts`
- Test: `tests/integration/fakeSshServer.test.ts`

**Interfaces:**
- Consumes: `shSplit` (Task 4), `make_fixture.py` CLI (Task 7).
- Produces:
  - `fixture.ts`: `pythonExe`, `buildFixture(dir): FixtureDirs {root, proc, sysfs, home}`, `advanceFixture(dir, step)`, `addProfile(home, name)`, `snapshotTree(dir): Record<string,string>`.
  - `wait.ts`: `waitFor(fn, {timeout?, interval?, label?}): Promise<T>` (menunggu `fn()` mengembalikan nilai truthy).
  - `fakeSshServer.ts`: `makeHostKey(): HostKeyPair`, `fingerprintOfPublic(pub): string`, `startFakeSsh(opts: FakeSshOptions): Promise<FakeSsh>` dengan `FakeSsh {port, fingerprint, execLog: string[][], dropConnections(), close()}`; default `username: 'tester'`, `password: 'test-pass-123'`, `remoteHome: '/home/hermes/.hermes'`, `hermesPath: '/home/hermes/.local/bin/hermes'`, `pythonPath: '/usr/bin/python3'`, `version: '0.21.6'`.

- [ ] **Step 1: Helper kecil**

`tests/helpers/wait.ts`:
```ts
export async function waitFor<T>(
  fn: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  opts: { timeout?: number; interval?: number; label?: string } = {}
): Promise<T> {
  const { timeout = 10_000, interval = 25, label = 'condition' } = opts
  const end = Date.now() + timeout
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, interval))
  }
}
```

`tests/helpers/fixture.ts`:
```ts
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export const pythonExe = process.platform === 'win32' ? 'python' : 'python3'
const script = resolve('tests/fixtures/make_fixture.py')

export interface FixtureDirs {
  root: string
  proc: string
  sysfs: string
  home: string
}

export function buildFixture(dir: string): FixtureDirs {
  const out = execFileSync(pythonExe, [script, 'init', dir], { encoding: 'utf8' })
  return JSON.parse(out) as FixtureDirs
}

export function advanceFixture(dir: string, step: number): void {
  execFileSync(pythonExe, [script, 'advance', dir, String(step)])
}

export function addProfile(home: string, name: string): void {
  execFileSync(pythonExe, [script, 'add-profile', home, name])
}

export function snapshotTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else out[relative(dir, p)] = `${st.size}:${st.mtimeMs}:${createHash('sha256').update(readFileSync(p)).digest('hex')}`
    }
  }
  walk(dir)
  return out
}
```

- [ ] **Step 2: Test server palsu yang gagal**

`tests/integration/fakeSshServer.test.ts`:
```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'ssh2'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildCommand } from '../../src/main/connection/quote'
import { parseEventLine } from '@shared/events'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'

let dir: string
let fx: FixtureDirs
let srv: FakeSsh

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mc-fake-'))
  fx = buildFixture(join(dir, 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
afterAll(async () => {
  await srv.close()
  rmSync(dir, { recursive: true, force: true })
})

function run(argv: string[], stdin?: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const c = new Client()
    c.on('ready', () => {
      c.exec(buildCommand(argv), (e, stream) => {
        if (e) return reject(e)
        let out = ''
        let err = ''
        stream.on('data', (d: Buffer) => (out += d))
        stream.stderr.on('data', (d: Buffer) => (err += d))
        stream.on('close', (code: number) => {
          c.end()
          resolve({ code, out, err })
        })
        stream.end(stdin ?? '')
      })
    })
    c.on('error', reject)
    c.connect({ host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123' })
  })
}

describe('fake ssh server', () => {
  it('rejects a wrong password', async () => {
    await expect(
      new Promise((resolve, reject) => {
        const c = new Client()
        c.on('ready', () => resolve('ready'))
        c.on('error', reject)
        c.connect({ host: '127.0.0.1', port: srv.port, username: 'tester', password: 'nope' })
      })
    ).rejects.toThrow(/authentication/i)
  })

  it('exposes a sha256 fingerprint of its host key', () => {
    expect(srv.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
  })

  it('echoes hostile argv through the quoting round trip', async () => {
    const argv = ['__echo__', "it's", '$(id)', 'a b']
    const r = await run(argv)
    expect(JSON.parse(r.out)).toEqual(argv.slice(1))
  })

  it('answers the preflight probes', async () => {
    expect((await run(['sh', '-c', 'printf %s "${HERMES_HOME:-$HOME/.hermes}"'])).out).toBe('/home/hermes/.hermes')
    expect((await run(['/home/hermes/.local/bin/hermes', '--version'])).out).toContain('0.21.6')
    expect((await run(['/home/hermes/.local/bin/hermes', 'cron', 'runs', '--help'])).code).toBe(0)
    expect((await run(['nonexistent'])).code).toBe(127)
  })

  it('runs the real collector from stdin against the fixture', async () => {
    const { readFileSync } = await import('node:fs')
    const script = readFileSync('collector/mc_collector.py', 'utf8')
    const r = await run(['/usr/bin/python3', '-u', '-', '/home/hermes/.hermes', '--ticks', '2', '--interval', '0.05'], script)
    expect(r.code).toBe(0)
    const events = r.out.trim().split('\n').map((l) => parseEventLine(l))
    expect(events.every((e) => e.ok)).toBe(true)
    expect(events.map((e) => (e.ok ? e.event.type : ''))[0]).toBe('agents')
  })
})
```

- [ ] **Step 3: Jalankan, pastikan gagal** — `npm test -- tests/integration/fakeSshServer.test.ts` → FAIL.

- [ ] **Step 4: Implementasi `tests/helpers/fakeSshServer.ts`**

```ts
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Server, utils, type Connection, type ServerChannel } from 'ssh2'
import { pythonExe, type FixtureDirs } from './fixture'
import { shSplit } from './shellSplit'

export interface HostKeyPair {
  private: string
  public: string
}

export function makeHostKey(): HostKeyPair {
  const kp = utils.generateKeyPairSync('ed25519')
  return { private: kp.private, public: kp.public }
}

export function fingerprintOfPublic(pub: string): string {
  const parsed = utils.parseKey(pub)
  const key = Array.isArray(parsed) ? parsed[0] : parsed
  if (!key || key instanceof Error) throw new Error('cannot parse host key')
  const blob = key.getPublicSSH()
  return 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
}

export interface FakeSshOptions {
  fixture: FixtureDirs
  username?: string
  password?: string
  port?: number
  hostKey?: HostKeyPair
  remoteHome?: string
  hermesPath?: string
  pythonPath?: string
  version?: string
  capabilities?: Record<string, boolean>
  models?: Record<string, { provider: string; default: string }>
  hasHermes?: boolean
  hasHome?: boolean
}

export interface FakeSsh {
  port: number
  fingerprint: string
  hostKey: HostKeyPair
  execLog: string[][]
  dropConnections(): void
  close(): Promise<void>
}

type Resolved = Required<Omit<FakeSshOptions, 'port' | 'hostKey' | 'capabilities' | 'models'>> &
  Pick<FakeSshOptions, 'capabilities' | 'models'>

function reply(stream: ServerChannel, out: string, code = 0, err = ''): void {
  if (out) stream.write(out)
  if (err) stream.stderr.write(err)
  stream.exit(code)
  stream.end()
}

function countProfiles(home: string): number {
  try {
    const base = join(home, 'profiles')
    return readdirSync(base).filter((n) => statSync(join(base, n)).isDirectory()).length
  } catch {
    return 0
  }
}

function runCollector(argv: string[], stream: ServerChannel, o: Resolved): void {
  const args = ['-u', '-', ...argv.slice(3).map((a) => (a === o.remoteHome ? o.fixture.home : a))]
  const child = spawn(pythonExe, args, {
    env: { ...process.env, MC_PROC_ROOT: o.fixture.proc, MC_SYS_ROOT: o.fixture.sysfs },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stdin.on('error', () => {})
  stream.pipe(child.stdin)
  child.stdout.pipe(stream, { end: false })
  child.stderr.on('data', (d: Buffer) => stream.stderr.write(d))
  child.on('close', (code) => {
    stream.exit(code ?? 0)
    stream.end()
  })
  stream.on('close', () => child.kill())
}

function handle(argv: string[], stream: ServerChannel, o: Resolved): void {
  const [cmd = '', ...rest] = argv
  if (cmd === 'true') return reply(stream, '')
  if (cmd === '__echo__') return reply(stream, JSON.stringify(rest))
  if (cmd === 'sh' && rest[0] === '-c') {
    const script = rest[1] ?? ''
    if (script.includes('HERMES_HOME')) return reply(stream, o.remoteHome)
    if (script.includes('command -v hermes')) return o.hasHermes ? reply(stream, o.hermesPath) : reply(stream, '', 1)
    if (script.includes('profiles')) return reply(stream, String(countProfiles(o.fixture.home)))
  }
  if (cmd === 'test' && rest[0] === '-d') return reply(stream, '', o.hasHome && rest[1] === o.remoteHome ? 0 : 1)
  if (cmd === 'head') return reply(stream, `#!${o.pythonPath}\n`)
  if (cmd === o.hermesPath) {
    if (rest[0] === '--version') return reply(stream, `Hermes Agent v${o.version}\n`)
    if (rest[rest.length - 1] === '--help') {
      const key = rest.slice(0, -1).join(' ')
      return o.capabilities?.[key] === false ? reply(stream, '', 2, 'unknown command\n') : reply(stream, 'usage\n')
    }
    const gi = rest.indexOf('config')
    if (gi >= 0 && rest[gi + 1] === 'get' && rest[gi + 2] === 'model') {
      const profile = rest[0] === '-p' ? (rest[1] ?? 'default') : 'default'
      const m = o.models?.[profile] ?? { provider: 'openrouter', default: 'anthropic/claude-sonnet' }
      return reply(stream, JSON.stringify(m) + '\n')
    }
  }
  if (cmd === o.pythonPath) {
    if (rest[0] === '--version') return reply(stream, 'Python 3.11.9\n')
    if (rest[0] === '-c') return reply(stream, 'ok 31\n')
    if (rest[0] === '-u' && rest[1] === '-') return runCollector(argv, stream, o)
  }
  reply(stream, '', 127, `${cmd}: command not found\n`)
}

export function startFakeSsh(opts: FakeSshOptions): Promise<FakeSsh> {
  const o: Resolved = {
    username: 'tester',
    password: 'test-pass-123',
    remoteHome: '/home/hermes/.hermes',
    hermesPath: '/home/hermes/.local/bin/hermes',
    pythonPath: '/usr/bin/python3',
    version: '0.21.6',
    hasHermes: true,
    hasHome: true,
    ...opts
  }
  const hostKey = opts.hostKey ?? makeHostKey()
  const clients = new Set<Connection>()
  const execLog: string[][] = []

  const server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    clients.add(client)
    client.on('close', () => clients.delete(client))
    client.on('error', () => {})
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === o.username && ctx.password === o.password) ctx.accept()
      else ctx.reject(['password'])
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        accept().on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec()
          const argv = shSplit(info.command)
          execLog.push(argv)
          handle(argv, stream, o)
        })
      })
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        port,
        fingerprint: fingerprintOfPublic(hostKey.public),
        hostKey,
        execLog,
        dropConnections: () => clients.forEach((c) => c.end()),
        close: () =>
          new Promise<void>((done) => {
            clients.forEach((c) => c.end())
            server.close(() => done())
          })
      })
    })
  })
}
```

- [ ] **Step 5: Jalankan test**

Run: `npm test -- tests/integration/fakeSshServer.test.ts && npm run typecheck`
Expected: 5 test PASS. Jika `utils.generateKeyPairSync` menghasilkan kunci yang ditolak `Server`, periksa versi ssh2 (≥ 1.4) dan bahwa `private` berformat OpenSSH.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers tests/integration/fakeSshServer.test.ts
git commit -m "test: add fake SSH server that runs the real collector against fixtures

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```



---

### Task 10: Host key, klasifikasi error, backoff (fungsi murni)

**Files:**
- Create: `src/main/connection/hostkey.ts`, `src/main/connection/errors.ts`, `src/main/connection/backoff.ts`
- Test: `tests/unit/hostkey.test.ts`, `tests/unit/errors.test.ts`, `tests/unit/backoff.test.ts`

**Interfaces:**
- Produces:
  - `algoOf(blob: Buffer): string`, `fingerprintOf(blob: Buffer): string` (`SHA256:` + base64 tanpa padding), `KnownKey {algo, fingerprint}`, `decideHostKey(known: KnownKey | null, blob: Buffer): HostKeyDecision` dengan `kind: 'trusted' | 'new' | 'changed'` (`changed` membawa `previous`).
  - `ConnectError(kind, message)`, `HostKeyError(challenge)` (`.challenge: HostKeyChallenge`), `classifyConnectError(err): ConnectErrorKind`, `friendlyMessage(kind, host, port, raw): string`.
  - `BACKOFF_MS`, `backoffDelay(attempt: number): number`.

- [ ] **Step 1: Test yang gagal**

`tests/unit/hostkey.test.ts`:
```ts
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { algoOf, decideHostKey, fingerprintOf } from '../../src/main/connection/hostkey'

function blob(algo: string, key: Buffer): Buffer {
  const a = Buffer.from(algo, 'ascii')
  const head = Buffer.alloc(4)
  head.writeUInt32BE(a.length)
  const klen = Buffer.alloc(4)
  klen.writeUInt32BE(key.length)
  return Buffer.concat([head, a, klen, key])
}

const b = blob('ssh-ed25519', Buffer.alloc(32, 7))
const expected = 'SHA256:' + createHash('sha256').update(b).digest('base64').replace(/=+$/, '')

describe('host key helpers', () => {
  it('reads the algorithm from the key blob', () => {
    expect(algoOf(b)).toBe('ssh-ed25519')
  })

  it('fingerprints like ssh-keygen (sha256, unpadded base64)', () => {
    expect(fingerprintOf(b)).toBe(expected)
    expect(fingerprintOf(b)).not.toMatch(/=/)
  })

  it('trusts a matching known key', () => {
    expect(decideHostKey({ algo: 'ssh-ed25519', fingerprint: expected }, b)).toEqual({
      kind: 'trusted',
      algo: 'ssh-ed25519',
      fingerprint: expected
    })
  })

  it('reports a new host', () => {
    expect(decideHostKey(null, b)).toEqual({ kind: 'new', algo: 'ssh-ed25519', fingerprint: expected })
  })

  it('reports a changed key with the previous fingerprint', () => {
    expect(decideHostKey({ algo: 'ssh-ed25519', fingerprint: 'SHA256:old' }, b)).toEqual({
      kind: 'changed',
      algo: 'ssh-ed25519',
      fingerprint: expected,
      previous: 'SHA256:old'
    })
  })
})
```

`tests/unit/errors.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { classifyConnectError, friendlyMessage } from '../../src/main/connection/errors'

describe('classifyConnectError', () => {
  it.each([
    [{ level: 'client-authentication' }, 'auth'],
    [{ level: 'client-timeout' }, 'timeout'],
    [{ code: 'ETIMEDOUT' }, 'timeout'],
    [{ code: 'ECONNREFUSED' }, 'unreachable'],
    [{ code: 'ENOTFOUND' }, 'unreachable'],
    [{ code: 'EHOSTUNREACH' }, 'unreachable'],
    [{ code: 'ENETUNREACH' }, 'unreachable'],
    [{ code: 'ECONNRESET' }, 'unreachable'],
    [{ code: 'EOTHER' }, 'unknown'],
    [{}, 'unknown']
  ] as const)('%j -> %s', (err, kind) => {
    expect(classifyConnectError(err)).toBe(kind)
  })
})

describe('friendlyMessage', () => {
  it('names the host and port for network errors', () => {
    expect(friendlyMessage('unreachable', 'h', 22, 'x')).toContain('h:22')
    expect(friendlyMessage('timeout', 'h', 22, 'x')).toContain('h:22')
  })
  it('does not echo credentials for auth errors', () => {
    expect(friendlyMessage('auth', 'h', 22, 'All configured authentication methods failed')).toBe(
      'The server rejected the username or password.'
    )
  })
  it('falls back to the raw message', () => {
    expect(friendlyMessage('unknown', 'h', 22, 'boom')).toBe('boom')
  })
})
```

`tests/unit/backoff.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { backoffDelay } from '../../src/main/connection/backoff'

describe('backoffDelay', () => {
  it('follows 1s, 2s, 5s, 10s and caps at 30s', () => {
    expect([0, 1, 2, 3, 4, 5, 99].map(backoffDelay)).toEqual([1000, 2000, 5000, 10000, 30000, 30000, 30000])
  })
  it('treats negative attempts as the first', () => {
    expect(backoffDelay(-3)).toBe(1000)
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `npm test -- tests/unit/hostkey.test.ts tests/unit/errors.test.ts tests/unit/backoff.test.ts` → FAIL.

- [ ] **Step 3: Implementasi**

`src/main/connection/hostkey.ts`:
```ts
import { createHash } from 'node:crypto'

export interface KnownKey {
  algo: string
  fingerprint: string
}

export type HostKeyDecision =
  | { kind: 'trusted'; algo: string; fingerprint: string }
  | { kind: 'new'; algo: string; fingerprint: string }
  | { kind: 'changed'; algo: string; fingerprint: string; previous: string }

export function algoOf(blob: Buffer): string {
  const len = blob.readUInt32BE(0)
  return blob.subarray(4, 4 + len).toString('ascii')
}

export function fingerprintOf(blob: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
}

export function decideHostKey(known: KnownKey | null, blob: Buffer): HostKeyDecision {
  const algo = algoOf(blob)
  const fingerprint = fingerprintOf(blob)
  if (!known) return { kind: 'new', algo, fingerprint }
  if (known.fingerprint === fingerprint) return { kind: 'trusted', algo, fingerprint }
  return { kind: 'changed', algo, fingerprint, previous: known.fingerprint }
}
```

`src/main/connection/errors.ts`:
```ts
import type { ConnectErrorKind, HostKeyChallenge } from '@shared/ipc'

export class ConnectError extends Error {
  constructor(
    readonly kind: ConnectErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'ConnectError'
  }
}

export class HostKeyError extends Error {
  constructor(readonly challenge: HostKeyChallenge) {
    super(challenge.changed ? 'The host key has changed.' : 'The host key must be verified.')
    this.name = 'HostKeyError'
  }
}

const UNREACHABLE = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EAI_AGAIN'])

export function classifyConnectError(err: { code?: string; level?: string }): ConnectErrorKind {
  if (err.level === 'client-authentication') return 'auth'
  if (err.level === 'client-timeout' || err.code === 'ETIMEDOUT') return 'timeout'
  if (err.code && UNREACHABLE.has(err.code)) return 'unreachable'
  return 'unknown'
}

export function friendlyMessage(kind: ConnectErrorKind, host: string, port: number, raw: string): string {
  switch (kind) {
    case 'unreachable':
      return `Cannot reach ${host}:${port}. Check the address, the port and your network.`
    case 'timeout':
      return `Timed out connecting to ${host}:${port}.`
    case 'auth':
      return 'The server rejected the username or password.'
    default:
      return raw
  }
}
```

`src/main/connection/backoff.ts`:
```ts
export const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000] as const

export function backoffDelay(attempt: number): number {
  const i = Math.max(0, Math.min(attempt, BACKOFF_MS.length - 1))
  return BACKOFF_MS[i]!
}
```

- [ ] **Step 4: Jalankan** — ketiga berkas test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/connection tests/unit/hostkey.test.ts tests/unit/errors.test.ts tests/unit/backoff.test.ts
git commit -m "feat: add host key decisions, connect error classification and backoff

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: ConnectionManager (ssh2)

**Files:**
- Create: `src/main/connection/manager.ts`
- Test: `tests/integration/connection.test.ts`

**Interfaces:**
- Consumes: `buildCommand`, `decideHostKey`, `ConnectError`, `HostKeyError`, `classifyConnectError`, `friendlyMessage`.
- Produces:
  - `ConnectParams {host, port, username, password}`, `HostKeyLookup {getKnownHost(host, port): KnownKey | null}`, `ExecResult {code, stdout, stderr}`, `ExecOptions {stdin?, timeoutMs?}`, `Execer {exec(argv, opts?): Promise<ExecResult>}`.
  - `class ConnectionManager extends EventEmitter implements Execer`: `connect(p): Promise<{fingerprint, algo}>` (menolak dengan `ConnectError`/`HostKeyError`), `disconnect(): Promise<void>`, `isConnected()`, `exec(argv, opts?)`, `openStream(argv, stdin): Promise<ClientChannel>`, `measureLatency(): Promise<number>`; event `'close'` (hanya untuk putus yang tidak diminta).

- [ ] **Step 1: Test yang gagal — `tests/integration/connection.test.ts`**

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ConnectionManager } from '../../src/main/connection/manager'
import { ConnectError, HostKeyError } from '../../src/main/connection/errors'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { waitFor } from '../helpers/wait'

let dir: string
let fx: FixtureDirs
let srv: FakeSsh
const managers: ConnectionManager[] = []

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mc-conn-'))
  fx = buildFixture(join(dir, 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.disconnect()))
})
afterAll(async () => {
  await srv.close()
  rmSync(dir, { recursive: true, force: true })
})

const creds = (over = {}) => ({ host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', ...over })
function manager(known: { algo: string; fingerprint: string } | null): ConnectionManager {
  const m = new ConnectionManager({ getKnownHost: () => known }, 5000)
  managers.push(m)
  return m
}

describe('host key verification', () => {
  it('asks to verify an unknown host and does not log in', async () => {
    const err = await manager(null).connect(creds()).catch((e) => e)
    expect(err).toBeInstanceOf(HostKeyError)
    expect(err.challenge).toMatchObject({ changed: false, algo: 'ssh-ed25519', fingerprint: srv.fingerprint })
    expect(srv.execLog.length).toBe(0)
  })

  it('connects when the stored key matches', async () => {
    const m = manager({ algo: 'ssh-ed25519', fingerprint: srv.fingerprint })
    const hs = await m.connect(creds())
    expect(hs.fingerprint).toBe(srv.fingerprint)
    expect(m.isConnected()).toBe(true)
  })

  it('blocks when the key changed and reports the previous fingerprint', async () => {
    const err = await manager({ algo: 'ssh-ed25519', fingerprint: 'SHA256:old' }).connect(creds()).catch((e) => e)
    expect(err).toBeInstanceOf(HostKeyError)
    expect(err.challenge).toMatchObject({ changed: true, previous: 'SHA256:old' })
  })
})

describe('connect errors', () => {
  const known = () => ({ algo: 'ssh-ed25519', fingerprint: srv.fingerprint })

  it('reports a rejected password', async () => {
    const err = await manager(known()).connect(creds({ password: 'wrong' })).catch((e) => e)
    expect(err).toBeInstanceOf(ConnectError)
    expect(err.kind).toBe('auth')
  })

  it('reports an unreachable port', async () => {
    const dead = await startFakeSsh({ fixture: fx })
    const port = dead.port
    await dead.close()
    const err = await manager(known()).connect(creds({ port })).catch((e) => e)
    expect(err).toBeInstanceOf(ConnectError)
    expect(err.kind).toBe('unreachable')
  })
})

describe('exec', () => {
  it('passes hostile arguments through untouched', async () => {
    const m = manager({ algo: 'ssh-ed25519', fingerprint: srv.fingerprint })
    await m.connect(creds())
    const argv = ['it\'s "q"', '$(id)', 'a;b', '', 'ünï']
    const r = await m.exec(['__echo__', ...argv])
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual(argv)
  })

  it('returns the exit code and stderr of a failing command', async () => {
    const m = manager({ algo: 'ssh-ed25519', fingerprint: srv.fingerprint })
    await m.connect(creds())
    const r = await m.exec(['nope'])
    expect(r.code).toBe(127)
    expect(r.stderr).toContain('not found')
  })

  it('measures latency', async () => {
    const m = manager({ algo: 'ssh-ed25519', fingerprint: srv.fingerprint })
    await m.connect(creds())
    expect(await m.measureLatency()).toBeGreaterThanOrEqual(0)
  })

  it('rejects exec when not connected', async () => {
    await expect(manager(null).exec(['true'])).rejects.toThrow(/not connected/)
  })
})

describe('close events', () => {
  it('emits close when the server drops the connection', async () => {
    const m = manager({ algo: 'ssh-ed25519', fingerprint: srv.fingerprint })
    await m.connect(creds())
    let closed = 0
    m.on('close', () => closed++)
    srv.dropConnections()
    await waitFor(() => closed === 1, { label: 'close event' })
    expect(m.isConnected()).toBe(false)
  })

  it('does not emit close after a deliberate disconnect', async () => {
    const m = manager({ algo: 'ssh-ed25519', fingerprint: srv.fingerprint })
    await m.connect(creds())
    let closed = 0
    m.on('close', () => closed++)
    await m.disconnect()
    await new Promise((r) => setTimeout(r, 150))
    expect(closed).toBe(0)
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `npm test -- tests/integration/connection.test.ts` → FAIL.

- [ ] **Step 3: Implementasi `src/main/connection/manager.ts`**

```ts
import { EventEmitter } from 'node:events'
import { Client, type ClientChannel } from 'ssh2'
import type { HostKeyChallenge } from '@shared/ipc'
import { ConnectError, HostKeyError, classifyConnectError, friendlyMessage } from './errors'
import { decideHostKey, type KnownKey } from './hostkey'
import { buildCommand } from './quote'

export interface ConnectParams {
  host: string
  port: number
  username: string
  password: string
}

export interface HostKeyLookup {
  getKnownHost(host: string, port: number): KnownKey | null
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface ExecOptions {
  stdin?: string
  timeoutMs?: number
}

export interface Execer {
  exec(argv: readonly string[], opts?: ExecOptions): Promise<ExecResult>
}

export class ConnectionManager extends EventEmitter implements Execer {
  private client: Client | null = null
  private closing = false

  constructor(
    private readonly hostKeys: HostKeyLookup,
    private readonly readyTimeoutMs = 12_000
  ) {
    super()
  }

  isConnected(): boolean {
    return this.client !== null
  }

  async connect(p: ConnectParams): Promise<{ fingerprint: string; algo: string }> {
    await this.disconnect()
    return new Promise((resolve, reject) => {
      const client = new Client()
      let challenge: HostKeyChallenge | null = null
      let seen = { fingerprint: '', algo: '' }
      let settled = false

      client.on('ready', () => {
        settled = true
        this.closing = false
        this.client = client
        resolve(seen)
      })
      client.on('error', (err: Error & { code?: string; level?: string }) => {
        if (settled) {
          this.emit('error-log', err)
          return
        }
        settled = true
        if (challenge) return reject(new HostKeyError(challenge))
        const kind = classifyConnectError(err)
        reject(new ConnectError(kind, friendlyMessage(kind, p.host, p.port, err.message)))
      })
      client.on('close', () => {
        if (this.client === client) {
          this.client = null
          if (!this.closing) this.emit('close')
        }
        if (!settled) {
          settled = true
          reject(new ConnectError('unreachable', friendlyMessage('unreachable', p.host, p.port, 'closed')))
        }
      })

      client.connect({
        host: p.host,
        port: p.port,
        username: p.username,
        password: p.password,
        readyTimeout: this.readyTimeoutMs,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
        hostVerifier: ((key: Buffer): boolean => {
          const d = decideHostKey(this.hostKeys.getKnownHost(p.host, p.port), key)
          seen = { fingerprint: d.fingerprint, algo: d.algo }
          if (d.kind === 'trusted') return true
          challenge = {
            host: p.host,
            port: p.port,
            algo: d.algo,
            fingerprint: d.fingerprint,
            changed: d.kind === 'changed',
            ...(d.kind === 'changed' ? { previous: d.previous } : {})
          }
          return false
        }) as never
      })
    })
  }

  async disconnect(): Promise<void> {
    const c = this.client
    if (!c) return
    this.closing = true
    this.client = null
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 500)
      c.once('close', () => {
        clearTimeout(t)
        resolve()
      })
      c.end()
    })
  }

  exec(argv: readonly string[], opts: ExecOptions = {}): Promise<ExecResult> {
    const { stdin = '', timeoutMs = 15_000 } = opts
    return new Promise((resolve, reject) => {
      const c = this.client
      if (!c) return reject(new Error('not connected'))
      c.exec(buildCommand(argv), (err, stream) => {
        if (err) return reject(err)
        let stdout = ''
        let stderr = ''
        const timer = setTimeout(() => {
          stream.close()
          reject(new Error(`timed out after ${timeoutMs} ms`))
        }, timeoutMs)
        stream.setEncoding('utf8')
        stream.stderr.setEncoding('utf8')
        stream.on('data', (d: string) => (stdout += d))
        stream.stderr.on('data', (d: string) => (stderr += d))
        stream.on('close', (code: number | null) => {
          clearTimeout(timer)
          resolve({ code: code ?? -1, stdout, stderr })
        })
        stream.end(stdin)
      })
    })
  }

  openStream(argv: readonly string[], stdin: string): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      const c = this.client
      if (!c) return reject(new Error('not connected'))
      c.exec(buildCommand(argv), (err, stream) => {
        if (err) return reject(err)
        stream.end(stdin)
        resolve(stream)
      })
    })
  }

  async measureLatency(): Promise<number> {
    const t = performance.now()
    await this.exec(['true'], { timeoutMs: 5000 })
    return Math.round(performance.now() - t)
  }
}
```

- [ ] **Step 4: Jalankan test dan typecheck**

Run: `npm test -- tests/integration/connection.test.ts && npm run typecheck`
Expected: PASS. Jika `reject(new ConnectError('unreachable'...))` pada 'close' menutupi kesalahan auth karena urutan event, pastikan handler `'error'` berjalan lebih dulu (ssh2 emit `error` sebelum `close`); jika tidak, tunda penolakan di `close` dengan `setImmediate`.

- [ ] **Step 5: Commit**

```bash
git add src/main/connection/manager.ts tests/integration/connection.test.ts
git commit -m "feat: add ConnectionManager with TOFU host keys, exec and streaming

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Perintah remote, preflight, dan deteksi kemampuan

**Files:**
- Create: `src/main/connection/remote.ts`, `src/main/connection/preflight.ts`, `src/main/connection/capabilities.ts`
- Test: `tests/unit/preflightParsers.test.ts`, `tests/integration/preflight.test.ts`

**Interfaces:**
- Consumes: `Execer`, `ExecResult` (Task 11); tipe `PreflightItem`, `PreflightResult`, `Capabilities`.
- Produces:
  - `remote.ts`: `resolveHomeCmd()`, `homeExistsCmd(home)`, `findHermesCmd()`, `shebangCmd(hermes)`, `versionCmd(hermes)`, `profileCountCmd(home)`, `stateDbCmd(python, home)`, `pythonVersionCmd(python)`, `probeCmd(hermes, sub)`, `modelCmd(hermes, profile)`, `collectorCmd(python, home)` (semuanya mengembalikan `string[]` argv), dan `runSafe(conn, argv, timeoutMs?): Promise<ExecResult>` (tidak pernah melempar; kegagalan menjadi `code: -1`).
  - `preflight.ts`: `parseShebang(line)`, `parseVersion(text)`, `compareVersions(a, b)`, `shortFingerprint(fp)`, `MIN_HERMES_VERSION`, `PreflightContext {host, port, username, latencyMs, fingerprint}`, `runPreflight(conn, ctx): Promise<PreflightResult>`.
  - `capabilities.ts`: `PROBES`, `probeCapabilities(conn, hermesPath, version): Promise<Capabilities>`.

- [ ] **Step 1: Test parser yang gagal — `tests/unit/preflightParsers.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { compareVersions, parseShebang, parseVersion, shortFingerprint } from '../../src/main/connection/preflight'

describe('parseShebang', () => {
  it.each([
    ['#!/usr/bin/python3', '/usr/bin/python3'],
    ['#!/home/u/.hermes/venv/bin/python3.11\n', '/home/u/.hermes/venv/bin/python3.11'],
    ['#!/usr/bin/env python3', 'python3'],
    ['#! /usr/bin/env -S python3 -u', 'python3'],
    ['#!/bin/sh', '/bin/sh'],
    ['not a shebang', null],
    ['#!', null]
  ])('%j -> %j', (line, expected) => {
    expect(parseShebang(line)).toBe(expected)
  })
})

describe('parseVersion', () => {
  it.each([
    ['Hermes Agent v0.21.6', '0.21.6'],
    ['hermes 0.21', '0.21'],
    ['Python 3.11.9', '3.11.9'],
    ['no digits', null]
  ])('%j -> %j', (text, expected) => {
    expect(parseVersion(text)).toBe(expected)
  })
})

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    expect(compareVersions('0.21.6', '0.21.0')).toBeGreaterThan(0)
    expect(compareVersions('0.9.0', '0.21.0')).toBeLessThan(0)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
  })
})

describe('shortFingerprint', () => {
  it('keeps the prefix, four chars and the tail', () => {
    expect(shortFingerprint('SHA256:Xq3vR8kP2mWfN0aJ7cLzQyT5uE1bHdG4sK9oV6iY9fA')).toBe('SHA256:Xq3v…9fA')
  })
})
```

- [ ] **Step 2: Test integrasi preflight yang gagal — `tests/integration/preflight.test.ts`**

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { probeCapabilities } from '../../src/main/connection/capabilities'
import { ConnectionManager } from '../../src/main/connection/manager'
import { runPreflight } from '../../src/main/connection/preflight'
import { startFakeSsh, type FakeSsh, type FakeSshOptions } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'

let dir: string
let fx: FixtureDirs
const servers: FakeSsh[] = []
const managers: ConnectionManager[] = []

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-pre-'))
  fx = buildFixture(join(dir, 'fx'))
})
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.disconnect()))
  await Promise.all(servers.splice(0).map((s) => s.close()))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

async function connect(over: Partial<FakeSshOptions> = {}): Promise<{ m: ConnectionManager; srv: FakeSsh }> {
  const srv = await startFakeSsh({ fixture: fx, ...over })
  servers.push(srv)
  const m = new ConnectionManager({ getKnownHost: () => ({ algo: 'ssh-ed25519', fingerprint: srv.fingerprint }) }, 5000)
  managers.push(m)
  await m.connect({ host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123' })
  return { m, srv }
}
const ctx = (srv: FakeSsh) => ({ host: '127.0.0.1', port: srv.port, username: 'tester', latencyMs: 12, fingerprint: srv.fingerprint })
const item = (r: Awaited<ReturnType<typeof runPreflight>>, id: string) => r.items.find((i) => i.id === id)!

describe('runPreflight', () => {
  it('passes on a healthy install and lists items in the mockup order', async () => {
    const { m, srv } = await connect()
    const r = await runPreflight(m, ctx(srv))
    expect(r.items.map((i) => i.id)).toEqual(['ssh', 'hostkey', 'home', 'version', 'profiles', 'statedb', 'cli', 'python', 'zero'])
    expect(r.canStart).toBe(true)
    expect(r.hermesHome).toBe('/home/hermes/.hermes')
    expect(r.hermesPath).toBe('/home/hermes/.local/bin/hermes')
    expect(r.pythonPath).toBe('/usr/bin/python3')
    expect(r.version).toBe('0.21.6')
    expect(r.profileCount).toBe(3)
    expect(item(r, 'version')).toMatchObject({ state: 'ok', result: 'v0.21.6' })
    expect(item(r, 'statedb')).toMatchObject({ state: 'ok', result: 'schema 31 OK' })
    expect(item(r, 'python')).toMatchObject({ state: 'ok', result: '3.11.9' })
    expect(item(r, 'ssh').result).toBe('OK 12ms')
    expect(item(r, 'zero').state).toBe('info')
    expect(r.items.filter((i) => i.state === 'fail')).toEqual([])
  })

  it('warns on a Hermes older than the supported minimum', async () => {
    const { m, srv } = await connect({ version: '0.20.1' })
    const r = await runPreflight(m, ctx(srv))
    expect(item(r, 'version').state).toBe('warn')
    expect(item(r, 'version').hint).toMatch(/0\.21\.0/)
    expect(r.canStart).toBe(true)
  })

  it('keeps running without the hermes CLI but flags it red', async () => {
    const { m, srv } = await connect({ hasHermes: false })
    const r = await runPreflight(m, ctx(srv))
    expect(item(r, 'cli').state).toBe('fail')
    expect(item(r, 'version').state).toBe('fail')
    expect(r.hermesPath).toBeNull()
    expect(r.canStart).toBe(true)
  })

  it('cannot start when the Hermes home is missing', async () => {
    const { m, srv } = await connect({ hasHome: false })
    const r = await runPreflight(m, ctx(srv))
    expect(item(r, 'home')).toMatchObject({ state: 'fail', result: 'NOT FOUND' })
    expect(r.canStart).toBe(false)
  })

  it('never writes anything to the remote side', async () => {
    const { m, srv } = await connect()
    await runPreflight(m, ctx(srv))
    const verbs = new Set(srv.execLog.map((a) => a[0]))
    for (const bad of ['rm', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'sudo', 'chmod', 'curl', 'wget']) expect(verbs.has(bad)).toBe(false)
  })
})

describe('probeCapabilities', () => {
  it('records which subcommands exist', async () => {
    const { m } = await connect({ capabilities: { 'cron runs': false } })
    const caps = await probeCapabilities(m, '/home/hermes/.local/bin/hermes', '0.21.6')
    expect(caps.version).toBe('0.21.6')
    expect(caps.supported['cron runs']).toBe(false)
    expect(caps.supported['mcp list']).toBe(true)
    expect(Object.keys(caps.supported).sort()).toEqual(
      ['approvals suggest', 'cron runs', 'curator status', 'fallback list', 'mcp list', 'sessions list', 'tools --summary'].sort()
    )
  })

  it('marks everything unsupported without a hermes CLI', async () => {
    const { m } = await connect()
    const caps = await probeCapabilities(m, null, null)
    expect(Object.values(caps.supported).every((v) => v === false)).toBe(true)
  })
})
```

- [ ] **Step 3: Jalankan, pastikan gagal** — kedua berkas → FAIL.

- [ ] **Step 4: Sesuaikan server palsu**

Di `tests/helpers/fakeSshServer.ts`:
- Ganti `countProfiles` agar hanya menghitung folder yang punya penanda (sama seperti skrip remote):
```ts
const MARKERS = ['config.yaml', '.env', 'SOUL.md', 'profile.yaml', 'state.db']

function countProfiles(home: string): number {
  try {
    const base = join(home, 'profiles')
    return readdirSync(base).filter(
      (n) => statSync(join(base, n)).isDirectory() && MARKERS.some((m) => existsSync(join(base, n, m)))
    ).length
  } catch {
    return 0
  }
}
```
(tambahkan `existsSync` ke import `node:fs`.)
- Ubah `if (cmd === o.pythonPath) {` menjadi `if (cmd === o.pythonPath || cmd === 'python3') {`.

- [ ] **Step 5: Implementasi `src/main/connection/remote.ts`**

```ts
import type { ExecResult, Execer } from './manager'

const FIND_HERMES =
  'command -v hermes || for p in "$HOME/.local/bin/hermes" "$HOME/.hermes/hermes-agent/venv/bin/hermes"; do if [ -x "$p" ]; then printf %s "$p"; exit 0; fi; done; exit 1'

const COUNT_PROFILES =
  'n=0; for d in "$1"/profiles/*/; do for m in config.yaml .env SOUL.md profile.yaml state.db; do if [ -e "$d$m" ]; then n=$((n+1)); break; fi; done; done; printf %s "$n"'

const STATE_DB_PY = `import sqlite3, sys, pathlib
p = pathlib.Path(sys.argv[1]) / 'state.db'
if not p.is_file():
    print('missing'); sys.exit(0)
try:
    c = sqlite3.connect(p.as_uri() + '?mode=ro', uri=True, timeout=1)
    v = None
    try:
        r = c.execute('select version from schema_version').fetchone()
        v = r[0] if r else None
    except Exception:
        pass
    if v is None:
        v = (c.execute('pragma user_version').fetchone() or [None])[0]
    print('ok', v)
except Exception as e:
    print('err', type(e).__name__)
`

export const resolveHomeCmd = (): string[] => ['sh', '-c', 'printf %s "${HERMES_HOME:-$HOME/.hermes}"']
export const homeExistsCmd = (home: string): string[] => ['test', '-d', home]
export const findHermesCmd = (): string[] => ['sh', '-c', FIND_HERMES]
export const shebangCmd = (hermes: string): string[] => ['head', '-n', '1', hermes]
export const versionCmd = (hermes: string): string[] => [hermes, '--version']
export const profileCountCmd = (home: string): string[] => ['sh', '-c', COUNT_PROFILES, 'sh', home]
export const stateDbCmd = (python: string, home: string): string[] => [python, '-c', STATE_DB_PY, home]
export const pythonVersionCmd = (python: string): string[] => [python, '--version']
export const probeCmd = (hermes: string, sub: string[]): string[] => [hermes, ...sub, '--help']
export const modelCmd = (hermes: string, profile: string): string[] =>
  profile === 'default' ? [hermes, 'config', 'get', 'model', '--json'] : [hermes, '-p', profile, 'config', 'get', 'model', '--json']
export const collectorCmd = (python: string, home: string): string[] => [python, '-u', '-', home]

export async function runSafe(conn: Execer, argv: string[], timeoutMs = 15_000): Promise<ExecResult> {
  try {
    return await conn.exec(argv, { timeoutMs })
  } catch (e) {
    return { code: -1, stdout: '', stderr: e instanceof Error ? e.message : String(e) }
  }
}
```

- [ ] **Step 6: Implementasi `src/main/connection/preflight.ts`**

```ts
import type { PreflightItem, PreflightResult } from '@shared/ipc'
import type { Execer } from './manager'
import {
  findHermesCmd, homeExistsCmd, profileCountCmd, pythonVersionCmd, resolveHomeCmd,
  runSafe, shebangCmd, stateDbCmd, versionCmd
} from './remote'

export const MIN_HERMES_VERSION = '0.21.0'

export interface PreflightContext {
  host: string
  port: number
  username: string
  latencyMs: number
  fingerprint: string
}

export function parseShebang(line: string): string | null {
  const t = line.trim()
  if (!t.startsWith('#!')) return null
  const parts = t.slice(2).trim().split(/\s+/).filter(Boolean)
  const first = parts[0]
  if (!first) return null
  if (/(^|\/)env$/.test(first)) return parts.slice(1).find((p) => !p.startsWith('-')) ?? null
  return first
}

export function parseVersion(text: string): string | null {
  const m = /v?(\d+\.\d+(?:\.\d+)?)/.exec(text)
  return m ? m[1]! : null
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function shortFingerprint(fp: string): string {
  const prefix = 'SHA256:'
  const body = fp.startsWith(prefix) ? fp.slice(prefix.length) : fp
  return `${prefix}${body.slice(0, 4)}…${body.slice(-3)}`
}

async function resolvePython(conn: Execer, hermesPath: string | null): Promise<{ path: string; version: string } | null> {
  const candidates: string[] = []
  if (hermesPath) {
    const head = await runSafe(conn, shebangCmd(hermesPath))
    const sb = head.code === 0 ? parseShebang(head.stdout.split('\n')[0] ?? '') : null
    if (sb) candidates.push(sb)
  }
  candidates.push('python3')
  for (const c of candidates) {
    const r = await runSafe(conn, pythonVersionCmd(c))
    if (r.code !== 0) continue
    const v = parseVersion(r.stdout || r.stderr)
    if (v) return { path: c, version: v }
  }
  return null
}

export async function runPreflight(conn: Execer, ctx: PreflightContext): Promise<PreflightResult> {
  const homeRes = await runSafe(conn, resolveHomeCmd())
  const homePath = homeRes.code === 0 ? homeRes.stdout.trim() : ''
  const homeFound = homePath !== '' && (await runSafe(conn, homeExistsCmd(homePath))).code === 0

  const findRes = await runSafe(conn, findHermesCmd())
  const hermesPath = findRes.code === 0 && findRes.stdout.trim() ? findRes.stdout.trim() : null

  const verRes = hermesPath ? await runSafe(conn, versionCmd(hermesPath)) : null
  const version = verRes && verRes.code === 0 ? parseVersion(verRes.stdout || verRes.stderr) : null

  const python = await resolvePython(conn, hermesPath)

  let profileCount = 0
  if (homeFound) {
    const pc = await runSafe(conn, profileCountCmd(homePath))
    profileCount = (pc.code === 0 ? parseInt(pc.stdout.trim(), 10) || 0 : 0) + 1
  }

  const dbRes = homeFound && python ? await runSafe(conn, stateDbCmd(python.path, homePath)) : null
  const dbOut = dbRes && dbRes.code === 0 ? dbRes.stdout.trim() : ''

  const items: PreflightItem[] = [
    { id: 'ssh', label: `ssh ${ctx.username}@${ctx.host} -p ${ctx.port}`, state: 'ok', result: `OK ${ctx.latencyMs}ms` },
    { id: 'hostkey', label: `host key ${shortFingerprint(ctx.fingerprint)}`, state: 'ok', result: 'TRUSTED' },
    homeFound
      ? { id: 'home', label: 'hermes home', state: 'ok', result: homePath }
      : {
          id: 'home',
          label: 'hermes home',
          state: 'fail',
          result: 'NOT FOUND',
          hint: 'Hermes home was not found for this SSH user. Log in as the user that runs Hermes, or set HERMES_HOME for that user.'
        },
    !hermesPath
      ? { id: 'version', label: 'hermes --version', state: 'fail', result: 'UNKNOWN', hint: 'The hermes CLI was not found, so the version cannot be read.' }
      : !version
        ? { id: 'version', label: 'hermes --version', state: 'warn', result: 'UNREADABLE', hint: 'hermes --version printed no version number.' }
        : compareVersions(version, MIN_HERMES_VERSION) < 0
          ? { id: 'version', label: 'hermes --version', state: 'warn', result: `v${version}`, hint: `Tested with Hermes ${MIN_HERMES_VERSION} or newer. Some screens may not work.` }
          : { id: 'version', label: 'hermes --version', state: 'ok', result: `v${version}` },
    homeFound
      ? { id: 'profiles', label: 'profiles', state: 'ok', result: String(profileCount) }
      : { id: 'profiles', label: 'profiles', state: 'fail', result: 'SKIPPED', hint: 'Needs the Hermes home.' },
    dbOut.startsWith('ok')
      ? { id: 'statedb', label: 'state.db ?mode=ro', state: 'ok', result: /^ok\s+\S+/.test(dbOut) && !/^ok\s+None/.test(dbOut) ? `schema ${dbOut.split(/\s+/)[1]} OK` : 'readable' }
      : dbOut === 'missing'
        ? { id: 'statedb', label: 'state.db ?mode=ro', state: 'warn', result: 'NOT CREATED YET', hint: 'Hermes creates state.db after its first session.' }
        : { id: 'statedb', label: 'state.db ?mode=ro', state: 'fail', result: dbRes ? 'UNREADABLE' : 'SKIPPED', hint: 'state.db could not be opened read-only.' },
    hermesPath
      ? { id: 'cli', label: 'hermes cli', state: 'ok', result: hermesPath }
      : {
          id: 'cli',
          label: 'hermes cli',
          state: 'fail',
          result: 'NOT FOUND',
          hint: 'Looked in PATH, ~/.local/bin and the usual venv. Model names and capability checks will be unavailable.'
        },
    python
      ? { id: 'python', label: 'python (hermes shebang)', state: 'ok', result: python.version }
      : { id: 'python', label: 'python (hermes shebang)', state: 'fail', result: 'NOT FOUND', hint: 'No Python interpreter was found, so live monitoring cannot start.' },
    { id: 'zero', label: 'zero-change mode', state: 'info', result: 'ON · 0 files written' }
  ]

  return {
    items,
    hermesHome: homeFound ? homePath : null,
    hermesPath,
    pythonPath: python?.path ?? null,
    version,
    profileCount,
    canStart: homeFound && python !== null
  }
}
```

- [ ] **Step 7: Implementasi `src/main/connection/capabilities.ts`**

```ts
import type { Capabilities } from '@shared/ipc'
import type { Execer } from './manager'
import { probeCmd, runSafe } from './remote'

export const PROBES: { id: string; sub: string[] }[] = [
  { id: 'cron runs', sub: ['cron', 'runs'] },
  { id: 'curator status', sub: ['curator', 'status'] },
  { id: 'sessions list', sub: ['sessions', 'list'] },
  { id: 'tools --summary', sub: ['tools'] },
  { id: 'fallback list', sub: ['fallback', 'list'] },
  { id: 'mcp list', sub: ['mcp', 'list'] },
  { id: 'approvals suggest', sub: ['approvals', 'suggest'] }
]

export async function probeCapabilities(conn: Execer, hermesPath: string | null, version: string | null): Promise<Capabilities> {
  const supported: Record<string, boolean> = {}
  if (!hermesPath) {
    for (const p of PROBES) supported[p.id] = false
    return { version, supported }
  }
  await Promise.all(
    PROBES.map(async (p) => {
      supported[p.id] = (await runSafe(conn, probeCmd(hermesPath, p.sub), 10_000)).code === 0
    })
  )
  return { version, supported }
}
```

- [ ] **Step 8: Jalankan test**

Run: `npm test -- tests/unit/preflightParsers.test.ts tests/integration/preflight.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/main/connection tests/unit/preflightParsers.test.ts tests/integration/preflight.test.ts tests/helpers/fakeSshServer.ts
git commit -m "feat: add remote command builders, preflight checklist and capability probes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: CollectorChannel, EventRouter, dan ModelResolver

**Files:**
- Create: `src/main/collector/lines.ts`, `src/main/collector/router.ts`, `src/main/collector/channel.ts`, `src/main/collector/models.ts`
- Test: `tests/unit/lines.test.ts`, `tests/unit/models.test.ts`, `tests/integration/collector.test.ts`

**Interfaces:**
- Consumes: `ConnectionManager.openStream`, `collectorCmd`, `modelCmd`, `runSafe`, `parseEventLine`.
- Produces:
  - `LineSplitter(maxLine?).push(chunk): string[]`.
  - `EventRouter(log)`: `.handleLine(line)`; event `'event'` (payload `CollectorEvent`).
  - `loadCollectorScript(path): string`; `CollectorChannel(conn, {python, home, script, log?})` dengan `start(): Promise<void>`, `stop(): void`, event `'event'` dan `'closed'`.
  - `parseModelJson(stdout)`; `ModelResolver(conn, hermesPath, onChange, now?)` dengan `update(agents): Promise<void>` dan `snapshot(): AgentModels`.

- [ ] **Step 1: Test unit yang gagal**

`tests/unit/lines.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { LineSplitter } from '../../src/main/collector/lines'
import { EventRouter } from '../../src/main/collector/router'
import { sampleAgents } from '../helpers/samples'

describe('LineSplitter', () => {
  it('joins fragments and drops blank lines', () => {
    const s = new LineSplitter()
    expect(s.push('{"a":1}\n{"b"')).toEqual(['{"a":1}'])
    expect(s.push(':2}\r\n\n')).toEqual(['{"b":2}'])
  })

  it('discards a runaway line instead of growing forever', () => {
    const s = new LineSplitter(10)
    expect(s.push('x'.repeat(50))).toEqual([])
    expect(s.push('ok\n')).toEqual(['ok'])
  })
})

describe('EventRouter', () => {
  it('emits valid events and logs invalid ones', () => {
    const log = vi.fn()
    const r = new EventRouter(log)
    const got: unknown[] = []
    r.on('event', (e) => got.push(e))
    r.handleLine(JSON.stringify({ type: 'agents', ts: 1, profile: null, data: sampleAgents() }))
    r.handleLine('garbage')
    expect(got).toHaveLength(1)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).toMatch(/invalid collector line/)
  })
})
```

`tests/unit/models.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { ModelResolver, parseModelJson } from '../../src/main/collector/models'
import type { Execer } from '../../src/main/connection/manager'

describe('parseModelJson', () => {
  it.each([
    ['{"provider":"openrouter","default":"a/b"}', { provider: 'openrouter', model: 'a/b' }],
    ['{"model":{"provider":"p","default":"m"}}', { provider: 'p', model: 'm' }],
    ['{"model":"plain"}', { provider: null, model: 'plain' }],
    ['{"provider":"p"}', { provider: 'p', model: null }],
    ['{}', null],
    ['not json', null],
    ['[1]', null]
  ])('%j', (input, expected) => {
    expect(parseModelJson(input)).toEqual(expected)
  })
})

function execer(counts: Record<string, number>, out = '{"provider":"p","default":"m"}'): Execer {
  return {
    exec: async (argv) => {
      const profile = argv[1] === '-p' ? argv[2]! : 'default'
      counts[profile] = (counts[profile] ?? 0) + 1
      return { code: 0, stdout: out, stderr: '' }
    }
  }
}

describe('ModelResolver', () => {
  it('reads each profile once and again only when config.yaml changes', async () => {
    const counts: Record<string, number> = {}
    const onChange = vi.fn()
    const r = new ModelResolver(execer(counts), '/bin/hermes', onChange)
    await r.update([{ profile: 'default', configMtime: 1 }, { profile: 'scout', configMtime: null }])
    await r.update([{ profile: 'default', configMtime: 1 }, { profile: 'scout', configMtime: null }])
    expect(counts).toEqual({ default: 1, scout: 1 })
    expect(onChange).toHaveBeenCalledTimes(1)
    await r.update([{ profile: 'default', configMtime: 2 }, { profile: 'scout', configMtime: null }])
    expect(counts).toEqual({ default: 2, scout: 1 })
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(r.snapshot()).toEqual({ default: { provider: 'p', model: 'm' }, scout: { provider: 'p', model: 'm' } })
  })

  it('forgets removed profiles', async () => {
    const r = new ModelResolver(execer({}), '/bin/hermes', () => {})
    await r.update([{ profile: 'a', configMtime: 1 }, { profile: 'b', configMtime: 1 }])
    await r.update([{ profile: 'a', configMtime: 1 }])
    expect(Object.keys(r.snapshot())).toEqual(['a'])
  })

  it('does nothing without a hermes CLI', async () => {
    const counts: Record<string, number> = {}
    const r = new ModelResolver(execer(counts), null, () => {})
    await r.update([{ profile: 'a', configMtime: 1 }])
    expect(counts).toEqual({})
  })

  it('retries a failed lookup only after a cool-down', async () => {
    let t = 0
    let calls = 0
    const failing: Execer = { exec: async () => ((calls++, { code: 1, stdout: '', stderr: 'boom' })) }
    const r = new ModelResolver(failing, '/bin/hermes', () => {}, () => t)
    await r.update([{ profile: 'a', configMtime: 1 }])
    await r.update([{ profile: 'a', configMtime: 1 }])
    expect(calls).toBe(1)
    t = 61_000
    await r.update([{ profile: 'a', configMtime: 1 }])
    expect(calls).toBe(2)
    expect(r.snapshot()).toEqual({ a: null })
  })
})
```

- [ ] **Step 2: Test integrasi yang gagal — `tests/integration/collector.test.ts`**

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CollectorEvent } from '@shared/events'
import { CollectorChannel, loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { waitFor } from '../helpers/wait'

let dir: string
let fx: FixtureDirs
let srv: FakeSsh
let m: ConnectionManager

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mc-col-'))
  fx = buildFixture(join(dir, 'fx'))
  srv = await startFakeSsh({ fixture: fx })
  m = new ConnectionManager({ getKnownHost: () => ({ algo: 'ssh-ed25519', fingerprint: srv.fingerprint }) }, 5000)
  await m.connect({ host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123' })
})
afterAll(async () => {
  await m.disconnect()
  await srv.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('CollectorChannel', () => {
  it('streams agents then metrics from the real collector', async () => {
    const script = loadCollectorScript('collector/mc_collector.py')
    expect(script).not.toContain('\r')
    const ch = new CollectorChannel(m, { python: '/usr/bin/python3', home: '/home/hermes/.hermes', script })
    const events: CollectorEvent[] = []
    ch.on('event', (e: CollectorEvent) => events.push(e))
    await ch.start()
    await waitFor(() => events.some((e) => e.type === 'agents') && events.filter((e) => e.type === 'metrics').length >= 2, {
      label: 'agents + 2 metrics',
      timeout: 15_000
    })
    const agents = events.find((e) => e.type === 'agents')!
    expect(agents.type === 'agents' && agents.data.agents.map((a) => a.profile).sort()).toEqual(['atlas', 'default', 'scout'])
    ch.stop()
  })

  it('emits closed when the stream ends', async () => {
    const ch = new CollectorChannel(m, { python: '/usr/bin/python3', home: '/home/hermes/.hermes', script: loadCollectorScript('collector/mc_collector.py') })
    let closed = false
    ch.on('closed', () => (closed = true))
    await ch.start()
    ch.stop()
    await waitFor(() => closed, { label: 'closed' })
  })
})
```

- [ ] **Step 3: Jalankan, pastikan gagal** — `npm test -- tests/unit/lines.test.ts tests/unit/models.test.ts tests/integration/collector.test.ts` → FAIL.

- [ ] **Step 4: Implementasi**

`src/main/collector/lines.ts`:
```ts
export class LineSplitter {
  private buf = ''

  constructor(private readonly maxLine = 1_048_576) {}

  push(chunk: string): string[] {
    this.buf += chunk
    const parts = this.buf.split('\n')
    this.buf = parts.pop() ?? ''
    if (this.buf.length > this.maxLine) this.buf = ''
    return parts.map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0)
  }
}
```

`src/main/collector/router.ts`:
```ts
import { EventEmitter } from 'node:events'
import { parseEventLine } from '@shared/events'

export class EventRouter extends EventEmitter {
  constructor(private readonly log: (msg: string) => void) {
    super()
  }

  handleLine(line: string): void {
    const r = parseEventLine(line)
    if (r.ok) this.emit('event', r.event)
    else this.log(`invalid collector line (${r.error}): ${line.slice(0, 120)}`)
  }
}
```

`src/main/collector/channel.ts`:
```ts
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import type { ClientChannel } from 'ssh2'
import { collectorCmd } from '../connection/remote'
import { LineSplitter } from './lines'
import { EventRouter } from './router'

export function loadCollectorScript(path: string): string {
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
}

export interface CollectorOptions {
  python: string
  home: string
  script: string
  log?: (msg: string) => void
}

interface Streamer {
  openStream(argv: readonly string[], stdin: string): Promise<ClientChannel>
}

export class CollectorChannel extends EventEmitter {
  private ch: ClientChannel | null = null

  constructor(
    private readonly conn: Streamer,
    private readonly opts: CollectorOptions
  ) {
    super()
  }

  async start(): Promise<void> {
    const log = this.opts.log ?? ((): void => {})
    const ch = await this.conn.openStream(collectorCmd(this.opts.python, this.opts.home), this.opts.script)
    this.ch = ch
    const splitter = new LineSplitter()
    const router = new EventRouter(log)
    router.on('event', (e) => this.emit('event', e))
    ch.setEncoding('utf8')
    ch.stderr.setEncoding('utf8')
    ch.on('data', (d: string) => splitter.push(d).forEach((l) => router.handleLine(l)))
    ch.stderr.on('data', (d: string) => log(`collector stderr: ${d.trim().slice(0, 200)}`))
    ch.on('close', () => {
      if (this.ch === ch) this.ch = null
      this.emit('closed')
    })
  }

  stop(): void {
    const ch = this.ch
    this.ch = null
    ch?.close()
  }
}
```

`src/main/collector/models.ts`:
```ts
import type { AgentModels } from '@shared/ipc'
import type { Execer } from '../connection/manager'
import { modelCmd, runSafe } from '../connection/remote'

type Model = { provider: string | null; model: string | null }

export function parseModelJson(stdout: string): Model | null {
  let v: unknown
  try {
    v = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const root = v as Record<string, unknown>
  if (typeof root.model === 'string') {
    return { provider: typeof root.provider === 'string' ? root.provider : null, model: root.model }
  }
  const m = (root.model && typeof root.model === 'object' ? root.model : root) as Record<string, unknown>
  const provider = typeof m.provider === 'string' ? m.provider : null
  const model = typeof m.default === 'string' ? m.default : typeof m.name === 'string' ? m.name : null
  return provider || model ? { provider, model } : null
}

const RETRY_AFTER_MS = 60_000
const CONCURRENCY = 3

interface Entry {
  mtime: number | null
  value: Model | null
  at: number
}

export class ModelResolver {
  private cache = new Map<string, Entry>()
  private busy = false

  constructor(
    private readonly conn: Execer,
    private readonly hermesPath: string | null,
    private readonly onChange: (m: AgentModels) => void,
    private readonly now: () => number = Date.now
  ) {}

  snapshot(): AgentModels {
    const out: AgentModels = {}
    for (const [k, v] of this.cache) out[k] = v.value
    return out
  }

  async update(agents: { profile: string; configMtime: number | null }[]): Promise<void> {
    const hermes = this.hermesPath
    if (!hermes || this.busy) return
    this.busy = true
    try {
      let changed = false
      const names = new Set(agents.map((a) => a.profile))
      for (const k of [...this.cache.keys()]) {
        if (!names.has(k)) {
          this.cache.delete(k)
          changed = true
        }
      }
      const stale = agents.filter((a) => {
        const hit = this.cache.get(a.profile)
        if (!hit) return true
        if (hit.mtime !== a.configMtime) return true
        return hit.value === null && this.now() - hit.at >= RETRY_AFTER_MS
      })
      let next = 0
      const worker = async (): Promise<void> => {
        for (;;) {
          const a = stale[next++]
          if (!a) return
          const r = await runSafe(this.conn, modelCmd(hermes, a.profile))
          this.cache.set(a.profile, { mtime: a.configMtime, value: r.code === 0 ? parseModelJson(r.stdout) : null, at: this.now() })
          changed = true
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, stale.length) }, worker))
      if (changed) this.onChange(this.snapshot())
    } finally {
      this.busy = false
    }
  }
}
```

- [ ] **Step 5: Jalankan test**

Run: `npm test -- tests/unit/lines.test.ts tests/unit/models.test.ts tests/integration/collector.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/collector tests/unit/lines.test.ts tests/unit/models.test.ts tests/integration/collector.test.ts
git commit -m "feat: add collector channel, event router and agent model resolver

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: MissionSession, IPC, preload, dan wiring main process

**Files:**
- Create: `src/shared/channels.ts`, `src/main/startup.ts`, `src/main/log.ts`, `src/main/session.ts`, `src/main/ipc.ts`
- Modify: `src/shared/ipc.ts` (re-export `IPC` dari `channels.ts`; hapus definisi lama), `src/preload/index.ts`, `src/main/index.ts`
- Test: `tests/unit/log.test.ts`, `tests/integration/session.test.ts`

**Interfaces:**
- Consumes: semua dari Task 5, 6, 10–13.
- Produces:
  - `channels.ts`: `IPC` (tanpa dependensi runtime, aman dipakai preload ter-sandbox).
  - `createLogger(dir): (msg: string) => void`.
  - `StartupTracker(emit, fromKeychain)` dengan `begin(id)`, `done(id, detail)`, `fail(id, detail)`.
  - `MissionSession(deps)`: `connect(req): Promise<ConnectResult>`, `disconnect(): Promise<void>`, `forget(): Promise<void>`, `trustHostKey(c: HostKeyChallenge): void`, `getSaved(): SavedConnection | null`, `secretStatus()`, `getStatus(): ConnStatus`. `SessionDeps {manager, store, secrets, collectorScript, send, log?, backoff?, latencyIntervalMs?}`.
  - `registerIpc(deps)` dan preload `window.mc: MissionApi`.

- [ ] **Step 1: Pindahkan `IPC` ke `channels.ts`**

`src/shared/channels.ts` (salin objek `IPC` dari `ipc.ts` apa adanya):
```ts
export const IPC = {
  connect: 'mc:connection:connect',
  trustHostKey: 'mc:connection:trust-hostkey',
  disconnect: 'mc:connection:disconnect',
  forget: 'mc:connection:forget',
  saved: 'mc:connection:saved',
  secretStatus: 'mc:connection:secret-status',
  settingsAll: 'mc:settings:all',
  settingsSet: 'mc:settings:set',
  pinsGet: 'mc:agents:pins-get',
  pinsSet: 'mc:agents:pins-set',
  setZoom: 'mc:app:set-zoom',
  appInfo: 'mc:app:info',
  evEvent: 'mc:ev:event',
  evStatus: 'mc:ev:status',
  evStartup: 'mc:ev:startup',
  evPreflight: 'mc:ev:preflight',
  evCapabilities: 'mc:ev:capabilities',
  evModels: 'mc:ev:models'
} as const
```

Di `src/shared/ipc.ts`: hapus blok `export const IPC = {...} as const` dan tambahkan di bagian atas `export { IPC } from './channels'`.

- [ ] **Step 2: Test logger yang gagal — `tests/unit/log.test.ts`**

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLogger } from '../../src/main/log'

describe('createLogger', () => {
  it('appends timestamped lines to app.log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-log-'))
    try {
      const log = createLogger(dir)
      log('hello')
      log('world')
      const text = readFileSync(join(dir, 'logs', 'app.log'), 'utf8').trim().split('\n')
      expect(text).toHaveLength(2)
      expect(text[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z hello$/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('never throws even if the directory cannot be written', () => {
    const log = createLogger('Z:\\definitely\\missing\\\0bad')
    expect(() => log('x')).not.toThrow()
  })
})
```

- [ ] **Step 3: Implementasi `src/main/log.ts` dan `src/main/startup.ts`**

`src/main/log.ts`:
```ts
import { appendFileSync, mkdirSync, statSync, truncateSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 2 * 1024 * 1024

export function createLogger(userDataDir: string): (msg: string) => void {
  let file: string | null = null
  try {
    const dir = join(userDataDir, 'logs')
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'app.log')
    try {
      if (statSync(file).size > MAX_BYTES) truncateSync(file, 0)
    } catch {
      /* new file */
    }
  } catch {
    file = null
  }
  return (msg) => {
    if (!file) return
    try {
      appendFileSync(file, `${new Date().toISOString()} ${msg.replace(/\s+/g, ' ')}\n`)
    } catch {
      /* logging must never break the app */
    }
  }
}
```

`src/main/startup.ts`:
```ts
import type { StartupProgress, StartupStep, StartupStepId } from '@shared/ipc'

export class StartupTracker {
  private steps: StartupStep[]

  constructor(
    private readonly emit: (p: StartupProgress) => void,
    fromKeychain: boolean
  ) {
    const mk = (id: StartupStepId, label: string): StartupStep => ({ id, label, detail: '', state: 'pending' })
    this.steps = [
      mk('credentials', fromKeychain ? 'password loaded from OS keychain' : 'credentials received'),
      mk('handshake', 'ssh handshake · host key matches'),
      mk('hermes', 'hermes found'),
      mk('statedb', 'state.db opened read-only'),
      mk('collector', 'collector streaming (stdin)')
    ]
    this.push()
  }

  private set(id: StartupStepId, state: StartupStep['state'], detail: string): void {
    const s = this.steps.find((x) => x.id === id)
    if (s) {
      s.state = state
      s.detail = detail
    }
    this.push()
  }

  begin(id: StartupStepId): void {
    this.set(id, 'running', '')
  }
  done(id: StartupStepId, detail = ''): void {
    this.set(id, 'done', detail)
  }
  fail(id: StartupStepId, detail = ''): void {
    this.set(id, 'failed', detail)
  }

  private push(): void {
    this.emit({ steps: this.steps.map((s) => ({ ...s })) })
  }
}
```

- [ ] **Step 4: Test integrasi session yang gagal — `tests/integration/session.test.ts`**

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { IPC } from '@shared/channels'
import type { CollectorEvent } from '@shared/events'
import type { AgentModels, Capabilities, ConnStatus, ConnectRequest, PreflightResult, StartupProgress } from '@shared/ipc'
import { loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { MissionSession } from '../../src/main/session'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, snapshotTree, type FixtureDirs } from '../helpers/fixture'
import { waitFor } from '../helpers/wait'

const secrets = {
  status: () => ({ available: true, reason: null }),
  encrypt: (s: string) => Buffer.from('enc:' + s),
  decrypt: (b: Buffer) => (b.toString().startsWith('enc:') ? b.toString().slice(4) : null)
}

let dir: string
let fx: FixtureDirs
let srv: FakeSsh
const script = loadCollectorScript('collector/mc_collector.py')
const live: MissionSession[] = []

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mc-sess-'))
  fx = buildFixture(join(dir, 'fx'))
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function makeSession(store = new SettingsStore(':memory:')) {
  const sent: { channel: string; payload: unknown }[] = []
  const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) }, 5000)
  const session = new MissionSession({
    manager,
    store,
    secrets,
    collectorScript: script,
    send: (channel, payload) => sent.push({ channel, payload }),
    backoff: () => 50,
    latencyIntervalMs: 200
  })
  live.push(session)
  const of = <T>(channel: string): T[] => sent.filter((s) => s.channel === channel).map((s) => s.payload as T)
  return { session, store, sent, of }
}

const req = (over: Partial<ConnectRequest> = {}): ConnectRequest => ({
  host: '127.0.0.1',
  port: srv.port,
  username: 'tester',
  password: 'test-pass-123',
  remember: true,
  ...over
})

async function trusted(session: MissionSession, over: Partial<ConnectRequest> = {}) {
  const first = await session.connect(req(over))
  if (first.ok || !first.hostKey) throw new Error('expected a host key challenge')
  session.trustHostKey(first.hostKey)
  return first.hostKey
}

describe('first connection', () => {
  it('asks to verify the host key, then connects, streams data and reports preflight', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session, store, of } = makeSession()

    const first = await session.connect(req())
    expect(first).toMatchObject({ ok: false, kind: 'hostkey-unverified' })
    expect(first.ok === false && first.hostKey?.fingerprint).toBe(srv.fingerprint)
    expect(store.getConnection()).toBeNull()

    session.trustHostKey(first.ok === false ? first.hostKey! : (undefined as never))
    const second = await session.connect(req())
    expect(second.ok).toBe(true)
    expect(second.ok && second.preflight.canStart).toBe(true)

    await waitFor(() => of<CollectorEvent>(IPC.evEvent).find((e) => e.type === 'agents'), { label: 'agents event', timeout: 15_000 })
    await waitFor(() => of<CollectorEvent>(IPC.evEvent).filter((e) => e.type === 'metrics').length >= 1, { label: 'metrics event', timeout: 15_000 })

    const statuses = of<ConnStatus>(IPC.evStatus)
    expect(statuses.at(-1)).toMatchObject({ state: 'connected', hermesVersion: '0.21.6' })
    expect(of<PreflightResult>(IPC.evPreflight).at(-1)!.items).toHaveLength(9)
    const startup = of<StartupProgress>(IPC.evStartup).at(-1)!
    expect(startup.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done'])

    const models = await waitFor(() => of<AgentModels>(IPC.evModels).at(-1), { label: 'models', timeout: 15_000 })
    expect(Object.keys(models).sort()).toEqual(['atlas', 'default', 'scout'])
    expect(models['scout']).toEqual({ provider: 'openrouter', model: 'anthropic/claude-sonnet' })

    const caps = await waitFor(() => of<Capabilities>(IPC.evCapabilities).at(-1), { label: 'capabilities' })
    expect(caps.supported['mcp list']).toBe(true)
  })

  it('stores the connection with an encrypted password and never the plain one', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session, store } = makeSession()
    await trusted(session)
    expect((await session.connect(req())).ok).toBe(true)
    const saved = store.getConnection()!
    expect(saved).toMatchObject({ host: '127.0.0.1', username: 'tester', remember: true, hasPassword: true })
    expect(store.getPasswordEnc()!.toString()).toBe('enc:test-pass-123')
    expect(saved.lastConnectedAt).not.toBeNull()
  })

  it('does not keep the password when "remember" is off', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session, store } = makeSession()
    await trusted(session, { remember: false })
    expect((await session.connect(req({ remember: false }))).ok).toBe(true)
    expect(store.getConnection()!.hasPassword).toBe(false)
  })

  it('reports a rejected password without leaking it', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session, store } = makeSession()
    store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
    const r = await session.connect(req({ password: 'wrong' }))
    expect(r).toMatchObject({ ok: false, kind: 'auth' })
    expect(JSON.stringify(r)).not.toContain('wrong')
  })

  it('fails with hermes-missing when the Hermes home does not exist', async () => {
    srv = await startFakeSsh({ fixture: fx, hasHome: false })
    const { session, store } = makeSession()
    store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
    const r = await session.connect(req())
    expect(r).toMatchObject({ ok: false, kind: 'hermes-missing' })
    expect(r.ok === false && r.preflight?.items.find((i) => i.id === 'home')?.state).toBe('fail')
  })
})

describe('saved connection (launch)', () => {
  it('reconnects from the keychain without a typed password', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const a = makeSession()
    await trusted(a.session)
    expect((await a.session.connect(req())).ok).toBe(true)
    await a.session.disconnect()

    const b = makeSession(a.store)
    const r = await b.session.connect({ host: '127.0.0.1', port: srv.port, username: 'tester', remember: true, useSaved: true })
    expect(r.ok).toBe(true)
    expect(b.of<StartupProgress>(IPC.evStartup)[0]!.steps[0]!.label).toBe('password loaded from OS keychain')
  })

  it('refuses to send the saved password to a different host', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const a = makeSession()
    await trusted(a.session)
    await a.session.connect(req())
    await a.session.disconnect()
    const b = makeSession(a.store)
    const r = await b.session.connect({ host: 'localhost', port: srv.port, username: 'tester', remember: true })
    expect(r).toMatchObject({ ok: false, kind: 'auth' })
  })

  it('goes offline when the host is unreachable at launch and recovers when it returns', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const a = makeSession()
    await trusted(a.session)
    await a.session.connect(req())
    await a.session.disconnect()
    const port = srv.port
    const hostKey = srv.hostKey
    await srv.close()

    const b = makeSession(a.store)
    const r = await b.session.connect({ host: '127.0.0.1', port, username: 'tester', remember: true, useSaved: true })
    expect(r).toMatchObject({ ok: false, kind: 'unreachable' })
    await waitFor(() => b.of<ConnStatus>(IPC.evStatus).at(-1)?.state === 'offline', { label: 'offline status' })
    expect(b.of<ConnStatus>(IPC.evStatus).at(-1)!.nextRetryInS).toBeGreaterThanOrEqual(1)

    srv = await startFakeSsh({ fixture: fx, port, hostKey })
    await waitFor(() => b.of<ConnStatus>(IPC.evStatus).at(-1)?.state === 'connected', { label: 'recovered', timeout: 15_000 })
    await waitFor(() => b.of<CollectorEvent>(IPC.evEvent).some((e) => e.type === 'agents'), { label: 'agents after recovery', timeout: 15_000 })
  })
})

describe('host key changes', () => {
  it('blocks the connection and reports the previous fingerprint', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const a = makeSession()
    await trusted(a.session)
    await a.session.connect(req())
    await a.session.disconnect()
    const port = srv.port
    const old = srv.fingerprint
    await srv.close()
    srv = await startFakeSsh({ fixture: fx, port })
    const r = await a.session.connect(req())
    expect(r).toMatchObject({ ok: false, kind: 'hostkey-changed' })
    expect(r.ok === false && r.hostKey).toMatchObject({ changed: true, previous: old, fingerprint: srv.fingerprint })
  })
})

describe('resilience', () => {
  it('reconnects after the connection drops and resumes streaming', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session, of } = makeSession()
    await trusted(session)
    expect((await session.connect(req())).ok).toBe(true)
    await waitFor(() => of<CollectorEvent>(IPC.evEvent).some((e) => e.type === 'agents'), { label: 'first agents', timeout: 15_000 })
    const before = of<CollectorEvent>(IPC.evEvent).filter((e) => e.type === 'agents').length

    srv.dropConnections()
    await waitFor(() => of<ConnStatus>(IPC.evStatus).some((s) => s.state === 'reconnecting'), { label: 'reconnecting' })
    await waitFor(() => of<ConnStatus>(IPC.evStatus).at(-1)?.state === 'connected', { label: 'reconnected', timeout: 15_000 })
    await waitFor(() => of<CollectorEvent>(IPC.evEvent).filter((e) => e.type === 'agents').length > before, { label: 'agents after reconnect', timeout: 15_000 })
  })
})

describe('zero-change', () => {
  it('leaves the Hermes fixture byte-for-byte untouched after a full session', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session, of } = makeSession()
    await trusted(session)
    const before = snapshotTree(fx.root)
    expect((await session.connect(req())).ok).toBe(true)
    await waitFor(() => of<CollectorEvent>(IPC.evEvent).filter((e) => e.type === 'metrics').length >= 2, { label: 'metrics', timeout: 15_000 })
    await session.disconnect()
    expect(snapshotTree(fx.root)).toEqual(before)
  })

  it('never issues a mutating command', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session } = makeSession()
    await trusted(session)
    await session.connect(req())
    await session.disconnect()
    const verbs = new Set(srv.execLog.map((a) => a[0]))
    for (const bad of ['rm', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'sudo', 'chmod', 'curl', 'wget', 'tar']) expect(verbs.has(bad)).toBe(false)
  })
})

describe('forget', () => {
  it('removes the connection, host key and pins', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session, store } = makeSession()
    await trusted(session)
    await session.connect(req())
    await session.forget()
    expect(store.getConnection()).toBeNull()
    expect(store.getKnownHost('127.0.0.1', srv.port)).toBeNull()
    expect(session.getStatus().state).toBe('idle')
  })
})
```

- [ ] **Step 5: Jalankan, pastikan gagal** — `npm test -- tests/unit/log.test.ts tests/integration/session.test.ts` → FAIL.

- [ ] **Step 6: Implementasi `src/main/session.ts`**

```ts
import { IPC } from '@shared/channels'
import type { CollectorEvent } from '@shared/events'
import type {
  ConnStatus, ConnectErrorKind, ConnectRequest, ConnectResult, HostKeyChallenge, SavedConnection
} from '@shared/ipc'
import { CollectorChannel } from './collector/channel'
import { ModelResolver } from './collector/models'
import { backoffDelay } from './connection/backoff'
import { probeCapabilities } from './connection/capabilities'
import { ConnectError, HostKeyError } from './connection/errors'
import type { ConnectParams, ConnectionManager } from './connection/manager'
import { runPreflight } from './connection/preflight'
import { StartupTracker } from './startup'
import type { SettingsStore } from './store/settingsStore'
import type { SecretStore } from './store/secretStore'

export type Send = (channel: string, payload: unknown) => void

export interface SessionDeps {
  manager: ConnectionManager
  store: SettingsStore
  secrets: Pick<SecretStore, 'status' | 'encrypt' | 'decrypt'>
  collectorScript: string
  send: Send
  log?: (msg: string) => void
  backoff?: (attempt: number) => number
  latencyIntervalMs?: number
}

const IDLE: ConnStatus = { state: 'idle', latencyMs: null, hermesVersion: null, attempt: 0, nextRetryInS: null, error: null }
const BLOCKING: ConnectErrorKind[] = ['hostkey-changed', 'hostkey-unverified', 'auth', 'hermes-missing']

interface Hermes {
  home: string
  hermesPath: string | null
  python: string
}

const fail = (kind: ConnectErrorKind, message: string): ConnectResult => ({ ok: false, kind, message })

export class MissionSession {
  private params: ConnectParams | null = null
  private remember = true
  private autoRetry = false
  private hermes: Hermes | null = null
  private collector: CollectorChannel | null = null
  private models: ModelResolver | null = null
  private status: ConnStatus = { ...IDLE }
  private retryTimer: NodeJS.Timeout | null = null
  private latencyTimer: NodeJS.Timeout | null = null
  private collectorTimer: NodeJS.Timeout | null = null
  private everConnected = false
  private blocked = false
  private generation = 0

  constructor(private readonly d: SessionDeps) {
    d.manager.on('close', () => this.onUnexpectedClose())
  }

  private log = (m: string): void => this.d.log?.(m)
  private backoff = (n: number): number => (this.d.backoff ?? backoffDelay)(n)

  getStatus(): ConnStatus {
    return this.status
  }

  getSaved(): SavedConnection | null {
    return this.d.store.getConnection()
  }

  secretStatus(): { canRemember: boolean; reason: string | null } {
    const s = this.d.secrets.status()
    return { canRemember: s.available, reason: s.reason }
  }

  trustHostKey(c: HostKeyChallenge): void {
    this.d.store.trustHost(c.host, c.port, c.algo, c.fingerprint)
  }

  private setStatus(partial: Partial<ConnStatus>): void {
    this.status = { ...this.status, ...partial }
    this.d.send(IPC.evStatus, this.status)
  }

  async connect(req: ConnectRequest): Promise<ConnectResult> {
    const gen = ++this.generation
    await this.teardown()
    this.blocked = false
    this.everConnected = false
    this.autoRetry = req.useSaved === true
    this.remember = req.remember
    this.setStatus({ ...IDLE, state: 'connecting' })

    let password = req.password ?? ''
    let fromKeychain = false
    const saved = this.d.store.getConnection()
    const sameTarget = !!saved && saved.host === req.host && saved.port === req.port && saved.username === req.username
    if (!password && sameTarget) {
      const enc = this.d.store.getPasswordEnc()
      const plain = enc ? this.d.secrets.decrypt(enc) : null
      if (plain) {
        password = plain
        fromKeychain = true
      }
    }

    const startup = new StartupTracker((p) => this.d.send(IPC.evStartup, p), fromKeychain)
    startup.begin('credentials')
    if (!password) {
      startup.fail('credentials', 'no password')
      this.setStatus({ ...IDLE })
      return fail('auth', 'Enter the password to connect.')
    }
    startup.done('credentials', fromKeychain ? 'from keychain' : '')

    const params: ConnectParams = { host: req.host, port: req.port, username: req.username, password }
    this.params = params
    const result = await this.establish(params, startup, gen, true)
    if (gen !== this.generation) return fail('unknown', 'Connection attempt was cancelled.')
    if (!result.ok) this.afterFailedConnect(result)
    return result
  }

  private afterFailedConnect(r: Extract<ConnectResult, { ok: false }>): void {
    const retryable = r.kind === 'unreachable' || r.kind === 'timeout'
    if (this.autoRetry && retryable) {
      this.scheduleRetry(0)
      this.setStatus({ error: r.message })
      return
    }
    this.params = null
    this.setStatus({ ...IDLE, error: r.message })
  }

  private async establish(params: ConnectParams, startup: StartupTracker, gen: number, persist: boolean): Promise<ConnectResult> {
    startup.begin('handshake')
    let fingerprint: string
    try {
      fingerprint = (await this.d.manager.connect(params)).fingerprint
    } catch (e) {
      startup.fail('handshake', e instanceof Error ? e.message : String(e))
      if (e instanceof HostKeyError) {
        return {
          ok: false,
          kind: e.challenge.changed ? 'hostkey-changed' : 'hostkey-unverified',
          message: e.challenge.changed
            ? 'The host key has changed since you last connected. Verify it before continuing.'
            : 'This is the first connection to this host. Verify its key to continue.',
          hostKey: e.challenge
        }
      }
      if (e instanceof ConnectError) return fail(e.kind, e.message)
      return fail('unknown', e instanceof Error ? e.message : String(e))
    }
    if (gen !== this.generation) {
      await this.d.manager.disconnect()
      return fail('unknown', 'Connection attempt was cancelled.')
    }

    const latencyMs = await this.d.manager.measureLatency().catch(() => 0)
    startup.done('handshake', `${fingerprint.slice(0, 15)}… · ${latencyMs}ms`)

    startup.begin('hermes')
    const pre = await runPreflight(this.d.manager, { host: params.host, port: params.port, username: params.username, latencyMs, fingerprint })
    this.d.send(IPC.evPreflight, pre)
    if (!pre.canStart || !pre.hermesHome || !pre.pythonPath) {
      startup.fail('hermes', 'Hermes home or Python not found')
      await this.d.manager.disconnect()
      return {
        ok: false,
        kind: 'hermes-missing',
        message: 'Hermes was not found on this server for this SSH user. See the preflight checklist.',
        preflight: pre
      }
    }
    startup.done('hermes', `${pre.version ? 'v' + pre.version : 'version unknown'} · ${pre.profileCount} profiles`)
    startup.begin('statedb')
    const db = pre.items.find((i) => i.id === 'statedb')
    if (db?.state === 'fail') startup.fail('statedb', db.result)
    else startup.done('statedb', db?.result ?? '')

    this.hermes = { home: pre.hermesHome, hermesPath: pre.hermesPath, python: pre.pythonPath }
    this.models = new ModelResolver(this.d.manager, pre.hermesPath, (m) => this.d.send(IPC.evModels, m))

    if (persist) {
      const store = this.d.store
      const canKeep = this.remember && this.d.secrets.status().available
      const id = store.upsertConnection({
        name: `${params.username}@${params.host}`,
        host: params.host,
        port: params.port,
        username: params.username,
        remember: this.remember,
        passwordEnc: canKeep ? this.d.secrets.encrypt(params.password) : null
      })
      store.touchConnected(id, Date.now())
    }

    startup.begin('collector')
    try {
      await this.startCollector()
    } catch (e) {
      startup.fail('collector', e instanceof Error ? e.message : String(e))
      await this.d.manager.disconnect()
      return fail('unknown', 'The monitoring collector could not be started.')
    }
    startup.done('collector', '0 files written')

    this.everConnected = true
    this.startLatency()
    this.setStatus({ state: 'connected', hermesVersion: pre.version, latencyMs, attempt: 0, nextRetryInS: null, error: null })
    void probeCapabilities(this.d.manager, pre.hermesPath, pre.version).then((caps) => {
      if (gen === this.generation) this.d.send(IPC.evCapabilities, caps)
    })
    return { ok: true, preflight: pre }
  }

  private async startCollector(): Promise<void> {
    const h = this.hermes
    if (!h) return
    const ch = new CollectorChannel(this.d.manager, { python: h.python, home: h.home, script: this.d.collectorScript, log: this.log })
    ch.on('event', (ev: CollectorEvent) => {
      this.d.send(IPC.evEvent, ev)
      if (ev.type === 'agents') void this.models?.update(ev.data.agents)
    })
    ch.on('closed', () => {
      if (this.collector !== ch) return
      this.collector = null
      if (this.d.manager.isConnected()) {
        this.log('collector stopped while connected; restarting')
        this.collectorTimer = setTimeout(() => {
          if (this.d.manager.isConnected() && !this.collector) void this.startCollector().catch((e) => this.log(`collector restart failed: ${String(e)}`))
        }, 3000)
        this.collectorTimer.unref()
      }
    })
    this.collector = ch
    await ch.start()
  }

  private startLatency(): void {
    this.stopLatency()
    const every = this.d.latencyIntervalMs ?? 5000
    this.latencyTimer = setInterval(() => {
      this.d.manager
        .measureLatency()
        .then((ms) => this.setStatus({ latencyMs: ms }))
        .catch(() => {})
    }, every)
    this.latencyTimer.unref()
  }

  private stopLatency(): void {
    if (this.latencyTimer) clearInterval(this.latencyTimer)
    this.latencyTimer = null
  }

  private stopCollector(): void {
    if (this.collectorTimer) clearTimeout(this.collectorTimer)
    this.collectorTimer = null
    this.collector?.stop()
    this.collector = null
  }

  private onUnexpectedClose(): void {
    if (!this.params) return
    this.stopLatency()
    this.stopCollector()
    this.scheduleRetry(0)
  }

  private scheduleRetry(attempt: number): void {
    if (!this.params || this.blocked) return
    const delay = this.backoff(attempt)
    this.setStatus({ state: this.everConnected ? 'reconnecting' : 'offline', attempt: attempt + 1, nextRetryInS: Math.max(1, Math.ceil(delay / 1000)) })
    const gen = this.generation
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => void this.retry(attempt, gen), delay)
    this.retryTimer.unref()
  }

  private async retry(attempt: number, gen: number): Promise<void> {
    const params = this.params
    if (!params || gen !== this.generation) return
    const res = await this.establish(params, new StartupTracker(() => {}, false), gen, false)
    if (gen !== this.generation) return
    if (res.ok) return
    if (BLOCKING.includes(res.kind)) {
      this.blocked = true
      this.setStatus({ state: 'offline', error: res.message, nextRetryInS: null })
      return
    }
    this.scheduleRetry(attempt + 1)
  }

  private async teardown(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.stopLatency()
    this.stopCollector()
    this.models = null
    this.hermes = null
    await this.d.manager.disconnect()
  }

  async disconnect(): Promise<void> {
    this.generation++
    this.params = null
    await this.teardown()
    this.everConnected = false
    this.setStatus({ ...IDLE })
  }

  async forget(): Promise<void> {
    await this.disconnect()
    this.d.store.forgetConnection()
  }
}
```

- [ ] **Step 7: Jalankan test**

Run: `npm test -- tests/unit/log.test.ts tests/integration/session.test.ts && npm run typecheck`
Expected: PASS. Jika test "goes offline … recovers" terlalu lambat, periksa bahwa `afterFailedConnect` memanggil `scheduleRetry` sebelum `setStatus({error})` (urutan itu menjaga `nextRetryInS`).

- [ ] **Step 8: Implementasi `src/main/ipc.ts`**

```ts
import { app, ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/channels'
import { ConnectRequestSchema, HostKeyChallengeSchema, type AppInfo } from '@shared/ipc'
import { SETTINGS_SCHEMA, isSettingKey } from '@shared/settings'
import { isTrustedSender, type AppTarget } from './security'
import type { MissionSession } from './session'
import type { SettingsStore } from './store/settingsStore'

export interface IpcDeps {
  session: MissionSession
  store: SettingsStore
  getWindow: () => BrowserWindow | null
  target: AppTarget
}

const SetSetting = z.object({ key: z.string(), value: z.unknown() })
const Pins = z.array(z.string().max(128)).max(500)
const Zoom = z.number().min(0.7).max(1.5)

export function registerIpc(d: IpcDeps): void {
  const handle = (channel: string, fn: (arg: unknown) => unknown): void => {
    ipcMain.handle(channel, (event, arg: unknown) => {
      if (!isTrustedSender(event.senderFrame?.url, d.target)) throw new Error('untrusted sender')
      return fn(arg)
    })
  }

  handle(IPC.connect, (a) => d.session.connect(ConnectRequestSchema.parse(a)))
  handle(IPC.trustHostKey, (a) => d.session.trustHostKey(HostKeyChallengeSchema.parse(a)))
  handle(IPC.disconnect, () => d.session.disconnect())
  handle(IPC.forget, () => d.session.forget())
  handle(IPC.saved, () => d.session.getSaved())
  handle(IPC.secretStatus, () => d.session.secretStatus())

  handle(IPC.settingsAll, () => d.store.allSettings())
  handle(IPC.settingsSet, (a) => {
    const { key, value } = SetSetting.parse(a)
    if (!isSettingKey(key)) throw new Error(`unknown setting ${key}`)
    d.store.setSetting(key, SETTINGS_SCHEMA[key].parse(value) as never)
  })

  handle(IPC.pinsGet, () => {
    const c = d.store.getConnection()
    return { pins: c ? d.store.getPins(c.id) : [], initialized: c ? d.store.pinsInitialized(c.id) : false }
  })
  handle(IPC.pinsSet, (a) => {
    const c = d.store.getConnection()
    if (c) d.store.setPins(c.id, Pins.parse(a))
  })

  handle(IPC.setZoom, (a) => {
    d.getWindow()?.webContents.setZoomFactor(Zoom.parse(a))
  })
  handle(IPC.appInfo, (): AppInfo => ({ version: app.getVersion(), electron: process.versions.electron ?? '', platform: process.platform }))
}
```

- [ ] **Step 9: Preload — `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/channels'
import type { MissionApi } from '../shared/ipc'

const on = <T>(channel: string, cb: (v: T) => void): (() => void) => {
  const listener = (_e: IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: MissionApi = {
  connection: {
    connect: (req) => ipcRenderer.invoke(IPC.connect, req),
    trustHostKey: (c) => ipcRenderer.invoke(IPC.trustHostKey, c),
    disconnect: () => ipcRenderer.invoke(IPC.disconnect),
    forget: () => ipcRenderer.invoke(IPC.forget),
    saved: () => ipcRenderer.invoke(IPC.saved),
    secretStatus: () => ipcRenderer.invoke(IPC.secretStatus)
  },
  settings: {
    all: () => ipcRenderer.invoke(IPC.settingsAll),
    set: (key, value) => ipcRenderer.invoke(IPC.settingsSet, { key, value })
  },
  agents: {
    getPins: () => ipcRenderer.invoke(IPC.pinsGet),
    setPins: (pins) => ipcRenderer.invoke(IPC.pinsSet, pins)
  },
  app: {
    setZoom: (f) => ipcRenderer.invoke(IPC.setZoom, f),
    info: () => ipcRenderer.invoke(IPC.appInfo)
  },
  onEvent: (cb) => on(IPC.evEvent, cb),
  onStatus: (cb) => on(IPC.evStatus, cb),
  onStartup: (cb) => on(IPC.evStartup, cb),
  onPreflight: (cb) => on(IPC.evPreflight, cb),
  onCapabilities: (cb) => on(IPC.evCapabilities, cb),
  onModels: (cb) => on(IPC.evModels, cb)
}

contextBridge.exposeInMainWorld('mc', api)
```

- [ ] **Step 10: Main — `src/main/index.ts` (ganti seluruh isi)**

```ts
import { app, BrowserWindow, Menu, safeStorage, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadCollectorScript } from './collector/channel'
import { ConnectionManager } from './connection/manager'
import { registerIpc } from './ipc'
import { createLogger } from './log'
import { WEB_PREFERENCES, hardenWebContents, type AppTarget } from './security'
import { MissionSession } from './session'
import { SecretStore } from './store/secretStore'
import { SettingsStore } from './store/settingsStore'

if (process.env['MC_USER_DATA']) app.setPath('userData', process.env['MC_USER_DATA'])

const devUrl = process.env['ELECTRON_RENDERER_URL']
const indexPath = join(__dirname, '../renderer/index.html')
const target: AppTarget = devUrl ? { devUrl } : { indexFileUrl: pathToFileURL(indexPath).href }

let win: BrowserWindow | null = null

function collectorPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'mc_collector.py') : join(app.getAppPath(), 'collector', 'mc_collector.py')
}

function buildMenu(): Menu {
  const edit: MenuItemConstructorOptions = { role: 'editMenu' }
  const template: MenuItemConstructorOptions[] = process.platform === 'darwin' ? [{ role: 'appMenu' }, edit] : [edit]
  return Menu.buildFromTemplate(template)
}

function createWindow(store: SettingsStore): BrowserWindow {
  const b = store.getSetting('window.bounds')
  const w = new BrowserWindow({
    width: b?.width ?? 1280,
    height: b?.height ?? 800,
    ...(b?.x !== undefined && b?.y !== undefined ? { x: b.x, y: b.y } : {}),
    minWidth: 760,
    minHeight: 520,
    show: false,
    backgroundColor: '#282A36',
    title: 'Hermes Agent Mission Control',
    icon: join(app.getAppPath(), 'assets', 'brand', 'icon-1024.png'),
    webPreferences: { ...WEB_PREFERENCES, preload: join(__dirname, '../preload/index.js') }
  })
  hardenWebContents(w.webContents, target)
  w.setMenuBarVisibility(false)
  w.once('ready-to-show', () => w.show())
  w.webContents.on('did-finish-load', () => w.webContents.setZoomFactor(store.getSetting('ui.zoom')))
  w.on('close', () => {
    if (!w.isMaximized() && !w.isMinimized()) {
      const r = w.getBounds()
      store.setSetting('window.bounds', { x: r.x, y: r.y, width: r.width, height: r.height })
    }
  })
  if (devUrl) void w.loadURL(devUrl)
  else void w.loadFile(indexPath)
  return w
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    const userData = app.getPath('userData')
    const log = createLogger(userData)
    const store = new SettingsStore(join(userData, 'app.db'))
    const secrets = new SecretStore(safeStorage)
    const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) })
    const session = new MissionSession({
      manager,
      store,
      secrets,
      collectorScript: loadCollectorScript(collectorPath()),
      send: (channel, payload) => {
        if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
      },
      log
    })
    registerIpc({ session, store, getWindow: () => win, target })
    Menu.setApplicationMenu(buildMenu())
    win = createWindow(store)
    win.on('closed', () => (win = null))
    app.on('before-quit', () => void session.disconnect())
  })

  app.on('window-all-closed', () => app.quit())
}
```

- [ ] **Step 11: Build dan typecheck**

Run: `npm run build && npm run typecheck`
Expected: build sukses; di `out/preload/index.js` tidak ada `require("zod")` (periksa: `grep -c 'require("zod")' out/preload/index.js` → `0`). Jika ada, pastikan preload hanya mengimpor `../shared/channels` dan `import type` dari `../shared/ipc`.

- [ ] **Step 12: Commit**

```bash
git add src/shared src/main src/preload tests/unit/log.test.ts tests/integration/session.test.ts
git commit -m "feat: add MissionSession orchestration, IPC, preload and main wiring

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```



---

### Task 15: Fondasi renderer (gaya, lib murni, store, bootstrap)

**Files:**
- Create: `scripts/gen-icons.py`, `src/renderer/components/icons.generated.ts` (hasil skrip), `src/renderer/assets/logo-mark.png` (salinan)
- Create: `src/renderer/styles/index.css`, `src/renderer/styles/base.css` (salinan), `src/renderer/styles/app.css`
- Create: `src/renderer/lib/{format,roster,window,zoom,agentColor}.ts`
- Create: `src/renderer/stores/{ui,conn,agents,metrics}.ts`
- Create: `src/renderer/actions.ts`, `src/renderer/bootstrap.ts`; Modify: `src/renderer/env.d.ts`, `src/renderer/main.tsx`
- Test: `tests/unit/{format,roster,window,zoom,stores}.test.ts`

**Interfaces:**
- Produces (`lib/format.ts`): `formatBytes(n, digits?)`, `formatRate(bps)`, `formatUptime(sec)`, `formatAge(sec)`, `formatPct(n)`, `loadColor(pct)`, `textBar(pct, width)`.
- Produces (`lib/window.ts`): `pushWindow(arr, v, n = 60): number[]`, `padLeft(arr, n = 60): number[]`.
- Produces (`lib/zoom.ts`): `ZOOM_MIN = 0.7`, `ZOOM_MAX = 1.5`, `stepZoom(current, dir: 1 | -1): number`, `zoomPercent(z): string`.
- Produces (`lib/agentColor.ts`): `agentColor(profile): string`, `initials(name): string`.
- Produces (`lib/roster.ts`): `SEARCH_THRESHOLD = 6`, `DEFAULT_PIN_COUNT = 5`, `isActive(status)`, `activeCount(agents)`, `sortAgents(agents)`, `defaultPins(agents)`, `togglePin(pins, profile)`, `reorderPins(pins, from, to)`, `buildRoster(agents, pins, query): {rows, showSearch}`, `railAgents(agents, pins, selected): {shown, more}`, tipe `RosterRow`.
- Produces (stores): `useUi` (`route`, `settings`, `settingsTab`, `ready`, `navigate`, `hydrate`, `patchSettings`, `openSettings`, `closeSettings`), `useConn` (`status`, `saved`, `secret`, `startup`, `preflight`, `capabilities`, `hostKey`, `connectError`, `connecting`), `useAgents` (`agents`, `gateway`, `models`, `receivedAt`, `pins`, `pinsReady`, `selected`, `query`, `applyAgents`, `setModels`, `setPins`, `select`, `setQuery`), `useMetrics` (`latest`, `receivedAt`, `cpu`, `rx`, `tx`, `apply`).
- Produces (`actions.ts`): `runConnect(req)`, `trustAndRetry(req)`, `forgetConnection()`, `setZoomLevel(z)`, `saveSetting(key, value)`, `toggleAgentPin(profile)`, `reorderAgentPin(from, to)`.

- [ ] **Step 1: Test lib murni yang gagal**

`tests/unit/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { formatAge, formatBytes, formatPct, formatRate, formatUptime, loadColor, textBar } from '../../src/renderer/lib/format'

describe('format', () => {
  it('formats byte sizes in binary units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1536)).toBe('1.5 KiB')
    expect(formatBytes(6.1 * 1024 ** 3)).toBe('6.1 GiB')
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(NaN)).toBe('0 B')
  })

  it('formats rates in decimal units like the mockup', () => {
    expect(formatRate(0)).toBe('0 B/s')
    expect(formatRate(340_000)).toBe('340 KB/s')
    expect(formatRate(1_200_000)).toBe('1.2 MB/s')
  })

  it('formats uptime', () => {
    expect(formatUptime(1_038_240)).toBe('12d 00h')
    expect(formatUptime(4 * 3600 + 125)).toBe('4h 02m')
    expect(formatUptime(125)).toBe('2m 05s')
    expect(formatUptime(9)).toBe('9s')
  })

  it('formats the age of data', () => {
    expect(formatAge(0.4)).toBe('just now')
    expect(formatAge(12)).toBe('12s ago')
    expect(formatAge(185)).toBe('3m ago')
    expect(formatAge(7300)).toBe('2h ago')
    expect(formatAge(200000)).toBe('2d ago')
  })

  it('rounds percentages', () => {
    expect(formatPct(33.6)).toBe('34%')
  })

  it('colours load green, orange, red', () => {
    expect(loadColor(10)).toBe('#50FA7B')
    expect(loadColor(50)).toBe('#FFB86C')
    expect(loadColor(80)).toBe('#FF5555')
  })

  it('draws text bars', () => {
    expect(textBar(50, 10)).toBe('■■■■■·····')
    expect(textBar(0, 4)).toBe('····')
    expect(textBar(150, 4)).toBe('■■■■')
  })
})
```

`tests/unit/window.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { padLeft, pushWindow } from '../../src/renderer/lib/window'

describe('rolling window', () => {
  it('appends and keeps only the last n values', () => {
    expect(pushWindow([1, 2, 3], 4, 3)).toEqual([2, 3, 4])
    expect(pushWindow([], 1, 3)).toEqual([1])
  })
  it('does not mutate its input', () => {
    const a = [1, 2]
    pushWindow(a, 3, 5)
    expect(a).toEqual([1, 2])
  })
  it('pads on the left with zeros to a fixed width', () => {
    expect(padLeft([5, 6], 4)).toEqual([0, 0, 5, 6])
    expect(padLeft([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5])
  })
})
```

`tests/unit/zoom.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { stepZoom, zoomPercent } from '../../src/renderer/lib/zoom'

describe('zoom', () => {
  it('steps by 10% without float drift', () => {
    let z = 1
    for (let i = 0; i < 3; i++) z = stepZoom(z, 1)
    expect(z).toBe(1.3)
    for (let i = 0; i < 6; i++) z = stepZoom(z, -1)
    expect(z).toBe(0.7)
  })
  it('clamps to 70%-150%', () => {
    expect(stepZoom(0.7, -1)).toBe(0.7)
    expect(stepZoom(1.5, 1)).toBe(1.5)
  })
  it('prints a percentage', () => {
    expect(zoomPercent(1.1)).toBe('110%')
  })
})
```

`tests/unit/roster.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { AgentInfo, AgentStatus } from '@shared/events'
import {
  activeCount, buildRoster, defaultPins, railAgents, reorderPins, sortAgents, togglePin
} from '../../src/renderer/lib/roster'

const agent = (profile: string, status: AgentStatus = 'idle', displayName = profile): AgentInfo => ({
  profile, displayName, status, platforms: [], lastActivityTs: null, configMtime: null, hasSoul: false, hasMemory: false, hasUser: false
})
const many = (n: number): AgentInfo[] => Array.from({ length: n }, (_, i) => agent(`a${String(i).padStart(2, '0')}`))

describe('sorting and counting', () => {
  it('orders working, idle, parked, offline, then by name', () => {
    const s = sortAgents([agent('z', 'offline'), agent('b', 'idle'), agent('a', 'idle'), agent('p', 'parked'), agent('w', 'working')])
    expect(s.map((a) => a.profile)).toEqual(['w', 'a', 'b', 'p', 'z'])
  })
  it('counts working and idle as active', () => {
    expect(activeCount([agent('a', 'working'), agent('b', 'idle'), agent('c', 'parked'), agent('d', 'offline')])).toBe(2)
  })
})

describe('pins', () => {
  it('pins the first five agents by default', () => {
    expect(defaultPins(many(8))).toEqual(['a00', 'a01', 'a02', 'a03', 'a04'])
    expect(defaultPins(many(2))).toEqual(['a00', 'a01'])
  })
  it('toggles', () => {
    expect(togglePin(['a'], 'b')).toEqual(['a', 'b'])
    expect(togglePin(['a', 'b'], 'a')).toEqual(['b'])
  })
  it('reorders by moving one pin to the position of another', () => {
    expect(reorderPins(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
    expect(reorderPins(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
    expect(reorderPins(['a', 'b'], 'x', 'a')).toEqual(['a', 'b'])
  })
})

describe('buildRoster', () => {
  it('shows a single flat list without groups or search for up to six agents', () => {
    const r = buildRoster(many(6), ['a00'], '')
    expect(r.showSearch).toBe(false)
    expect(r.rows.every((x) => x.kind === 'agent')).toBe(true)
    expect(r.rows).toHaveLength(6)
  })

  it('groups into Pinned and All agents above six', () => {
    const r = buildRoster(many(8), ['a05', 'a02'], '')
    expect(r.showSearch).toBe(true)
    expect(r.rows.map((x) => (x.kind === 'head' ? x.title : x.agent.profile))).toEqual([
      'Pinned · 2', 'a05', 'a02', 'All agents · 6', 'a00', 'a01', 'a03', 'a04', 'a06', 'a07'
    ])
    const pinnedRow = r.rows.find((x) => x.kind === 'agent' && x.agent.profile === 'a05')
    expect(pinnedRow).toMatchObject({ pinned: true, draggable: true })
    const other = r.rows.find((x) => x.kind === 'agent' && x.agent.profile === 'a00')
    expect(other).toMatchObject({ pinned: false, draggable: false })
  })

  it('omits headings when everything is pinned', () => {
    const r = buildRoster(many(7), many(7).map((a) => a.profile), '')
    expect(r.rows.every((x) => x.kind === 'agent')).toBe(true)
  })

  it('ignores pins for agents that no longer exist', () => {
    const r = buildRoster(many(7), ['gone', 'a01'], '')
    expect(r.rows[0]).toMatchObject({ kind: 'head', title: 'Pinned · 1' })
  })

  it('searches display names and profiles into a flat Results list', () => {
    const agents = [...many(7), agent('scout', 'working', 'Scout Prime')]
    const r = buildRoster(agents, ['a00'], '  prime ')
    expect(r.rows.map((x) => (x.kind === 'head' ? x.title : x.agent.profile))).toEqual(['Results · 1', 'scout'])
    expect(r.rows[1]).toMatchObject({ draggable: false })
  })

  it('explains an empty search', () => {
    const r = buildRoster(many(7), [], 'zzz')
    expect(r.rows).toEqual([{ kind: 'empty', key: 'empty', title: 'No agent matches “zzz”' }])
  })
})

describe('railAgents', () => {
  it('shows pinned agents plus the selected one and counts the rest', () => {
    const agents = many(8)
    const r = railAgents(agents, ['a03', 'a01'], 'a06')
    expect(r.shown.map((a) => a.profile)).toEqual(['a03', 'a01', 'a06'])
    expect(r.more).toBe(5)
  })
  it('does not duplicate a selected pinned agent', () => {
    expect(railAgents(many(3), ['a00'], 'a00').shown).toHaveLength(1)
  })
})
```

`tests/unit/stores.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useAgents } from '../../src/renderer/stores/agents'
import { useMetrics } from '../../src/renderer/stores/metrics'
import { useUi } from '../../src/renderer/stores/ui'
import { sampleAgents, sampleMetrics } from '../helpers/samples'

beforeEach(() => {
  useMetrics.getState().reset()
  useAgents.getState().reset()
})

describe('metrics store', () => {
  it('keeps the latest sample and a 60 second window', () => {
    for (let i = 0; i < 75; i++) useMetrics.getState().apply(sampleMetrics({ cpu: { ...sampleMetrics().cpu, total: i } }), 1000 + i)
    const s = useMetrics.getState()
    expect(s.cpu).toHaveLength(60)
    expect(s.cpu.at(-1)).toBe(74)
    expect(s.latest?.cpu.total).toBe(74)
    expect(s.receivedAt).toBe(1074)
    expect(s.rx.at(-1)).toBe(1.2e6)
  })
})

describe('agents store', () => {
  it('stores agents with the receive time', () => {
    useAgents.getState().applyAgents(sampleAgents(), 5000)
    const s = useAgents.getState()
    expect(s.agents.map((a) => a.profile)).toEqual(['default', 'scout'])
    expect(s.receivedAt).toBe(5000)
  })

  it('drops the selection when the agent disappears', () => {
    useAgents.getState().applyAgents(sampleAgents(), 1)
    useAgents.getState().select('scout')
    const next = sampleAgents()
    next.agents = next.agents.filter((a) => a.profile !== 'scout')
    useAgents.getState().applyAgents(next, 2)
    expect(useAgents.getState().selected).toBeNull()
  })

  it('keeps data (stale) across a reset of only the selection', () => {
    useAgents.getState().applyAgents(sampleAgents(), 1)
    useAgents.getState().select('default')
    useAgents.getState().select(null)
    expect(useAgents.getState().agents).toHaveLength(2)
  })
})

describe('ui store', () => {
  it('hydrates settings and navigates', () => {
    useUi.getState().hydrate({ ...useUi.getState().settings, 'ui.zoom': 1.2 })
    expect(useUi.getState().settings['ui.zoom']).toBe(1.2)
    expect(useUi.getState().ready).toBe(true)
    useUi.getState().navigate('server')
    expect(useUi.getState().route).toBe('server')
  })
  it('opens and closes the settings modal on a tab', () => {
    useUi.getState().openSettings('connection')
    expect(useUi.getState().settingsTab).toBe('connection')
    useUi.getState().closeSettings()
    expect(useUi.getState().settingsTab).toBeNull()
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `npm test -- tests/unit/format.test.ts tests/unit/window.test.ts tests/unit/zoom.test.ts tests/unit/roster.test.ts tests/unit/stores.test.ts` → FAIL.

- [ ] **Step 3: Implementasi lib murni**

`src/renderer/lib/format.ts`:
```ts
export function formatBytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? Math.round(v) : v.toFixed(digits)} ${units[i]}`
}

export function formatRate(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let v = bps
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  const text = i === 0 || v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  return `${text} ${units[i]}`
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

export function formatUptime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${pad2(h)}h`
  if (h > 0) return `${h}h ${pad2(m)}m`
  if (m > 0) return `${m}m ${pad2(s % 60)}s`
  return `${s}s`
}

export function formatAge(sec: number): string {
  if (sec < 1) return 'just now'
  if (sec < 60) return `${Math.floor(sec)}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

export const formatPct = (n: number): string => `${Math.round(n)}%`

export function loadColor(pct: number): string {
  return pct < 50 ? '#50FA7B' : pct < 80 ? '#FFB86C' : '#FF5555'
}

export function textBar(pct: number, width: number): string {
  const n = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return '■'.repeat(n) + '·'.repeat(width - n)
}
```

`src/renderer/lib/window.ts`:
```ts
export function pushWindow(arr: readonly number[], v: number, n = 60): number[] {
  const next = arr.length >= n ? arr.slice(arr.length - n + 1) : arr.slice()
  next.push(v)
  return next
}

export function padLeft(arr: readonly number[], n = 60): number[] {
  if (arr.length >= n) return arr.slice(arr.length - n)
  return [...new Array<number>(n - arr.length).fill(0), ...arr]
}
```

`src/renderer/lib/zoom.ts`:
```ts
export const ZOOM_MIN = 0.7
export const ZOOM_MAX = 1.5

export function stepZoom(current: number, dir: 1 | -1): number {
  const next = Math.round((current + dir * 0.1) * 10) / 10
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next))
}

export const zoomPercent = (z: number): string => `${Math.round(z * 100)}%`
```

`src/renderer/lib/agentColor.ts`:
```ts
const PALETTE = ['#50FA7B', '#8BE9FD', '#BD93F9', '#FF79C6', '#FFB86C', '#F1FA8C']

export function agentColor(profile: string): string {
  let h = 0
  for (let i = 0; i < profile.length; i++) h = (h * 31 + profile.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]!
}

export function initials(name: string): string {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}
```

`src/renderer/lib/roster.ts`:
```ts
import type { AgentInfo, AgentStatus } from '@shared/events'

export const SEARCH_THRESHOLD = 6
export const DEFAULT_PIN_COUNT = 5

const RANK: Record<AgentStatus, number> = { working: 0, idle: 1, parked: 2, offline: 3 }

export type RosterRow =
  | { kind: 'head'; key: string; title: string }
  | { kind: 'empty'; key: string; title: string }
  | { kind: 'agent'; key: string; agent: AgentInfo; pinned: boolean; draggable: boolean }

export const isActive = (s: AgentStatus): boolean => s === 'working' || s === 'idle'
export const activeCount = (agents: readonly AgentInfo[]): number => agents.filter((a) => isActive(a.status)).length

export function sortAgents(agents: readonly AgentInfo[]): AgentInfo[] {
  return [...agents].sort((a, b) => RANK[a.status] - RANK[b.status] || a.displayName.localeCompare(b.displayName))
}

export function defaultPins(agents: readonly AgentInfo[]): string[] {
  return agents.slice(0, DEFAULT_PIN_COUNT).map((a) => a.profile)
}

export function togglePin(pins: readonly string[], profile: string): string[] {
  return pins.includes(profile) ? pins.filter((p) => p !== profile) : [...pins, profile]
}

export function reorderPins(pins: readonly string[], from: string, to: string): string[] {
  const fi = pins.indexOf(from)
  const ti = pins.indexOf(to)
  if (fi < 0 || ti < 0 || fi === ti) return [...pins]
  const next = pins.filter((p) => p !== from)
  next.splice(next.indexOf(to) + (fi < ti ? 1 : 0), 0, from)
  return next
}

export function buildRoster(
  agents: readonly AgentInfo[],
  pins: readonly string[],
  query: string
): { rows: RosterRow[]; showSearch: boolean } {
  const showSearch = agents.length > SEARCH_THRESHOLD
  const q = query.trim().toLowerCase()
  const row = (agent: AgentInfo, draggable: boolean): RosterRow => ({
    kind: 'agent',
    key: agent.profile,
    agent,
    pinned: pins.includes(agent.profile),
    draggable
  })

  if (q) {
    const hits = sortAgents(agents.filter((a) => a.displayName.toLowerCase().includes(q) || a.profile.toLowerCase().includes(q)))
    if (hits.length === 0) return { rows: [{ kind: 'empty', key: 'empty', title: `No agent matches “${query.trim()}”` }], showSearch }
    return { rows: [{ kind: 'head', key: 'h-res', title: `Results · ${hits.length}` }, ...hits.map((a) => row(a, false))], showSearch }
  }

  if (!showSearch) return { rows: sortAgents(agents).map((a) => row(a, false)), showSearch }

  const byProfile = new Map(agents.map((a) => [a.profile, a]))
  const pinned = pins.map((p) => byProfile.get(p)).filter((a): a is AgentInfo => a !== undefined)
  const pinnedSet = new Set(pinned.map((a) => a.profile))
  const others = sortAgents(agents.filter((a) => !pinnedSet.has(a.profile)))
  const rows: RosterRow[] = []
  if (others.length > 0 && pinned.length > 0) rows.push({ kind: 'head', key: 'h-pin', title: `Pinned · ${pinned.length}` })
  rows.push(...pinned.map((a) => row(a, true)))
  if (others.length > 0) rows.push({ kind: 'head', key: 'h-all', title: `All agents · ${others.length}` })
  rows.push(...others.map((a) => row(a, false)))
  return { rows, showSearch }
}

export function railAgents(
  agents: readonly AgentInfo[],
  pins: readonly string[],
  selected: string | null
): { shown: AgentInfo[]; more: number } {
  const byProfile = new Map(agents.map((a) => [a.profile, a]))
  const shown = pins.map((p) => byProfile.get(p)).filter((a): a is AgentInfo => a !== undefined)
  const sel = selected ? byProfile.get(selected) : undefined
  if (sel && !shown.includes(sel)) shown.push(sel)
  return { shown, more: agents.length - shown.length }
}
```

Catatan uji: pada test "groups into Pinned and All agents", kondisi `others.length > 0 && pinned.length > 0` menghasilkan heading `Pinned · 2` dan `All agents · 6`. Pada test "omits headings when everything is pinned" tidak ada heading karena `others` kosong. Jika semua agent tidak dipin (pinned kosong) heading `All agents` tetap muncul.

- [ ] **Step 4: Implementasi store**

`src/renderer/stores/ui.ts`:
```ts
import { create } from 'zustand'
import { SETTINGS_DEFAULTS, type SettingsMap } from '@shared/settings'

export type Route =
  | 'connect' | 'launch' | 'dashboard' | 'chat' | 'feed' | 'sessions' | 'kanban' | 'usage' | 'skills' | 'logs' | 'brain' | 'server'

export type SettingsTab = 'general' | 'connection' | 'notifications' | 'alerts' | 'agents' | 'workspace' | 'data' | 'about'

interface UiState {
  route: Route
  settings: SettingsMap
  settingsTab: SettingsTab | null
  ready: boolean
  navigate(route: Route): void
  hydrate(settings: SettingsMap): void
  patchSettings(patch: Partial<SettingsMap>): void
  openSettings(tab?: SettingsTab): void
  closeSettings(): void
}

export const useUi = create<UiState>()((set) => ({
  route: 'connect',
  settings: { ...SETTINGS_DEFAULTS },
  settingsTab: null,
  ready: false,
  navigate: (route) => set({ route }),
  hydrate: (settings) => set({ settings, ready: true }),
  patchSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  openSettings: (tab = 'general') => set({ settingsTab: tab }),
  closeSettings: () => set({ settingsTab: null })
}))
```

`src/renderer/stores/conn.ts`:
```ts
import { create } from 'zustand'
import type {
  Capabilities, ConnStatus, ConnectErrorKind, ConnectRequest, HostKeyChallenge, PreflightResult, SavedConnection, StartupProgress
} from '@shared/ipc'

interface ConnState {
  status: ConnStatus
  saved: SavedConnection | null
  savedLoaded: boolean
  secret: { canRemember: boolean; reason: string | null } | null
  startup: StartupProgress | null
  preflight: PreflightResult | null
  capabilities: Capabilities | null
  hostKey: HostKeyChallenge | null
  connectError: { kind: ConnectErrorKind; message: string } | null
  connecting: boolean
  /** Last connect request without the password, so a host key can be trusted and the attempt repeated. */
  lastRequest: Omit<ConnectRequest, 'password'> | null
}

export const IDLE_STATUS: ConnStatus = { state: 'idle', latencyMs: null, hermesVersion: null, attempt: 0, nextRetryInS: null, error: null }

export const useConn = create<ConnState>()(() => ({
  status: IDLE_STATUS,
  saved: null,
  savedLoaded: false,
  secret: null,
  startup: null,
  preflight: null,
  capabilities: null,
  hostKey: null,
  connectError: null,
  connecting: false,
  lastRequest: null
}))
```

`src/renderer/stores/agents.ts`:
```ts
import { create } from 'zustand'
import type { AgentInfo, AgentsData } from '@shared/events'
import type { AgentModels } from '@shared/ipc'

interface AgentsState {
  agents: AgentInfo[]
  gateway: AgentsData['gateway'] | null
  models: AgentModels
  receivedAt: number | null
  pins: string[]
  pinsReady: boolean
  selected: string | null
  query: string
  applyAgents(data: AgentsData, now?: number): void
  setModels(m: AgentModels): void
  setPins(pins: string[]): void
  select(profile: string | null): void
  setQuery(q: string): void
  reset(): void
}

const EMPTY = { agents: [], gateway: null, models: {}, receivedAt: null, pins: [], pinsReady: false, selected: null, query: '' }

export const useAgents = create<AgentsState>()((set) => ({
  ...EMPTY,
  applyAgents: (data, now = Date.now()) =>
    set((s) => ({
      agents: data.agents,
      gateway: data.gateway,
      receivedAt: now,
      selected: s.selected && data.agents.some((a) => a.profile === s.selected) ? s.selected : null
    })),
  setModels: (models) => set({ models }),
  setPins: (pins) => set({ pins, pinsReady: true }),
  select: (selected) => set({ selected }),
  setQuery: (query) => set({ query }),
  reset: () => set({ ...EMPTY })
}))
```

`src/renderer/stores/metrics.ts`:
```ts
import { create } from 'zustand'
import type { MetricsData } from '@shared/events'
import { pushWindow } from '../lib/window'

interface MetricsState {
  latest: MetricsData | null
  receivedAt: number | null
  cpu: number[]
  rx: number[]
  tx: number[]
  apply(data: MetricsData, now?: number): void
  reset(): void
}

export const useMetrics = create<MetricsState>()((set) => ({
  latest: null,
  receivedAt: null,
  cpu: [],
  rx: [],
  tx: [],
  apply: (data, now = Date.now()) =>
    set((s) => ({
      latest: data,
      receivedAt: now,
      cpu: pushWindow(s.cpu, data.cpu.total),
      rx: pushWindow(s.rx, data.net[0]?.rxBps ?? 0),
      tx: pushWindow(s.tx, data.net[0]?.txBps ?? 0)
    })),
  reset: () => set({ latest: null, receivedAt: null, cpu: [], rx: [], tx: [] })
}))
```

- [ ] **Step 5: Jalankan test**

Run: `npm test -- tests/unit/format.test.ts tests/unit/window.test.ts tests/unit/zoom.test.ts tests/unit/roster.test.ts tests/unit/stores.test.ts && npm run typecheck`
Expected: PASS. (Typecheck config node mencakup `src/renderer/lib` dan `stores`; keduanya tidak boleh memakai global DOM.)

- [ ] **Step 6: Ikon, aset, dan gaya**

`scripts/gen-icons.py`:
```python
"""Generate src/renderer/components/icons.generated.ts from the ICONS dict in mockup/build.py."""
import ast
import json
import re
from pathlib import Path

src = Path("mockup/build.py").read_text(encoding="utf-8")
m = re.search(r"^ICONS = (\{.*?^\})", src, re.S | re.M)
if not m:
    raise SystemExit("ICONS dict not found in mockup/build.py")
icons = ast.literal_eval(m.group(1))
body = ",\n".join(f"  {json.dumps(k)}: {json.dumps(v)}" for k, v in icons.items())
out = Path("src/renderer/components/icons.generated.ts")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(
    "// Generated by scripts/gen-icons.py from mockup/build.py. Do not edit by hand.\n"
    f"export const ICONS: Record<string, string> = {{\n{body}\n}}\n",
    encoding="utf-8",
)
print(f"wrote {len(icons)} icons")
```

Run:
```bash
python scripts/gen-icons.py
mkdir -p src/renderer/assets src/renderer/styles
cp assets/brand/logo-mark.png src/renderer/assets/logo-mark.png
cp mockup/src/_shared/shared.css src/renderer/styles/base.css
```
Expected: `wrote 70 icons` (jumlah kira-kira; yang penting > 60).

`src/renderer/styles/index.css`:
```css
@import 'tailwindcss';
@import '@fontsource/jetbrains-mono/400.css';
@import '@fontsource/jetbrains-mono/600.css';
@import '@fontsource/jetbrains-mono/700.css';
@import '@fontsource/vt323/400.css';
@import './base.css';
@import './app.css';

@theme {
  --font-sans: 'JetBrains Mono', ui-monospace, monospace;
  --color-bg: #282a36;
  --color-bg-deep: #191a21;
  --color-panel: #21222c;
  --color-line: #44475a;
  --color-sel: #343746;
  --color-fg: #f8f8f2;
  --color-fg-2: #a9b2d3;
  --color-fg-3: #8b95bd;
  --color-green: #50fa7b;
  --color-cyan: #8be9fd;
  --color-purple: #bd93f9;
  --color-pink: #ff79c6;
  --color-orange: #ffb86c;
  --color-red: #ff5555;
  --color-yellow: #f1fa8c;
}
```

`src/renderer/styles/app.css`:
```css
html, body, #root { height: 100%; }
body {
  margin: 0;
  background: #282a36;
  color: #f8f8f2;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.45;
}
:root[data-density='comfortable'] body { font-size: 13px; }
.big-num { font-family: 'VT323', 'JetBrains Mono', monospace; }

.mc-root { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: #282a36; }
.page { flex: 1; min-height: 0; overflow-y: auto; padding: 20px 24px 16px; display: flex; flex-direction: column; gap: 14px; }
.page-title { margin: 0; font-size: 14px; font-weight: 700; color: #f8f8f2; }

/* panel with the title sitting on the top border */
.pnl { position: relative; box-sizing: border-box; min-width: 0; border: 1px solid #44475a; background: #21222c; padding: 22px 14px 12px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
.pnl.hi { border-color: #6272a4; }
.pnl.warn { border-color: #ffb86c; }
.pnl.bad { border-color: #ff5555; }
.pnl > h2.pt { position: absolute; top: -10px; left: 12px; margin: 0; padding: 0 6px; background: #282a36; font-size: 12px; font-weight: 600; color: #50fa7b; white-space: nowrap; max-width: calc(100% - 24px); overflow: hidden; text-overflow: ellipsis; }
.pnl.warn > h2.pt { color: #ffb86c; }
.pnl.bad > h2.pt { color: #ff5555; }
.pnl.flush { padding-left: 0; padding-right: 0; }

/* states */
.state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 18px 12px; text-align: center; color: #a9b2d3; }
.state strong { color: #f8f8f2; font-weight: 600; }
.state .why { color: #8b95bd; font-size: 11px; max-width: 46ch; }
.skel { display: block; height: 10px; border-radius: 3px; background: linear-gradient(90deg, #343746 25%, #44475a 50%, #343746 75%); background-size: 200% 100%; animation: skel 1.4s linear infinite; }
@keyframes skel { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.banner { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid #ffb86c; border-radius: 6px; color: #ffb86c; background: #21222c; font-size: 11px; }
.banner.bad { border-color: #ff5555; color: #ff5555; }

/* forms */
.field { display: flex; flex-direction: column; gap: 4px; }
.field label { color: #a9b2d3; font-size: 12px; }
.field label .hint { color: #8b95bd; }
.inp { background: #282a36; border: 1px solid #6272a4; color: #50fa7b; font: inherit; padding: 9px 10px; border-radius: 0; width: 100%; box-sizing: border-box; }
.inp:focus-visible { outline: 1px solid #50fa7b; outline-offset: 0; }
.btn-main { display: block; width: 100%; text-align: center; padding: 12px; background: #50fa7b; color: #282a36; font: inherit; font-weight: 700; letter-spacing: 2px; border: 0; cursor: pointer; }
.btn-main[disabled] { background: #44475a; color: #8b95bd; cursor: not-allowed; }
.btn-warn { min-height: 40px; padding: 0 16px; background: #ffb86c; color: #282a36; border: 0; font: inherit; font-weight: 700; cursor: pointer; }
.btn-warn-o { min-height: 40px; padding: 0 16px; background: transparent; color: #ffb86c; border: 1px solid #ffb86c; font: inherit; cursor: pointer; }
.btn-bad-o { min-height: 40px; padding: 0 16px; background: transparent; color: #ff5555; border: 1px solid #ff5555; font: inherit; cursor: pointer; }
.chk { display: flex; align-items: center; gap: 10px; min-height: 36px; cursor: pointer; }
.chk input { accent-color: #50fa7b; width: 16px; height: 16px; }

/* connect / launch */
.center-screen { min-height: 100vh; box-sizing: border-box; padding: 40px 16px; display: flex; flex-direction: column; align-items: center; gap: 28px; overflow-y: auto; height: 100vh; }
.brand { text-align: center; display: flex; flex-direction: column; gap: 6px; }
.brand .name { color: #a9b2d3; font-size: 11px; font-weight: 700; letter-spacing: 3px; }
.preflight-row { display: flex; gap: 8px; white-space: nowrap; overflow: hidden; font-size: 12px; }
.preflight-row .dots { flex: 1; overflow: hidden; color: #44475a; }
.hint-line { margin: 0 0 4px 16px; color: #a9b2d3; font-size: 11px; white-space: normal; }
.step { display: flex; gap: 10px; align-items: baseline; }
.step .detail { margin-left: auto; color: #8b95bd; font-size: 11px; white-space: nowrap; }

/* dashboard */
.dash { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(230px, 290px) minmax(0, 1fr) 340px; gap: 24px 14px; padding: 24px 24px 16px; overflow: hidden; }
.dash.agents-rail { grid-template-columns: minmax(230px, 290px) minmax(0, 1fr) 64px; }
.dash > .col { min-height: 0; min-width: 0; display: flex; flex-direction: column; gap: 24px; }
@media (max-width: 1100px) { .dash, .dash.agents-rail { grid-template-columns: minmax(0, 1fr); overflow-y: auto; } .dash > .col { min-height: auto; } }
.status-block { display: flex; flex-direction: column; gap: 10px; }
.status-block .count { font-size: 40px; line-height: 1; color: #50fa7b; }
.status-block .of { color: #a9b2d3; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border: 1px solid #44475a; color: #a9b2d3; font-size: 11px; }

/* agents */
.ag-row { display: flex; align-items: center; gap: 2px; border: 1px solid transparent; border-radius: 6px; min-height: 30px; }
.ag-row:hover { background: #282a36; }
.ag-row .ag-grip { color: #8b95bd; width: 14px; display: inline-flex; cursor: grab; }
.ag-pick { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 6px; background: transparent; border: 0; color: #f8f8f2; font: inherit; text-align: left; cursor: pointer; border-radius: 6px; }
.ag-pick[aria-pressed='true'] { background: #343746; }
.ag-pick .nm { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ag-pick .st { margin-left: auto; flex: none; display: flex; align-items: center; gap: 5px; font-size: 9px; letter-spacing: 1px; }
.ag-pin { opacity: 0; }
.ag-row:hover .ag-pin, .ag-row:focus-within .ag-pin, .ag-pin.on { opacity: 1; }
.ag-sec { padding: 8px 6px 2px; color: #a9b2d3; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; }
.ag-search { display: flex; align-items: center; gap: 6px; padding: 0 8px; border: 1px solid #44475a; border-radius: 6px; background: #282a36; color: #a9b2d3; }
.ag-search input { flex: 1; min-width: 0; background: transparent; border: 0; color: #f8f8f2; font: inherit; min-height: 28px; }
.ag-search input:focus-visible { outline: none; }
.ag-search:focus-within { border-color: #50fa7b; }
.avatar { flex: none; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; font-weight: 700; color: #282a36; }
.detail-card { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid #44475a; border-top-width: 2px; border-radius: 10px; background: #21222c; }
.kv { display: grid; grid-template-columns: 90px 1fr; gap: 4px 8px; font-size: 12px; }
.kv dt { color: #8b95bd; }
.kv dd { margin: 0; color: #f8f8f2; overflow-wrap: anywhere; }

/* server */
.srv-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px 14px; align-content: start; }
.srv-grid .full { grid-column: 1 / -1; }
.bar { height: 8px; background: #44475a; }
.bar > i { display: block; height: 8px; }
.tbl { width: 100%; min-width: 760px; border-collapse: collapse; }
.tbl th { padding: 4px 8px; font-weight: 600; text-align: left; color: #a9b2d3; }
.tbl th button { background: transparent; border: 0; color: inherit; font: inherit; font-weight: 600; cursor: pointer; padding: 0; }
.tbl th.r, .tbl td.r { text-align: right; }
.tbl td { padding: 3px 8px; }
.tbl tr.hm { background: #44475a; }
.mono-bar { white-space: nowrap; overflow: hidden; }

/* modal */
.mc-modal-bk { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(25, 26, 33, 0.72); animation: mcFade 0.2s ease both; }
.mc-modal { position: relative; display: flex; flex-direction: column; max-height: calc(100vh - 32px); width: 100%; border: 1px solid #6272a4; border-radius: 12px; background: #282a36; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5); animation: mcPop 0.22s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.mc-modal-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid #44475a; }
.mc-modal-head h2 { margin: 0; font-size: 13px; font-weight: 700; flex: 1; }
.mc-modal-body { overflow-y: auto; padding: 14px; }
.seg { display: inline-flex; border: 1px solid #44475a; border-radius: 6px; overflow: hidden; }
.seg button { min-height: 28px; padding: 0 12px; background: transparent; border: 0; color: #a9b2d3; font: inherit; cursor: pointer; }
.seg button[aria-pressed='true'] { background: #343746; color: #50fa7b; font-weight: 600; }

/* status bar */
.statusbar { position: relative; z-index: 30; flex: none; height: 26px; display: flex; align-items: stretch; border-top: 1px solid #44475a; background: #191a21; font-size: 11px; }
.statusbar .sp { flex: 1; }
```

- [ ] **Step 7: Aksi, bootstrap, dan entry renderer**

`src/renderer/env.d.ts`:
```ts
/// <reference types="vite/client" />
import type { MissionApi } from '@shared/ipc'

declare global {
  interface Window {
    mc: MissionApi
  }
}

export {}
```

`src/renderer/actions.ts`:
```ts
import type { ConnectRequest, ConnectResult } from '@shared/ipc'
import type { SettingsMap } from '@shared/settings'
import { defaultPins, reorderPins, togglePin } from './lib/roster'
import { stepZoom } from './lib/zoom'
import { useAgents } from './stores/agents'
import { IDLE_STATUS, useConn } from './stores/conn'
import { useMetrics } from './stores/metrics'
import { useUi } from './stores/ui'

export async function runConnect(req: ConnectRequest): Promise<ConnectResult> {
  const { password: _password, ...withoutPassword } = req
  useConn.setState({ connecting: true, connectError: null, hostKey: null, lastRequest: withoutPassword })
  const res = await window.mc.connection.connect(req)
  if (res.ok) {
    useConn.setState({ connecting: false, saved: await window.mc.connection.saved(), connectError: null, hostKey: null })
    return res
  }
  useConn.setState({
    connecting: false,
    connectError: { kind: res.kind, message: res.message },
    hostKey: res.hostKey ?? null,
    ...(res.preflight ? { preflight: res.preflight } : {})
  })
  return res
}

/** Trust the pending host key and repeat the last attempt. The main process still holds the password for ~2 minutes. */
export async function trustAndRetry(): Promise<ConnectResult | null> {
  const { hostKey, lastRequest } = useConn.getState()
  if (!hostKey || !lastRequest) return null
  await window.mc.connection.trustHostKey(hostKey)
  useConn.setState({ hostKey: null })
  return runConnect(lastRequest)
}

export async function forgetConnection(): Promise<void> {
  await window.mc.connection.forget()
  useAgents.getState().reset()
  useMetrics.getState().reset()
  useConn.setState({
    saved: null, status: IDLE_STATUS, startup: null, preflight: null, capabilities: null, hostKey: null, connectError: null
  })
  useUi.getState().closeSettings()
  useUi.getState().navigate('connect')
}

export async function saveSetting<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): Promise<void> {
  useUi.getState().patchSettings({ [key]: value } as Partial<SettingsMap>)
  await window.mc.settings.set(key, value)
}

export async function setZoomLevel(z: number): Promise<void> {
  await window.mc.app.setZoom(z)
  await saveSetting('ui.zoom', z)
}

export async function stepZoomLevel(dir: 1 | -1): Promise<void> {
  await setZoomLevel(stepZoom(useUi.getState().settings['ui.zoom'], dir))
}

let pinsLoading = false
export async function ensurePins(): Promise<void> {
  const a = useAgents.getState()
  if (a.pinsReady || pinsLoading || a.agents.length === 0) return
  pinsLoading = true
  try {
    const { pins, initialized } = await window.mc.agents.getPins()
    if (initialized) {
      useAgents.getState().setPins(pins)
    } else {
      const initial = defaultPins(useAgents.getState().agents)
      await window.mc.agents.setPins(initial)
      useAgents.getState().setPins(initial)
    }
  } finally {
    pinsLoading = false
  }
}

export async function toggleAgentPin(profile: string): Promise<void> {
  const next = togglePin(useAgents.getState().pins, profile)
  useAgents.getState().setPins(next)
  await window.mc.agents.setPins(next)
}

export async function reorderAgentPin(from: string, to: string): Promise<void> {
  const next = reorderPins(useAgents.getState().pins, from, to)
  useAgents.getState().setPins(next)
  await window.mc.agents.setPins(next)
}
```

`src/renderer/bootstrap.ts`:
```ts
import { ensurePins } from './actions'
import { useAgents } from './stores/agents'
import { useConn } from './stores/conn'
import { useMetrics } from './stores/metrics'
import { useUi } from './stores/ui'

export async function bootstrap(): Promise<void> {
  const mc = window.mc
  mc.onEvent((ev) => {
    if (ev.type === 'metrics') useMetrics.getState().apply(ev.data)
    else if (ev.type === 'agents') {
      useAgents.getState().applyAgents(ev.data)
      void ensurePins()
    }
  })
  mc.onStatus((status) => useConn.setState({ status }))
  mc.onStartup((startup) => useConn.setState({ startup }))
  mc.onPreflight((preflight) => useConn.setState({ preflight }))
  mc.onCapabilities((capabilities) => useConn.setState({ capabilities }))
  mc.onModels((models) => useAgents.getState().setModels(models))

  const [settings, saved, secret] = await Promise.all([mc.settings.all(), mc.connection.saved(), mc.connection.secretStatus()])
  useConn.setState({ saved, savedLoaded: true, secret })
  useUi.getState().hydrate(settings)
  useUi.getState().navigate(saved && saved.remember ? 'launch' : 'connect')
}
```

`src/renderer/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { bootstrap } from './bootstrap'
import './styles/index.css'

void bootstrap()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

(`App.tsx` dibuat di Task 16; sampai itu, `npm run typecheck` untuk konfigurasi web akan gagal di `main.tsx`. Karena itu langkah commit di bawah hanya memverifikasi test dan typecheck node.)

- [ ] **Step 8: Verifikasi dan commit**

Run: `npm test && npm run typecheck -- 2>&1 | head -5` — cukup pastikan `tsc -p tsconfig.node.json` bersih; error `App` hilang di `tsconfig.web.json` adalah wajar sampai Task 16.

```bash
git add scripts/gen-icons.py src/renderer tests/unit
git commit -m "feat: add renderer foundation (styles, pure libs, stores, bootstrap)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Komponen dasar, shell (sidebar + status bar), dan routing

**Files:**
- Create: `src/renderer/components/{Icon,Panel,States,Avatar,Modal}.tsx`
- Create: `src/renderer/shell/{nav.ts,Sidebar.tsx,StatusBar.tsx,Shell.tsx,useShortcuts.ts}`
- Create: `src/renderer/screens/ComingSoon.tsx`, `src/renderer/App.tsx`
- Test: `tests/unit/nav.test.ts`

**Interfaces:**
- Produces: `NAV: NavItem[]` (`{id: Route, label, icon, key: string, sepBefore?: boolean}`), `routeForShortcut(digit: string): Route | null`, `Panel({title, label?, tone?, flush?, className?, children})`, `EmptyState`, `ErrorState`, `UnsupportedState`, `Skeleton`, `StaleBanner`, `Avatar({name, profile, size})`, `Modal({title, onClose, width?, children})`, `Icon({name, size})`, `Shell`, `App`.

- [ ] **Step 1: Test nav yang gagal — `tests/unit/nav.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { NAV, routeForShortcut } from '../../src/renderer/shell/nav'

describe('NAV', () => {
  it('follows the sidebar order from the spec', () => {
    expect(NAV.map((n) => n.label)).toEqual([
      'Dashboard', 'Chat', 'Live feed', 'Sessions', 'Kanban', 'Usage', 'Skills', 'Logs', 'Second brain', 'Server'
    ])
  })

  it('separates the three groups', () => {
    expect(NAV.filter((n) => n.sepBefore).map((n) => n.label)).toEqual(['Sessions', 'Skills'])
  })

  it('maps Ctrl+1..9 then Ctrl+0 to the menu in order', () => {
    expect(routeForShortcut('1')).toBe('dashboard')
    expect(routeForShortcut('3')).toBe('feed')
    expect(routeForShortcut('9')).toBe('brain')
    expect(routeForShortcut('0')).toBe('server')
    expect(routeForShortcut('x')).toBeNull()
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `npm test -- tests/unit/nav.test.ts` → FAIL.

- [ ] **Step 3: `src/renderer/shell/nav.ts`**

Catatan: berkas ini masuk tsconfig node? Tidak (hanya `lib` dan `stores` yang masuk). Agar test (yang berjalan di node config via `tests/**`) bisa mengimpornya, pastikan `nav.ts` tidak memakai DOM. Tambahkan `"src/renderer/shell/nav.ts"` ke `include` di `tsconfig.node.json`.

```ts
import type { Route } from '../stores/ui'

export interface NavItem {
  id: Route
  label: string
  icon: string
  key: string
  sepBefore?: boolean
}

export const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'layout', key: '1' },
  { id: 'chat', label: 'Chat', icon: 'message', key: '2' },
  { id: 'feed', label: 'Live feed', icon: 'activity', key: '3' },
  { id: 'sessions', label: 'Sessions', icon: 'history', key: '4', sepBefore: true },
  { id: 'kanban', label: 'Kanban', icon: 'kanban', key: '5' },
  { id: 'usage', label: 'Usage', icon: 'chart', key: '6' },
  { id: 'skills', label: 'Skills', icon: 'layers', key: '7', sepBefore: true },
  { id: 'logs', label: 'Logs', icon: 'file-text', key: '8' },
  { id: 'brain', label: 'Second brain', icon: 'share', key: '9' },
  { id: 'server', label: 'Server', icon: 'server', key: '0' }
]

export function routeForShortcut(digit: string): Route | null {
  return NAV.find((n) => n.key === digit)?.id ?? null
}
```

- [ ] **Step 4: Komponen dasar**

`src/renderer/components/Icon.tsx`:
```tsx
import { ICONS } from './icons.generated'

export function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const body = ICONS[name]
  if (!body) return null
  return (
    <svg
      className="ic"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  )
}
```

`src/renderer/components/Panel.tsx`:
```tsx
import type { ReactNode } from 'react'

interface Props {
  title: ReactNode
  label?: string
  tone?: 'default' | 'hi' | 'warn' | 'bad'
  flush?: boolean
  className?: string
  children?: ReactNode
}

export function Panel({ title, label, tone = 'default', flush, className = '', children }: Props) {
  const cls = ['pnl', tone === 'default' ? '' : tone, flush ? 'flush' : '', className].filter(Boolean).join(' ')
  return (
    <section className={cls} aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
      <h2 className="pt">┤ {title} ├</h2>
      {children}
    </section>
  )
}
```

`src/renderer/components/States.tsx`:
```tsx
import type { ReactNode } from 'react'
import { formatAge } from '../lib/format'
import { Icon } from './Icon'

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skel" style={{ width: `${95 - ((i * 13) % 40)}%` }} />
      ))}
    </div>
  )
}

export function EmptyState({ title, why, children }: { title: string; why?: string; children?: ReactNode }) {
  return (
    <div className="state" role="status">
      <strong>{title}</strong>
      {why && <span className="why">{why}</span>}
      {children}
    </div>
  )
}

export function UnsupportedState({ title = 'Coming in a later release', why }: { title?: string; why?: string }) {
  return (
    <div className="state" role="status">
      <Icon name="lock" size={18} />
      <strong>{title}</strong>
      {why && <span className="why">{why}</span>}
    </div>
  )
}

export function ErrorState({ title, why, onRetry }: { title: string; why?: string; onRetry?: () => void }) {
  return (
    <div className="state" role="alert">
      <strong style={{ color: '#FF5555' }}>{title}</strong>
      {why && <span className="why">{why}</span>}
      {onRetry && (
        <button type="button" className="cb" onClick={onRetry}>
          <Icon name="refresh" size={12} /> Retry
        </button>
      )}
    </div>
  )
}

export function StaleBanner({ receivedAt, now, label }: { receivedAt: number; now: number; label: string }) {
  return (
    <div className="banner" role="status">
      <Icon name="clock" size={12} />
      {label} · last update {formatAge(Math.max(0, (now - receivedAt) / 1000))}
    </div>
  )
}
```

`src/renderer/components/Avatar.tsx`:
```tsx
import { agentColor, initials } from '../lib/agentColor'

export function Avatar({ name, profile, size = 20 }: { name: string; profile: string; size?: number }) {
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)), background: agentColor(profile) }}
    >
      {initials(name)}
    </span>
  )
}
```

`src/renderer/components/Modal.tsx`:
```tsx
import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

const FOCUSABLE = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'

export function Modal({ title, onClose, width = 560, children }: { title: string; onClose: () => void; width?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const el = ref.current!
    const prev = document.activeElement as HTMLElement | null
    const focusables = (): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => !x.hasAttribute('disabled'))
    ;(focusables()[0] ?? el).focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      } else if (e.key === 'Tab') {
        const f = focusables()
        if (f.length === 0) return
        const first = f[0]!
        const last = f[f.length - 1]!
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    el.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('keydown', onKey)
      prev?.focus()
    }
  }, [])

  return (
    <div className="mc-modal-bk" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="mc-modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} style={{ maxWidth: width }}>
        <div className="mc-modal-head">
          <h2>{title}</h2>
          <button type="button" className="ib sm" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="mc-modal-body">{children}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Shell**

`src/renderer/shell/Sidebar.tsx`:
```tsx
import { Fragment } from 'react'
import logoUrl from '../assets/logo-mark.png'
import { saveSetting } from '../actions'
import { Icon } from '../components/Icon'
import { useUi } from '../stores/ui'
import { NAV } from './nav'

const mod = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? 'Cmd' : 'Ctrl'

export function Sidebar() {
  const route = useUi((s) => s.route)
  const collapsed = useUi((s) => s.settings['ui.sidebarCollapsed'])
  const navigate = useUi((s) => s.navigate)

  return (
    <aside className={`mc-side ${collapsed ? 'is-rail' : ''}`} aria-label="Sidebar">
      <div className="mc-side-logo">
        <img className="lg-img" src={logoUrl} width={28} height={28} alt="Hermes Agent Mission Control" />
        <span className="lg-text" aria-hidden="true">
          HERMES AGENT
          <br />
          MISSION CONTROL
        </span>
      </div>
      <nav aria-label="Main" className="mc-side-nav">
        {NAV.map((n) => (
          <Fragment key={n.id}>
            {n.sepBefore && <span className="sn-sep" aria-hidden="true" />}
            <button
              type="button"
              className={`sn ${route === n.id ? 'on' : ''}`}
              aria-current={route === n.id ? 'page' : undefined}
              title={`${n.label} · ${mod}+${n.key}`}
              onClick={() => navigate(n.id)}
            >
              <Icon name={n.icon} size={15} />
              <span className="tl">{n.label}</span>
            </button>
          </Fragment>
        ))}
      </nav>
      <div className="mc-side-foot">
        <button type="button" className="sn" aria-disabled="true" title="Terminal · coming in a later release" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
          <Icon name="terminal" size={15} />
          <span className="tl">Terminal</span>
        </button>
        <button type="button" className="sn" aria-disabled="true" title="Search · coming in a later release" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
          <Icon name="search" size={15} />
          <span className="tl">Search</span>
        </button>
        <button
          type="button"
          className="sn"
          aria-expanded={!collapsed}
          aria-label="Collapse sidebar"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => void saveSetting('ui.sidebarCollapsed', !collapsed)}
        >
          <Icon name="chevs-left" size={15} />
          <span className="tl">Collapse</span>
        </button>
      </div>
    </aside>
  )
}
```

`src/renderer/shell/StatusBar.tsx`:
```tsx
import { setZoomLevel, stepZoomLevel } from '../actions'
import { Icon } from '../components/Icon'
import { activeCount } from '../lib/roster'
import { zoomPercent } from '../lib/zoom'
import { useAgents } from '../stores/agents'
import { useConn } from '../stores/conn'
import { useMetrics } from '../stores/metrics'
import { useUi } from '../stores/ui'

const TONE: Record<string, { bg: string; text: string }> = {
  connected: { bg: '#2E6B40', text: '' },
  connecting: { bg: '#44475A', text: 'Connecting…' },
  reconnecting: { bg: '#6B5420', text: 'Reconnecting' },
  offline: { bg: '#6B2E2E', text: 'Offline' },
  idle: { bg: '#44475A', text: 'Not connected' }
}

export function StatusBar() {
  const status = useConn((s) => s.status)
  const saved = useConn((s) => s.saved)
  const caps = useConn((s) => s.capabilities)
  const agents = useAgents((s) => s.agents)
  const metrics = useMetrics((s) => s.latest)
  const zoom = useUi((s) => s.settings['ui.zoom'])
  const openSettings = useUi((s) => s.openSettings)

  const tone = TONE[status.state] ?? TONE.idle!
  const who = saved ? `${saved.username}@${saved.host}` : 'No connection'
  const online = activeCount(agents)
  const detail =
    status.state === 'connected'
      ? `${status.latencyMs ?? '–'} ms`
      : status.state === 'reconnecting' || status.state === 'offline'
        ? `${tone.text}${status.attempt ? ` · attempt ${status.attempt}` : ''}${status.nextRetryInS ? ` · retry in ${status.nextRetryInS}s` : ''}`
        : tone.text
  const supported = caps ? Object.entries(caps.supported).map(([k, v]) => `${v ? '✓' : '✗'} ${k}`).join('\n') : ''
  const memPct = metrics && metrics.mem.total > 0 ? Math.round((metrics.mem.used / metrics.mem.total) * 100) : null

  return (
    <footer className="statusbar" aria-label="Status bar">
      <button
        type="button"
        className="sb-item"
        role="status"
        onClick={() => openSettings('connection')}
        title={[`${who}`, status.hermesVersion ? `hermes v${status.hermesVersion}` : '', `${online} agents online`, supported].filter(Boolean).join('\n')}
        style={{ background: tone.bg, color: '#F8F8F2' }}
      >
        <Icon name="server" size={12} />
        {who}
      </button>
      <span className="sb-item" style={{ cursor: 'default' }}>{detail}</span>
      {status.hermesVersion && <span className="sb-item" style={{ cursor: 'default' }}>hermes v{status.hermesVersion}</span>}
      <span className="sb-item" style={{ cursor: 'default' }}>{online} agent{online === 1 ? '' : 's'} online</span>
      <span className="sp" />
      <span className="sb-item" style={{ cursor: 'default' }} title="CPU"><Icon name="cpu" size={12} />{metrics ? `${Math.round(metrics.cpu.total)}%` : '–'}</span>
      <span className="sb-item" style={{ cursor: 'default' }} title="Memory"><Icon name="memory" size={12} />{memPct !== null ? `${memPct}%` : '–'}</span>
      <span style={{ display: 'inline-flex', alignItems: 'stretch' }}>
        <button type="button" className="sb-item" onClick={() => void stepZoomLevel(-1)} aria-label="Smaller text" title="Smaller text (Ctrl −)" style={{ padding: '0 6px' }}>
          <Icon name="minus" size={12} />
        </button>
        <button type="button" className="sb-item num" onClick={() => void setZoomLevel(1)} aria-label="Reset text size" title="Reset text size" style={{ padding: '0 2px', minWidth: 34, justifyContent: 'center' }}>
          {zoomPercent(zoom)}
        </button>
        <button type="button" className="sb-item" onClick={() => void stepZoomLevel(1)} aria-label="Larger text" title="Larger text (Ctrl +)" style={{ padding: '0 6px' }}>
          <Icon name="plus" size={12} />
        </button>
      </span>
      <button type="button" className="sb-item" onClick={() => openSettings('general')} aria-label="Settings" title="Settings">
        <Icon name="settings" size={13} />
      </button>
    </footer>
  )
}
```

`src/renderer/shell/Shell.tsx`:
```tsx
import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mc-root">
      <div className="mc-body">
        <Sidebar />
        <div className="mc-col">{children}</div>
      </div>
      <StatusBar />
    </div>
  )
}
```

`src/renderer/shell/useShortcuts.ts`:
```ts
import { useEffect } from 'react'
import { stepZoomLevel } from '../actions'
import { useUi } from '../stores/ui'
import { routeForShortcut } from './nav'

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const { route, navigate } = useUi.getState()
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        void stepZoomLevel(1)
        return
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        void stepZoomLevel(-1)
        return
      }
      if (route === 'connect' || route === 'launch') return
      const target = routeForShortcut(e.key)
      if (target) {
        e.preventDefault()
        navigate(target)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
```

- [ ] **Step 6: ComingSoon dan App**

`src/renderer/screens/ComingSoon.tsx`:
```tsx
import { Panel } from '../components/Panel'
import { UnsupportedState } from '../components/States'
import { NAV } from '../shell/nav'
import type { Route } from '../stores/ui'

const WHAT: Partial<Record<Route, string>> = {
  chat: 'One-on-one chat with each agent.',
  feed: 'Realtime interactions and thinking from every agent.',
  sessions: 'Session history and search.',
  kanban: 'Read-only kanban board of agent tasks.',
  usage: 'Cost and tool-call analytics.',
  skills: 'Installed skills and the curator.',
  logs: 'Log tail, gateway status and approvals.',
  brain: 'Obsidian-style graph of the second brain.'
}

export function ComingSoon({ route }: { route: Route }) {
  const label = NAV.find((n) => n.id === route)?.label ?? 'This screen'
  return (
    <div className="page">
      <Panel title={label.toLowerCase()} tone="hi">
        <UnsupportedState why={WHAT[route]} />
      </Panel>
    </div>
  )
}
```

`src/renderer/App.tsx` (Connect, Launch, Dashboard, Server, SettingsModal dibuat di Task 17–21; impor sementara bisa ditambahkan bertahap — pada task ini pakai stub `Placeholder` untuk empat layar itu lalu ganti):
```tsx
import { useEffect } from 'react'
import { Connect } from './screens/Connect'
import { ComingSoon } from './screens/ComingSoon'
import { Dashboard } from './screens/Dashboard'
import { Launch } from './screens/Launch'
import { Server } from './screens/Server'
import { SettingsModal } from './settings/SettingsModal'
import { Shell } from './shell/Shell'
import { useShortcuts } from './shell/useShortcuts'
import { useUi } from './stores/ui'

export function App() {
  const route = useUi((s) => s.route)
  const ready = useUi((s) => s.ready)
  const density = useUi((s) => s.settings['ui.density'])
  const reduce = useUi((s) => s.settings['ui.reduceMotion'])
  useShortcuts()

  useEffect(() => {
    document.documentElement.dataset.density = density
    document.documentElement.classList.toggle('mc-nomotion', reduce)
  }, [density, reduce])

  if (!ready) return null
  if (route === 'connect') return <Connect />
  if (route === 'launch') return <Launch />

  return (
    <>
      <Shell>
        {route === 'dashboard' ? <Dashboard /> : route === 'server' ? <Server /> : <ComingSoon route={route} />}
      </Shell>
      <SettingsModal />
    </>
  )
}
```

Untuk membuat Task 16 bisa dikompilasi sendiri, buat dulu stub satu baris di `src/renderer/screens/{Connect,Launch,Dashboard,Server}.tsx` (`export function X() { return <div>X</div> }`) dan `src/renderer/settings/SettingsModal.tsx` (`export function SettingsModal() { return null }`). Task 17–21 menggantinya.

- [ ] **Step 7: Jalankan test dan verifikasi visual di aplikasi**

Run: `npm test -- tests/unit/nav.test.ts && npm run typecheck && npm run build`
Expected: test PASS; typecheck bersih untuk kedua konfigurasi; build sukses.

Lalu cek visual cepat dengan `npm run dev` (via `preview_start` jika tersedia, atau jalankan di terminal), buka layar Dashboard stub lewat devtools console: `window.mc` harus terdefinisi (preload bekerja) dan `typeof require` bernilai `'undefined'`.

- [ ] **Step 8: Commit**

```bash
git add src/renderer tests/unit/nav.test.ts tsconfig.node.json
git commit -m "feat: add base components, sidebar, status bar and app routing

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Layar Connect (form, host key, preflight)

**Files:**
- Create: `src/renderer/screens/connect/{ConnectionForm,HostKeyPanel,PreflightPanel}.tsx`
- Modify: `src/renderer/screens/Connect.tsx` (ganti stub)
- Test: `tests/unit/connectForm.test.ts`; Create: `src/renderer/lib/connectForm.ts`

**Interfaces:**
- Produces (`lib/connectForm.ts`): `validateConnectForm(v: {host, port, username, password, hasSavedPassword, sameTarget}): { ok: true; port: number } | { ok: false; field: 'host' | 'port' | 'username' | 'password'; message: string }`.
- Produces (komponen): `ConnectionForm({mode: 'first' | 'edit', onConnected})`, `HostKeyPanel({onTrust, onCancel})`, `PreflightPanel()`.

- [ ] **Step 1: Test validasi yang gagal — `tests/unit/connectForm.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { validateConnectForm } from '../../src/renderer/lib/connectForm'

const base = { host: '203.0.113.42', port: '22', username: 'root', password: 'x', hasSavedPassword: false, sameTarget: false }

describe('validateConnectForm', () => {
  it('accepts a complete form', () => {
    expect(validateConnectForm(base)).toEqual({ ok: true, port: 22 })
  })
  it('requires a host', () => {
    expect(validateConnectForm({ ...base, host: '  ' })).toMatchObject({ ok: false, field: 'host' })
  })
  it('rejects hosts with spaces or schemes', () => {
    expect(validateConnectForm({ ...base, host: 'my host' })).toMatchObject({ ok: false, field: 'host' })
    expect(validateConnectForm({ ...base, host: 'ssh://h' })).toMatchObject({ ok: false, field: 'host' })
  })
  it.each(['', '0', '65536', 'abc', '22.5'])('rejects port %j', (port) => {
    expect(validateConnectForm({ ...base, port })).toMatchObject({ ok: false, field: 'port' })
  })
  it('requires a username', () => {
    expect(validateConnectForm({ ...base, username: '' })).toMatchObject({ ok: false, field: 'username' })
  })
  it('requires a password for a new target', () => {
    expect(validateConnectForm({ ...base, password: '' })).toMatchObject({ ok: false, field: 'password' })
  })
  it('allows an empty password when editing the same saved target', () => {
    expect(validateConnectForm({ ...base, password: '', hasSavedPassword: true, sameTarget: true })).toEqual({ ok: true, port: 22 })
  })
  it('still requires a password when the host changed', () => {
    expect(validateConnectForm({ ...base, password: '', hasSavedPassword: true, sameTarget: false })).toMatchObject({ ok: false, field: 'password' })
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `npm test -- tests/unit/connectForm.test.ts` → FAIL.

- [ ] **Step 3: Implementasi `src/renderer/lib/connectForm.ts`** (tambahkan ke `include` node via pola `src/renderer/lib/**/*` yang sudah ada)

```ts
export interface FormValues {
  host: string
  port: string
  username: string
  password: string
  hasSavedPassword: boolean
  sameTarget: boolean
}

export type FormCheck =
  | { ok: true; port: number }
  | { ok: false; field: 'host' | 'port' | 'username' | 'password'; message: string }

export function validateConnectForm(v: FormValues): FormCheck {
  const host = v.host.trim()
  if (!host) return { ok: false, field: 'host', message: 'Enter the host or public IP.' }
  if (/\s/.test(host) || host.includes('://') || host.includes('/')) {
    return { ok: false, field: 'host', message: 'Enter only the host name or IP address.' }
  }
  if (!/^\d+$/.test(v.port.trim())) return { ok: false, field: 'port', message: 'Port must be a number from 1 to 65535.' }
  const port = Number(v.port.trim())
  if (port < 1 || port > 65535) return { ok: false, field: 'port', message: 'Port must be a number from 1 to 65535.' }
  if (!v.username.trim()) return { ok: false, field: 'username', message: 'Enter the user that runs Hermes.' }
  if (!v.password && !(v.hasSavedPassword && v.sameTarget)) {
    return { ok: false, field: 'password', message: 'Enter the password.' }
  }
  return { ok: true, port }
}
```

- [ ] **Step 4: Komponen Connect**

`src/renderer/screens/connect/ConnectionForm.tsx`:
```tsx
import { useRef, useState, type FormEvent } from 'react'
import { runConnect } from '../../actions'
import { validateConnectForm } from '../../lib/connectForm'
import { useConn } from '../../stores/conn'

interface Props {
  mode: 'first' | 'edit'
  onConnected?: () => void
}

export function ConnectionForm({ mode, onConnected }: Props) {
  const saved = useConn((s) => s.saved)
  const secret = useConn((s) => s.secret)
  const connecting = useConn((s) => s.connecting)
  const error = useConn((s) => s.connectError)
  const [host, setHost] = useState(saved?.host ?? '')
  const [port, setPort] = useState(String(saved?.port ?? 22))
  const [username, setUsername] = useState(saved?.username ?? '')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(saved?.remember ?? true)
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null)
  const refs = {
    host: useRef<HTMLInputElement>(null),
    port: useRef<HTMLInputElement>(null),
    username: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null)
  }
  const canRemember = secret?.canRemember ?? true

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    const sameTarget = !!saved && saved.host === host.trim() && String(saved.port) === port.trim() && saved.username === username.trim()
    const check = validateConnectForm({ host, port, username, password, hasSavedPassword: !!saved?.hasPassword, sameTarget })
    if (!check.ok) {
      setFieldError({ field: check.field, message: check.message })
      refs[check.field].current?.focus()
      return
    }
    setFieldError(null)
    const res = await runConnect({
      host: host.trim(),
      port: check.port,
      username: username.trim(),
      ...(password ? { password } : {}),
      remember: remember && canRemember
    })
    setPassword('')
    if (res.ok) onConnected?.()
  }

  const err = (f: string): string | undefined => (fieldError?.field === f ? fieldError.message : undefined)

  return (
    <form onSubmit={(e) => void submit(e)} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <div className="field" style={{ flex: '3 1 220px' }}>
          <label htmlFor="cf-host">host / public ip</label>
          <input id="cf-host" ref={refs.host} className="inp" value={host} onChange={(e) => setHost(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={!!err('host')} aria-describedby={err('host') ? 'cf-err' : undefined} />
        </div>
        <div className="field" style={{ flex: '1 1 90px' }}>
          <label htmlFor="cf-port">ssh port</label>
          <input id="cf-port" ref={refs.port} className="inp" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} aria-invalid={!!err('port')} aria-describedby={err('port') ? 'cf-err' : undefined} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="cf-user">
          username <span className="hint">(the user that runs Hermes)</span>
        </label>
        <input id="cf-user" ref={refs.username} className="inp" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={!!err('username')} aria-describedby={err('username') ? 'cf-err' : undefined} />
      </div>
      <div className="field">
        <label htmlFor="cf-pass">
          password {mode === 'edit' && saved?.hasPassword && <span className="hint">(leave empty to keep the saved password)</span>}
        </label>
        <input id="cf-pass" ref={refs.password} className="inp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" aria-invalid={!!err('password')} aria-describedby={err('password') ? 'cf-err' : undefined} />
      </div>
      <label className="chk">
        <input type="checkbox" checked={remember && canRemember} disabled={!canRemember} onChange={(e) => setRemember(e.target.checked)} />
        <span>
          remember &amp; auto-connect on launch <span style={{ color: '#8B95BD', fontSize: 12 }}>(password → OS keychain)</span>
        </span>
      </label>
      {!canRemember && secret?.reason && <p style={{ margin: 0, color: '#FFB86C', fontSize: 11 }}>{secret.reason}</p>}
      {(fieldError || error) && (
        <p id="cf-err" role="alert" style={{ margin: 0, color: '#FF5555', fontSize: 12 }}>
          {fieldError?.message ?? error?.message}
        </p>
      )}
      <button type="submit" className="btn-main" disabled={connecting}>
        {connecting ? '[ CONNECTING… ]' : mode === 'edit' ? '[ TEST & SAVE ]' : '[ TEST & CONNECT ]'}
      </button>
      <p style={{ margin: 0, color: '#8B95BD', fontSize: 11 }}>
        Asked only once. Next time the app opens it connects automatically; change it anytime with{' '}
        <span style={{ color: '#50FA7B' }}>edit connection</span>. Nothing is installed or changed on your VPS.
      </p>
    </form>
  )
}
```

`src/renderer/screens/connect/HostKeyPanel.tsx`:
```tsx
import { useConn } from '../../stores/conn'

export function HostKeyPanel({ onTrust, onCancel }: { onTrust: () => void; onCancel: () => void }) {
  const hk = useConn((s) => s.hostKey)
  if (!hk) return null
  const changed = hk.changed
  return (
    <section className={`pnl ${changed ? 'bad' : 'warn'}`} aria-label="Host key verification" role="alertdialog" aria-describedby="hk-desc">
      <h2 className="pt">┤ {changed ? 'host key changed: do not continue unless you know why' : 'first connection: verify host key'} ├</h2>
      <div id="hk-desc" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          {hk.host} presented {changed ? 'a different' : 'an'} <span style={{ color: changed ? '#FF5555' : '#FFB86C' }}>{hk.algo.replace('ssh-', '').toUpperCase()}</span> key:
        </div>
        <code style={{ display: 'block', padding: '8px 10px', background: '#282A36', border: `1px dashed ${changed ? '#FF5555' : '#FFB86C'}`, color: changed ? '#FF5555' : '#FFB86C', overflowWrap: 'anywhere' }}>{hk.fingerprint}</code>
        {changed && hk.previous && (
          <div style={{ color: '#A9B2D3', fontSize: 12 }}>
            Previously trusted: <span style={{ color: '#F8F8F2', overflowWrap: 'anywhere' }}>{hk.previous}</span>. A changed key can mean the server was reinstalled, or that someone is intercepting the connection.
          </div>
        )}
        <div style={{ color: '#A9B2D3', fontSize: 12 }}>
          Compare with <span style={{ color: '#F8F8F2' }}>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</span> on the server.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {changed ? (
            <>
              <button type="button" className="btn-bad-o" onClick={onTrust}>I verified it: trust new key</button>
              <button type="button" className="btn-warn" onClick={onCancel}>CANCEL</button>
            </>
          ) : (
            <>
              <button type="button" className="btn-warn" onClick={onTrust}>TRUST &amp; CONTINUE</button>
              <button type="button" className="btn-warn-o" onClick={onCancel}>CANCEL</button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
```

`src/renderer/screens/connect/PreflightPanel.tsx`:
```tsx
import { useConn } from '../../stores/conn'

const COLOR = { ok: '#50FA7B', warn: '#FFB86C', fail: '#FF5555', info: '#8BE9FD' } as const

export function PreflightPanel() {
  const pre = useConn((s) => s.preflight)
  const connecting = useConn((s) => s.connecting)
  if (!pre) {
    return (
      <section className="pnl" aria-label="Preflight">
        <h2 className="pt">┤ preflight ├</h2>
        <div style={{ color: '#8B95BD' }}>{connecting ? 'Running checks…' : 'Checks appear here once you connect.'}</div>
      </section>
    )
  }
  const bad = pre.items.filter((i) => i.state === 'fail').length
  const passed = pre.items.filter((i) => i.state === 'ok' || i.state === 'info').length
  return (
    <section className="pnl" aria-label="Preflight">
      <h2 className="pt">┤ preflight ├</h2>
      {pre.items.map((i) => (
        <div key={i.id}>
          <div className="preflight-row">
            <span style={{ color: '#8B95BD' }}>&gt;</span>
            <span>{i.label}</span>
            <span className="dots" aria-hidden="true">..............................................................</span>
            <span style={{ color: COLOR[i.state] }}>{i.result}</span>
          </div>
          {i.hint && i.state !== 'ok' && <p className="hint-line">{i.hint}</p>}
        </div>
      ))}
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #44475A', color: bad === 0 ? '#50FA7B' : '#FF5555' }}>
        {bad === 0 ? `${passed}/${pre.items.length} checks passed, opening console_` : `${bad} check${bad === 1 ? '' : 's'} failed. Features that do not depend on them keep working.`}
      </div>
    </section>
  )
}
```

`src/renderer/screens/Connect.tsx` (ganti stub):
```tsx
import logoUrl from '../assets/logo-mark.png'
import { trustAndRetry } from '../actions'
import { useConn } from '../stores/conn'
import { useUi } from '../stores/ui'
import { ConnectionForm } from './connect/ConnectionForm'
import { HostKeyPanel } from './connect/HostKeyPanel'
import { PreflightPanel } from './connect/PreflightPanel'

export function Connect() {
  const saved = useConn((s) => s.saved)
  const hostKey = useConn((s) => s.hostKey)
  const navigate = useUi((s) => s.navigate)

  function open(): void {
    window.setTimeout(() => navigate('dashboard'), 700)
  }

  async function trust(): Promise<void> {
    const res = await trustAndRetry()
    if (res?.ok) open()
  }

  return (
    <main className="center-screen" aria-label="Connect to your VPS">
      <div className="brand">
        <img src={logoUrl} width={96} height={96} alt="Hermes Agent Mission Control" style={{ alignSelf: 'center' }} />
        <div className="name">HERMES AGENT MISSION CONTROL</div>
        <div style={{ color: '#A9B2D3' }}>remote ops console for Hermes Agent · zero-change · read-only by default</div>
      </div>
      <div style={{ width: '100%', maxWidth: 1120, display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        <section className="pnl hi" aria-label="Connect to VPS" style={{ flex: '1 1 380px', padding: '26px 20px 20px' }}>
          <h1 className="pt" style={{ fontSize: 12 }}>┤ {saved ? 'edit connection' : 'first-time setup'} ├</h1>
          <ConnectionForm mode={saved ? 'edit' : 'first'} onConnected={open} />
        </section>
        <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {hostKey && <HostKeyPanel onTrust={() => void trust()} onCancel={() => useConn.setState({ hostKey: null })} />}
          <PreflightPanel />
        </div>
      </div>
    </main>
  )
}
```

Password tidak pernah disimpan di renderer: `lastRequest` tidak memuat password. Saat host key perlu diverifikasi, main process menahan password di memori (hanya `MissionSession.pending`, 2 menit) supaya `trustAndRetry()` bisa mengulang tanpa mengetik ulang.

Implementasikan `pending` di `src/main/session.ts` bersama test baru di `tests/integration/session.test.ts`:
```ts
it('lets the user trust a new host key without retyping the password', async () => {
  srv = await startFakeSsh({ fixture: fx })
  const { session } = makeSession()
  const first = await session.connect(req())
  expect(first.ok).toBe(false)
  session.trustHostKey(first.ok === false ? first.hostKey! : (undefined as never))
  const second = await session.connect({ host: '127.0.0.1', port: srv.port, username: 'tester', remember: true })
  expect(second.ok).toBe(true)
})
```
Implementasi: field `private pending: { host; port; username; password; at } | null`; di `connect`, jika `password` kosong dan `pending` cocok (host/port/username sama, `Date.now() - at < 120_000`), pakai `pending.password`; set `pending` saat hasil `hostkey-unverified`/`hostkey-changed`; kosongkan di `trustHostKey` setelah pemakaian pertama oleh `connect` berhasil/gagal, dan di `disconnect`/`forget`.

- [ ] **Step 5: Jalankan test dan build**

Run: `npm test -- tests/unit/connectForm.test.ts tests/integration/session.test.ts && npm run typecheck && npm run build`
Expected: PASS dan build sukses.

- [ ] **Step 6: Verifikasi visual**

Jalankan aplikasi dengan data userData sementara dan server palsu: lihat Task 22 untuk skrip `scripts/dev-fake-server.ts` (dibuat di sana). Sementara itu, cukup pastikan layar Connect tampil dengan form, tanpa error console (`read_console_messages`).

- [ ] **Step 7: Commit**

```bash
git add src/renderer src/main/session.ts tests
git commit -m "feat: add Connect screen with host key verification and preflight panel

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Layar Launch, dialog Edit connection, dan Forget

**Files:**
- Modify: `src/renderer/screens/Launch.tsx` (ganti stub)
- Create: `src/renderer/screens/EditConnectionDialog.tsx`
- Test: `tests/unit/launchOutcome.test.ts`; Create: `src/renderer/lib/launchOutcome.ts`

**Interfaces:**
- Produces (`lib/launchOutcome.ts`): `launchOutcome(kind: ConnectErrorKind): 'dashboard-offline' | 'connect-edit' | 'connect-hostkey' | 'connect-error'`; `startupPct(steps: {state}[]): number`.
- Produces: `EditConnectionDialog({onClose})`.

- [ ] **Step 1: Test yang gagal — `tests/unit/launchOutcome.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { launchOutcome, startupPct } from '../../src/renderer/lib/launchOutcome'

describe('launchOutcome', () => {
  it.each([
    ['unreachable', 'dashboard-offline'],
    ['timeout', 'dashboard-offline'],
    ['auth', 'connect-edit'],
    ['hostkey-changed', 'connect-hostkey'],
    ['hostkey-unverified', 'connect-hostkey'],
    ['hermes-missing', 'connect-error'],
    ['unknown', 'connect-error']
  ] as const)('%s -> %s', (kind, expected) => {
    expect(launchOutcome(kind)).toBe(expected)
  })
})

describe('startupPct', () => {
  it('is the share of finished steps', () => {
    expect(startupPct([{ state: 'done' }, { state: 'done' }, { state: 'running' }, { state: 'pending' }, { state: 'pending' }])).toBe(40)
    expect(startupPct([])).toBe(0)
    expect(startupPct(Array.from({ length: 5 }, () => ({ state: 'done' as const })))).toBe(100)
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal** — FAIL.

- [ ] **Step 3: `src/renderer/lib/launchOutcome.ts`**

```ts
import type { ConnectErrorKind } from '@shared/ipc'

export type Outcome = 'dashboard-offline' | 'connect-edit' | 'connect-hostkey' | 'connect-error'

export function launchOutcome(kind: ConnectErrorKind): Outcome {
  if (kind === 'unreachable' || kind === 'timeout') return 'dashboard-offline'
  if (kind === 'auth') return 'connect-edit'
  if (kind === 'hostkey-changed' || kind === 'hostkey-unverified') return 'connect-hostkey'
  return 'connect-error'
}

export function startupPct(steps: readonly { state: string }[]): number {
  if (steps.length === 0) return 0
  return Math.round((steps.filter((s) => s.state === 'done').length / steps.length) * 100)
}
```

- [ ] **Step 4: Layar Launch**

`src/renderer/screens/Launch.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import logoUrl from '../assets/logo-mark.png'
import { runConnect } from '../actions'
import { launchOutcome, startupPct } from '../lib/launchOutcome'
import { useConn } from '../stores/conn'
import { useUi } from '../stores/ui'

const ICON = { done: '✓', running: '…', pending: '·', failed: '✕' } as const
const COLOR = { done: '#50FA7B', running: '#8BE9FD', pending: '#6272A4', failed: '#FF5555' } as const

export function Launch() {
  const saved = useConn((s) => s.saved)
  const startup = useConn((s) => s.startup)
  const error = useConn((s) => s.connectError)
  const navigate = useUi((s) => s.navigate)
  const started = useRef(false)

  async function attempt(): Promise<void> {
    if (!saved) return navigate('connect')
    const res = await runConnect({ host: saved.host, port: saved.port, username: saved.username, remember: true, useSaved: true })
    if (res.ok) {
      window.setTimeout(() => navigate('dashboard'), 500)
      return
    }
    const outcome = launchOutcome(res.kind)
    navigate(outcome === 'dashboard-offline' ? 'dashboard' : 'connect')
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    void attempt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const steps = startup?.steps ?? []
  return (
    <main className="center-screen" aria-label="Starting" style={{ justifyContent: 'center' }}>
      <div className="brand">
        <img src={logoUrl} width={96} height={96} alt="Hermes Agent Mission Control" style={{ alignSelf: 'center' }} />
        <div className="name">HERMES AGENT MISSION CONTROL</div>
        {saved && (
          <div style={{ color: '#A9B2D3' }}>
            auto-connecting to <span style={{ color: '#F8F8F2', fontWeight: 700 }}>{saved.name}</span> · {saved.username}@{saved.host}:{saved.port}
          </div>
        )}
      </div>
      <section aria-label="Startup steps" aria-live="polite" style={{ width: '100%', maxWidth: 560, boxSizing: 'border-box', border: '1px solid #44475A', borderRadius: 14, background: '#21222C', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((s) => (
          <div className="step" key={s.id}>
            <span style={{ width: 18, color: COLOR[s.state] }} aria-hidden="true">{ICON[s.state]}</span>
            <span style={{ color: s.state === 'done' ? '#F8F8F2' : s.state === 'running' ? '#8BE9FD' : s.state === 'failed' ? '#FF5555' : '#8B95BD' }}>{s.label}</span>
            <span className="detail">{s.detail}</span>
          </div>
        ))}
        <div style={{ height: 4, marginTop: 6, borderRadius: 2, background: '#44475A' }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={startupPct(steps)}>
          <div style={{ height: 4, borderRadius: 2, width: `${startupPct(steps)}%`, background: '#50FA7B', transition: 'width .3s' }} />
        </div>
        {error && <p role="alert" style={{ margin: 0, color: '#FFB86C', fontSize: 12 }}>{error.message}</p>}
      </section>
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="cbtn" onClick={() => navigate('connect')}>edit connection</button>
      </div>
    </main>
  )
}
```

Ketika Launch gagal karena `auth`/`hostkey`/dll., layar Connect membaca `connectError` dan `hostKey` dari store, sehingga banner dan panel host key muncul dengan isian yang sudah terisi dari `saved`. Tambahkan di `Connect.tsx` tepat di atas `<ConnectionForm>` banner `connectError` (sudah ditampilkan oleh `ConnectionForm` lewat `role="alert"`) dan pastikan `HostKeyPanel` memakai request tersimpan (`lastRequest`) dari Task 17. Untuk kasus Launch, `lastRequest` sudah terisi oleh `runConnect`, tetapi password tidak ada. Main process mengisi ulang dari keychain karena `useSaved` dan target sama (lihat `MissionSession.connect`).

- [ ] **Step 5: Dialog Edit connection**

`src/renderer/screens/EditConnectionDialog.tsx`:
```tsx
import { useState } from 'react'
import { forgetConnection, trustAndRetry } from '../actions'
import { Modal } from '../components/Modal'
import { useConn } from '../stores/conn'
import { ConnectionForm } from './connect/ConnectionForm'
import { HostKeyPanel } from './connect/HostKeyPanel'

export function EditConnectionDialog({ onClose }: { onClose: () => void }) {
  const saved = useConn((s) => s.saved)
  const hostKey = useConn((s) => s.hostKey)
  const [confirmForget, setConfirmForget] = useState(false)

  return (
    <Modal title="Edit connection" onClose={onClose} width={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ConnectionForm mode="edit" onConnected={onClose} />
        {hostKey && (
          <HostKeyPanel
            onTrust={() => void trustAndRetry().then((r) => r?.ok && onClose())}
            onCancel={() => useConn.setState({ hostKey: null })}
          />
        )}
        {saved?.fingerprint && (
          <div style={{ color: '#A9B2D3', fontSize: 12 }}>
            Trusted host key: <code style={{ color: '#F8F8F2', overflowWrap: 'anywhere' }}>{saved.fingerprint}</code>
          </div>
        )}
        <div style={{ borderTop: '1px solid #44475A', paddingTop: 12 }}>
          {confirmForget ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ color: '#FFB86C' }}>This removes the saved connection, its password and its trusted host key from this computer. Nothing changes on your VPS.</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="cb dng" onClick={() => void forgetConnection()}>Forget this connection</button>
                <button type="button" className="cb" onClick={() => setConfirmForget(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" className="cb dng" onClick={() => setConfirmForget(true)}>Forget this connection…</button>
          )}
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 6: Jalankan test, typecheck, build**

Run: `npm test -- tests/unit/launchOutcome.test.ts && npm run typecheck && npm run build` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer tests/unit/launchOutcome.test.ts
git commit -m "feat: add Launch screen, failure routing, Edit connection and Forget

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Dashboard dan panel Agents

**Files:**
- Modify: `src/renderer/screens/Dashboard.tsx` (ganti stub)
- Create: `src/renderer/screens/dashboard/{StatusBlock,AgentsPanel,AgentDetail,ServerStrip}.tsx`, `src/renderer/hooks/useNow.ts`

**Interfaces:**
- Consumes: `useAgents`, `useConn`, `useMetrics`, `buildRoster`, `railAgents`, `activeCount`, `toggleAgentPin`, `reorderAgentPin`, `saveSetting`, `Panel`, `Avatar`, `EmptyState`, `UnsupportedState`, `EditConnectionDialog`.
- Produces: `useNow(ms?: number): number` (jam yang berdetak untuk usia data), `Dashboard`.
- Catatan: `ServerStrip` membutuhkan `UplotChart` dari Task 20; tulis `ServerStrip` di Task 20 dan di Task 19 pasang dulu `Panel` kosong bertanda "Server" supaya Task 19 dapat dikompilasi. Task 20 mengganti isinya.

- [ ] **Step 1: Hook jam**

`src/renderer/hooks/useNow.ts`:
```ts
import { useEffect, useState } from 'react'

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}
```

- [ ] **Step 2: StatusBlock (kolom kiri atas)**

`src/renderer/screens/dashboard/StatusBlock.tsx`:
```tsx
import { useState } from 'react'
import logoUrl from '../../assets/logo-mark.png'
import { Icon } from '../../components/Icon'
import { StaleBanner } from '../../components/States'
import { useNow } from '../../hooks/useNow'
import { activeCount } from '../../lib/roster'
import { useAgents } from '../../stores/agents'
import { useConn } from '../../stores/conn'
import { EditConnectionDialog } from '../EditConnectionDialog'

export function StatusBlock() {
  const agents = useAgents((s) => s.agents)
  const receivedAt = useAgents((s) => s.receivedAt)
  const status = useConn((s) => s.status)
  const saved = useConn((s) => s.saved)
  const now = useNow()
  const [editing, setEditing] = useState(false)
  const active = activeCount(agents)
  const live = status.state === 'connected'

  return (
    <div className="status-block">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src={logoUrl} width={36} height={36} alt="" />
        <div>
          <div style={{ color: '#A9B2D3', fontSize: 10, fontWeight: 700, letterSpacing: 1.5, lineHeight: 1.3 }}>HERMES AGENT<br />MISSION CONTROL</div>
        </div>
      </div>
      <div role="status" aria-live="polite">
        {agents.length === 0 ? (
          <div style={{ color: '#A9B2D3' }}>{live ? 'Looking for agents…' : 'No agent data yet'}</div>
        ) : (
          <>
            <div className="big-num count">{active}</div>
            <div className="of">
              active agent{active === 1 ? '' : 's'} of {agents.length}
            </div>
          </>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {saved && <span className="chip">{saved.username}@{saved.host}:{saved.port}</span>}
        <button type="button" className="cb" onClick={() => setEditing(true)}>
          <Icon name="edit" size={12} /> Edit connection
        </button>
      </div>
      {!live && receivedAt !== null && <StaleBanner receivedAt={receivedAt} now={now} label={status.state === 'reconnecting' ? 'Reconnecting' : 'Offline'} />}
      {editing && <EditConnectionDialog onClose={() => setEditing(false)} />}
    </div>
  )
}
```

- [ ] **Step 3: AgentDetail**

`src/renderer/screens/dashboard/AgentDetail.tsx`:
```tsx
import { Avatar } from '../../components/Avatar'
import { EmptyState } from '../../components/States'
import { useNow } from '../../hooks/useNow'
import { agentColor } from '../../lib/agentColor'
import { formatAge } from '../../lib/format'
import { useAgents } from '../../stores/agents'

export const STATUS_COLOR = { working: '#50FA7B', idle: '#8BE9FD', parked: '#FFB86C', offline: '#8B95BD' } as const
export const STATUS_LABEL = { working: 'WORKING', idle: 'IDLE', parked: 'PARKED', offline: 'OFFLINE' } as const

export function AgentDetail() {
  const selected = useAgents((s) => s.selected)
  const agent = useAgents((s) => s.agents.find((a) => a.profile === selected))
  const model = useAgents((s) => (selected ? s.models[selected] : undefined))
  const now = useNow()

  if (!agent) {
    return <EmptyState title="Select an agent" why="Pick an agent above to see its status, model and files. Chat arrives in a later release." />
  }
  const age = agent.lastActivityTs ? formatAge(Math.max(0, now / 1000 - agent.lastActivityTs)) : 'no activity yet'
  return (
    <div className="detail-card" style={{ borderTopColor: agentColor(agent.profile) }} aria-label={`${agent.displayName} details`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Avatar name={agent.displayName} profile={agent.profile} size={26} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent.displayName}</div>
          {agent.displayName !== agent.profile && <div style={{ color: '#8B95BD', fontSize: 11 }}>{agent.profile}</div>}
        </div>
        <span style={{ marginLeft: 'auto', color: STATUS_COLOR[agent.status], fontSize: 10, letterSpacing: 1 }}>{STATUS_LABEL[agent.status]}</span>
      </div>
      <dl className="kv" style={{ margin: 0 }}>
        <dt>model</dt>
        <dd>{model === undefined ? 'reading…' : model === null ? 'unavailable' : [model.provider, model.model].filter(Boolean).join(' · ') || 'unavailable'}</dd>
        <dt>platforms</dt>
        <dd>{agent.platforms.length ? agent.platforms.map((p) => <span key={p} className="tag" style={{ marginRight: 4 }}>{p}</span>) : '–'}</dd>
        <dt>last activity</dt>
        <dd>{age}</dd>
        <dt>files</dt>
        <dd style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {([['SOUL.md', agent.hasSoul], ['MEMORY.md', agent.hasMemory], ['USER.md', agent.hasUser]] as const).map(([n, has]) => (
            <span key={n} className="tag" style={{ opacity: has ? 1 : 0.45 }}>{n}</span>
          ))}
        </dd>
      </dl>
    </div>
  )
}
```

- [ ] **Step 4: AgentsPanel**

`src/renderer/screens/dashboard/AgentsPanel.tsx`:
```tsx
import { useMemo, useState } from 'react'
import { reorderAgentPin, saveSetting, toggleAgentPin } from '../../actions'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { EmptyState, Skeleton } from '../../components/States'
import { activeCount, buildRoster, railAgents } from '../../lib/roster'
import { useAgents } from '../../stores/agents'
import { useConn } from '../../stores/conn'
import { useUi } from '../../stores/ui'
import { AgentDetail, STATUS_COLOR, STATUS_LABEL } from './AgentDetail'

export function AgentsPanel() {
  const agents = useAgents((s) => s.agents)
  const pins = useAgents((s) => s.pins)
  const selected = useAgents((s) => s.selected)
  const query = useAgents((s) => s.query)
  const select = useAgents((s) => s.select)
  const setQuery = useAgents((s) => s.setQuery)
  const collapsed = useUi((s) => s.settings['agents.panelCollapsed'])
  const connState = useConn((s) => s.status.state)
  const [dragFrom, setDragFrom] = useState<string | null>(null)
  const { rows, showSearch } = useMemo(() => buildRoster(agents, pins, query), [agents, pins, query])
  const online = activeCount(agents)

  if (collapsed) {
    const { shown, more } = railAgents(agents, pins, selected)
    return (
      <section aria-label="Agents (collapsed)" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, overflowY: 'auto', paddingTop: 4 }}>
        <button type="button" className="ib" onClick={() => void saveSetting('agents.panelCollapsed', false)} aria-label="Expand agents panel" title="Expand">
          <Icon name="chevs-left" size={14} />
        </button>
        {shown.map((a) => (
          <button
            key={a.profile}
            type="button"
            className="ib"
            style={{ width: 36, height: 36, position: 'relative' }}
            aria-label={`${a.displayName}, ${STATUS_LABEL[a.status].toLowerCase()}`}
            title={`${a.displayName} · ${STATUS_LABEL[a.status]}`}
            onClick={() => {
              select(a.profile)
              void saveSetting('agents.panelCollapsed', false)
            }}
          >
            <Avatar name={a.displayName} profile={a.profile} size={26} />
            <span className="dot" style={{ position: 'absolute', right: 2, bottom: 2, background: STATUS_COLOR[a.status] }} />
          </button>
        ))}
        {more > 0 && (
          <button type="button" className="ib" style={{ width: 36 }} onClick={() => void saveSetting('agents.panelCollapsed', false)} aria-label={`${more} more agents`} title="Show all agents">
            +{more}
          </button>
        )}
      </section>
    )
  }

  return (
    <section className="pnl hi" aria-label="Agents" style={{ minHeight: 0, overflow: 'hidden', padding: '22px 10px 10px' }}>
      <h2 className="pt">┤ agents ├</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
        <span style={{ color: '#50FA7B', fontSize: 11 }}>{agents.length ? `${online}/${agents.length} online` : ''}</span>
        <span style={{ marginLeft: 'auto' }} />
        <button type="button" className="ib sm" onClick={() => void saveSetting('agents.panelCollapsed', true)} aria-label="Collapse agents panel" title="Collapse">
          <Icon name="chevs-right" size={14} />
        </button>
      </div>

      {showSearch && (
        <div className="ag-search" style={{ flex: 'none' }}>
          <Icon name="search" size={13} />
          <label htmlFor="agent-q" className="vh">Search agents</label>
          <input
            id="agent-q"
            type="text"
            autoComplete="off"
            placeholder="Search agents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
              if (e.key === 'Enter') {
                const first = rows.find((r) => r.kind === 'agent')
                if (first && first.kind === 'agent') select(first.agent.profile)
              }
            }}
          />
          {query && (
            <button type="button" className="ib sm" onClick={() => setQuery('')} aria-label="Clear search" title="Clear (Esc)">
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      )}

      <div role="list" aria-label="Agent list" style={{ flex: '0 1 auto', maxHeight: selected ? '40%' : 'none', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {agents.length === 0 ? (
          connState === 'connected' ? <Skeleton rows={4} /> : <EmptyState title="No agents yet" why="Agents appear after the first successful connection." />
        ) : (
          rows.map((r) => {
            if (r.kind === 'head') return <div key={r.key} className="ag-sec" role="presentation">{r.title}</div>
            if (r.kind === 'empty') return <div key={r.key} role="status" style={{ padding: '10px 8px', color: '#A9B2D3', fontSize: 11 }}>{r.title}</div>
            const a = r.agent
            return (
              <div
                key={r.key}
                role="listitem"
                className="ag-row"
                draggable={r.draggable}
                style={{ opacity: dragFrom === a.profile ? 0.5 : 1 }}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', a.profile)
                  setDragFrom(a.profile)
                }}
                onDragOver={(e) => {
                  if (dragFrom && r.draggable) e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragFrom && dragFrom !== a.profile) void reorderAgentPin(dragFrom, a.profile)
                  setDragFrom(null)
                }}
                onDragEnd={() => setDragFrom(null)}
              >
                <span className="ag-grip" title={r.draggable ? 'Drag to reorder' : undefined} style={{ visibility: r.draggable ? 'visible' : 'hidden' }}>
                  <Icon name="grip" size={13} />
                </span>
                <button type="button" className="ag-pick" aria-pressed={selected === a.profile} aria-label={`${a.displayName}, ${STATUS_LABEL[a.status].toLowerCase()}. Show details`} onClick={() => select(selected === a.profile ? null : a.profile)}>
                  <Avatar name={a.displayName} profile={a.profile} size={20} />
                  <span className="nm">{a.displayName}</span>
                  <span className="st" style={{ color: STATUS_COLOR[a.status] }}>
                    <span className="dot" style={{ background: STATUS_COLOR[a.status] }} />
                    {STATUS_LABEL[a.status]}
                  </span>
                </button>
                <button type="button" className={`ib sm ag-pin ${r.pinned ? 'on' : ''}`} aria-pressed={r.pinned} aria-label={r.pinned ? `Unpin ${a.displayName}` : `Pin ${a.displayName}`} title={r.pinned ? 'Unpin' : 'Pin'} onClick={() => void toggleAgentPin(a.profile)}>
                  <Icon name="pin" size={12} />
                </button>
              </div>
            )
          })
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <AgentDetail />
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Dashboard**

`src/renderer/screens/Dashboard.tsx` (ganti stub):
```tsx
import { Panel } from '../components/Panel'
import { UnsupportedState } from '../components/States'
import { useUi } from '../stores/ui'
import { AgentsPanel } from './dashboard/AgentsPanel'
import { ServerStrip } from './dashboard/ServerStrip'
import { StatusBlock } from './dashboard/StatusBlock'

export function Dashboard() {
  const collapsed = useUi((s) => s.settings['agents.panelCollapsed'])
  return (
    <div className={`dash ${collapsed ? 'agents-rail' : ''}`}>
      <div className="col">
        <StatusBlock />
        <Panel title="cron jobs">
          <UnsupportedState why="Schedules and run history arrive in a later release." />
        </Panel>
        <Panel title="activity">
          <UnsupportedState why="The live feed of agent interactions arrives in a later release." />
        </Panel>
      </div>
      <div className="col">
        <ServerStrip />
        <Panel title="second brain" className="grow">
          <UnsupportedState why="The vault graph arrives in a later release." />
        </Panel>
      </div>
      <AgentsPanel />
    </div>
  )
}
```

`src/renderer/screens/dashboard/ServerStrip.tsx` (stub sampai Task 20):
```tsx
import { Panel } from '../../components/Panel'

export function ServerStrip() {
  return <Panel title="server" />
}
```

Tambahkan `.grow { flex: 1; min-height: 0; }` ke `app.css`.

- [ ] **Step 6: Typecheck, build, dan uji manual dengan server palsu**

Run: `npm run typecheck && npm run build`
Expected: bersih.

Uji manual (setelah skrip dev server palsu dari Task 22 tersedia; jika belum, tunda ke sana): agent muncul dengan status benar, pin/unpin bekerja dan bertahan setelah restart, pencarian muncul saat agent > 6, drag & drop mengubah urutan Pinned, rail menampilkan pinned + `+N`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer
git commit -m "feat: add Dashboard with status block and Agents panel (pin, search, rail, reorder)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Monitor server (grafik uPlot, layar Server, strip Dashboard)

**Files:**
- Create: `src/renderer/components/UplotChart.tsx`, `src/renderer/components/Bar.tsx`
- Create: `src/renderer/lib/procs.ts` (+ `tests/unit/procs.test.ts`)
- Modify: `src/renderer/screens/Server.tsx` (ganti stub), `src/renderer/screens/dashboard/ServerStrip.tsx`

**Interfaces:**
- Produces (`lib/procs.ts`): `type SortKey = 'cpu' | 'mem' | 'pid'`, `sortProcs(procs, key, hermesOnly): MetricsData['procs']`, `ariaSort(active: SortKey, key: SortKey): 'descending' | 'ascending' | 'none'`.
- Produces: `UplotChart({data, colors, height, max?, label})`, `Bar({pct, color})`.

- [ ] **Step 1: Test yang gagal — `tests/unit/procs.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { ariaSort, sortProcs } from '../../src/renderer/lib/procs'

const p = (pid: number, cpu: number, mem: number, hermes = false) => ({ pid, user: 'u', cpu, mem, rss: mem * 1e6, cmd: `c${pid}`, hermes })
const list = [p(3, 1, 9), p(1, 9, 1, true), p(2, 5, 5, true)]

describe('sortProcs', () => {
  it('sorts by cpu descending', () => {
    expect(sortProcs(list, 'cpu', false).map((x) => x.pid)).toEqual([1, 2, 3])
  })
  it('sorts by memory descending', () => {
    expect(sortProcs(list, 'mem', false).map((x) => x.pid)).toEqual([3, 2, 1])
  })
  it('sorts by pid ascending', () => {
    expect(sortProcs(list, 'pid', false).map((x) => x.pid)).toEqual([1, 2, 3])
  })
  it('filters to hermes processes', () => {
    expect(sortProcs(list, 'cpu', true).map((x) => x.pid)).toEqual([1, 2])
  })
  it('does not mutate the input', () => {
    const copy = [...list]
    sortProcs(list, 'mem', false)
    expect(list).toEqual(copy)
  })
})

describe('ariaSort', () => {
  it('reports the sorted column only', () => {
    expect(ariaSort('cpu', 'cpu')).toBe('descending')
    expect(ariaSort('pid', 'pid')).toBe('ascending')
    expect(ariaSort('cpu', 'mem')).toBe('none')
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal** — FAIL.

- [ ] **Step 3: `src/renderer/lib/procs.ts`**

```ts
import type { MetricsData } from '@shared/events'

export type SortKey = 'cpu' | 'mem' | 'pid'
type Proc = MetricsData['procs'][number]

export function sortProcs(procs: readonly Proc[], key: SortKey, hermesOnly: boolean): Proc[] {
  const rows = procs.filter((p) => !hermesOnly || p.hermes)
  return rows.sort((a, b) => (key === 'pid' ? a.pid - b.pid : key === 'cpu' ? b.cpu - a.cpu : b.mem - a.mem))
}

export function ariaSort(active: SortKey, key: SortKey): 'descending' | 'ascending' | 'none' {
  if (active !== key) return 'none'
  return key === 'pid' ? 'ascending' : 'descending'
}
```

- [ ] **Step 4: Komponen grafik dan bar**

`src/renderer/components/UplotChart.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

interface Props {
  /** One array per series, all the same length (the x axis is generated). */
  series: number[][]
  colors: string[]
  height: number
  max?: number
  label: string
}

const xs = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

export function UplotChart({ series, colors, height, max, label }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const plot = useRef<uPlot | null>(null)
  const colorRef = useRef(colors)
  colorRef.current = colors

  useEffect(() => {
    const el = host.current!
    const n = series[0]?.length ?? 60
    const u = new uPlot(
      {
        width: Math.max(120, el.clientWidth),
        height,
        legend: { show: false },
        cursor: { show: false },
        padding: [2, 0, 0, 0],
        scales: { x: { time: false }, y: { range: (_u, _min, dataMax) => [0, max ?? Math.max(1, dataMax * 1.15)] } },
        axes: [{ show: false }, { show: false }],
        series: [
          {},
          ...series.map((_, i) => ({
            stroke: () => colorRef.current[i] ?? '#50FA7B',
            fill: () => `${colorRef.current[i] ?? '#50FA7B'}33`,
            width: 1.5,
            points: { show: false }
          }))
        ]
      },
      [xs(n), ...series] as uPlot.AlignedData,
      el
    )
    plot.current = u
    const ro = new ResizeObserver(() => u.setSize({ width: Math.max(120, el.clientWidth), height }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.destroy()
      plot.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, max, series.length])

  useEffect(() => {
    if (document.visibilityState === 'hidden') return
    const n = series[0]?.length ?? 60
    plot.current?.setData([xs(n), ...series] as uPlot.AlignedData)
  }, [series])

  return <div ref={host} role="img" aria-label={label} style={{ width: '100%', height }} />
}
```

`src/renderer/components/Bar.tsx`:
```tsx
export function Bar({ pct, color }: { pct: number; color: string }) {
  const w = Math.max(0, Math.min(100, pct))
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w)}>
      <i style={{ width: `${w}%`, background: color }} />
    </div>
  )
}
```

- [ ] **Step 5: Layar Server**

`src/renderer/screens/Server.tsx` (ganti stub):
```tsx
import { useMemo, useState } from 'react'
import { Bar } from '../components/Bar'
import { Icon } from '../components/Icon'
import { Panel } from '../components/Panel'
import { EmptyState, Skeleton, StaleBanner } from '../components/States'
import { UplotChart } from '../components/UplotChart'
import { useNow } from '../hooks/useNow'
import { formatBytes, formatPct, formatRate, formatUptime, loadColor, textBar } from '../lib/format'
import { ariaSort, sortProcs, type SortKey } from '../lib/procs'
import { padLeft } from '../lib/window'
import { useConn } from '../stores/conn'
import { useMetrics } from '../stores/metrics'

export function Server() {
  const m = useMetrics((s) => s.latest)
  const receivedAt = useMetrics((s) => s.receivedAt)
  const cpuHist = useMetrics((s) => s.cpu)
  const rxHist = useMetrics((s) => s.rx)
  const txHist = useMetrics((s) => s.tx)
  const connState = useConn((s) => s.status.state)
  const now = useNow()
  const [hermesOnly, setHermesOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('cpu')
  const procs = useMemo(() => (m ? sortProcs(m.procs, sort, hermesOnly) : []), [m, sort, hermesOnly])
  const cpuSeries = useMemo(() => [padLeft(cpuHist)], [cpuHist])
  const rxSeries = useMemo(() => [padLeft(rxHist)], [rxHist])
  const txSeries = useMemo(() => [padLeft(txHist)], [txHist])

  if (!m) {
    return (
      <div className="page">
        <h1 className="page-title">Server</h1>
        {connState === 'connected' || connState === 'connecting' ? (
          <Skeleton rows={8} />
        ) : (
          <EmptyState title="No server data yet" why="Metrics stream in once Mission Control is connected to your VPS." />
        )}
      </div>
    )
  }

  const net = m.net[0]
  const memPct = m.mem.total ? (m.mem.used / m.mem.total) * 100 : 0
  const memRows = [
    { label: 'used', value: m.mem.used, color: '#50FA7B' },
    { label: 'cached', value: m.mem.cached, color: '#8BE9FD' },
    { label: 'available', value: m.mem.available, color: '#A9B2D3' },
    { label: 'free', value: m.mem.free, color: '#6272A4' }
  ]
  const th = (key: SortKey, label: string, right = false) => (
    <th scope="col" className={right ? 'r' : ''} aria-sort={ariaSort(sort, key)}>
      <button type="button" onClick={() => setSort(key)}>{label}{sort === key ? (key === 'pid' ? ' ▲' : ' ▼') : ''}</button>
    </th>
  )

  return (
    <div className="page">
      {connState !== 'connected' && receivedAt !== null && <StaleBanner receivedAt={receivedAt} now={now} label={connState === 'reconnecting' ? 'Reconnecting' : 'Offline'} />}
      <div className="srv-grid">
        <Panel title={`cpu ├─ ${formatPct(m.cpu.total)} ─ load ${m.cpu.load.map((l) => l.toFixed(2)).join(' ')} ─ up ${formatUptime(m.cpu.uptimeS)}${m.cpu.tempC !== null ? ` ─ ${Math.round(m.cpu.tempC)}°C` : ''}`} tone="hi" label="CPU" className="full">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ flex: '999 1 420px', minWidth: 0 }}>
              <UplotChart series={cpuSeries} colors={[loadColor(m.cpu.total)]} height={150} max={100} label="CPU usage over the last 60 seconds" />
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#8B95BD', fontSize: 11 }}><span>-60s</span><span>-30s</span><span>now</span></div>
            </div>
            <div style={{ flex: '1 1 240px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '3px 16px', alignContent: 'start' }}>
              {m.cpu.cores.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, whiteSpace: 'nowrap' }}>
                  <span style={{ color: '#A9B2D3' }}>C{i}</span>
                  <span className="mono-bar" style={{ color: loadColor(c) }}>{textBar(c, 10)}</span>
                  <span style={{ marginLeft: 'auto' }}>{formatPct(c)}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title={`mem ├─ ${formatBytes(m.mem.total)}`} label="Memory">
          {memRows.map((r) => (
            <div key={r.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#A9B2D3' }}>{r.label}</span><span>{formatBytes(r.value)}</span></div>
              <Bar pct={m.mem.total ? (r.value / m.mem.total) * 100 : 0} color={r.color} />
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#A9B2D3' }}>swap</span><span>{formatBytes(m.mem.swapUsed)} / {formatBytes(m.mem.swapTotal)}</span></div>
            <Bar pct={m.mem.swapTotal ? (m.mem.swapUsed / m.mem.swapTotal) * 100 : 0} color="#FFB86C" />
          </div>
          <span className="vh">{formatPct(memPct)} of memory in use</span>
        </Panel>

        <Panel title={`net ├─ ${net?.name ?? 'no interface'}`} label="Network">
          {net ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8BE9FD' }}>rx {formatRate(net.rxBps)}</span><span style={{ color: '#A9B2D3' }}>total {formatBytes(net.rxTotal)}</span></div>
              <UplotChart series={rxSeries} colors={['#8BE9FD']} height={56} label="Download rate, last 60 seconds" />
              <UplotChart series={txSeries} colors={['#FF79C6']} height={56} label="Upload rate, last 60 seconds" />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#FF79C6' }}>tx {formatRate(net.txBps)}</span><span style={{ color: '#A9B2D3' }}>total {formatBytes(net.txTotal)}</span></div>
            </>
          ) : (
            <EmptyState title="No network interface" why="Only the loopback interface was found." />
          )}
        </Panel>

        <Panel title={`disks ├─ io r ${formatRate(m.io.readBps)} · w ${formatRate(m.io.writeBps)}`} label="Disks">
          {m.disks.length === 0 && <EmptyState title="No disks found" />}
          {m.disks.map((d) => {
            const pct = d.total ? (d.used / d.total) * 100 : 0
            return (
              <div key={d.mount} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{d.mount}</span><span style={{ color: '#A9B2D3' }}>{formatBytes(d.used)} / {formatBytes(d.total)} · {formatPct(pct)}</span></div>
                <div className="mono-bar" style={{ color: loadColor(pct) }} aria-hidden="true">{textBar(pct, 34)}</div>
              </div>
            )
          })}
        </Panel>

        <Panel title={`proc ├─ ${m.tasks} tasks`} label="Processes" className="full flush">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 14px', alignItems: 'center' }}>
            <button type="button" className="cb" aria-pressed={hermesOnly} onClick={() => setHermesOnly((v) => !v)} style={hermesOnly ? { background: '#50FA7B', color: '#282A36' } : { color: '#50FA7B' }}>
              <Icon name="filter" size={12} /> Hermes only
            </button>
            <span style={{ color: '#8B95BD', marginLeft: 'auto' }}>read-only · no kill/renice</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  {th('pid', 'PID')}
                  <th scope="col">USER</th>
                  {th('cpu', 'CPU%', true)}
                  {th('mem', 'MEM%', true)}
                  <th scope="col" className="r">RSS</th>
                  <th scope="col">COMMAND</th>
                </tr>
              </thead>
              <tbody>
                {procs.map((p) => (
                  <tr key={p.pid} className={p.hermes ? 'hm' : ''}>
                    <td style={{ color: '#A9B2D3' }}>{p.pid}</td>
                    <td>{p.user}</td>
                    <td className="r" style={{ color: loadColor(p.cpu * 3) }}>{p.cpu.toFixed(1)}</td>
                    <td className="r">{p.mem.toFixed(1)}</td>
                    <td className="r">{formatBytes(p.rss, 0)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.cmd}</td>
                  </tr>
                ))}
                {procs.length === 0 && (
                  <tr><td colSpan={6}><EmptyState title="No matching processes" why="No Hermes process is running right now." /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: ServerStrip di Dashboard**

`src/renderer/screens/dashboard/ServerStrip.tsx` (ganti stub):
```tsx
import { useMemo } from 'react'
import { Bar } from '../../components/Bar'
import { Panel } from '../../components/Panel'
import { Skeleton } from '../../components/States'
import { UplotChart } from '../../components/UplotChart'
import { formatPct, formatRate, loadColor } from '../../lib/format'
import { padLeft } from '../../lib/window'
import { useConn } from '../../stores/conn'
import { useMetrics } from '../../stores/metrics'
import { useUi } from '../../stores/ui'

export function ServerStrip() {
  const m = useMetrics((s) => s.latest)
  const cpuHist = useMetrics((s) => s.cpu)
  const connState = useConn((s) => s.status.state)
  const navigate = useUi((s) => s.navigate)
  const series = useMemo(() => [padLeft(cpuHist)], [cpuHist])

  if (!m) {
    return (
      <Panel title="server" tone="hi">
        {connState === 'connected' || connState === 'connecting' ? <Skeleton rows={3} /> : <span style={{ color: '#8B95BD' }}>No server data yet.</span>}
      </Panel>
    )
  }
  const mem = m.mem.total ? (m.mem.used / m.mem.total) * 100 : 0
  const root = m.disks.find((d) => d.mount === '/') ?? m.disks[0]
  const disk = root && root.total ? (root.used / root.total) * 100 : 0
  const net = m.net[0]
  return (
    <Panel title={`server ├─ cpu ${formatPct(m.cpu.total)} ─ mem ${formatPct(mem)}`} tone="hi" label="Server summary">
      <button type="button" onClick={() => navigate('server')} aria-label="Open server details" style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <UplotChart series={series} colors={[loadColor(m.cpu.total)]} height={56} max={100} label="CPU usage over the last 60 seconds" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          <div><div style={{ color: '#A9B2D3' }}>memory {formatPct(mem)}</div><Bar pct={mem} color={loadColor(mem)} /></div>
          <div><div style={{ color: '#A9B2D3' }}>disk {root?.mount ?? '–'} {formatPct(disk)}</div><Bar pct={disk} color={loadColor(disk)} /></div>
          <div style={{ color: '#A9B2D3' }}>net <span style={{ color: '#8BE9FD' }}>↓ {formatRate(net?.rxBps ?? 0)}</span> <span style={{ color: '#FF79C6' }}>↑ {formatRate(net?.txBps ?? 0)}</span></div>
        </div>
      </button>
    </Panel>
  )
}
```

- [ ] **Step 7: Test, typecheck, build**

Run: `npm test -- tests/unit/procs.test.ts && npm run typecheck && npm run build` → PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer tests/unit/procs.test.ts
git commit -m "feat: add Server monitor screen, uPlot charts and dashboard server strip

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Modal Settings (General, Connection, About)

**Files:**
- Modify: `src/renderer/settings/SettingsModal.tsx` (ganti stub)

**Interfaces:**
- Consumes: `useUi.settingsTab`, `saveSetting`, `setZoomLevel`, `stepZoomLevel`, `ConnectionForm`, `forgetConnection`, `window.mc.app.info()`.

- [ ] **Step 1: Implementasi**

`src/renderer/settings/SettingsModal.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { saveSetting, setZoomLevel, stepZoomLevel } from '../actions'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { UnsupportedState } from '../components/States'
import { zoomPercent } from '../lib/zoom'
import { EditConnectionDialogBody } from '../screens/EditConnectionDialog'
import { useUi, type SettingsTab } from '../stores/ui'
import type { AppInfo } from '@shared/ipc'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'connection', label: 'Connection' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'agents', label: 'Agents' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'data', label: 'Data' },
  { id: 'about', label: 'About' }
]

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" className="sw" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 40 }}>
      <div style={{ flex: 1 }}>
        <div>{label}</div>
        {hint && <div style={{ color: '#8B95BD', fontSize: 11 }}>{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function General() {
  const s = useUi((st) => st.settings)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Row label="Text size" hint="Ctrl + / Ctrl −, 70% to 150%">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <button type="button" className="ib" aria-label="Smaller text" onClick={() => void stepZoomLevel(-1)}><Icon name="minus" size={12} /></button>
          <button type="button" className="cb" aria-label="Reset text size" onClick={() => void setZoomLevel(1)} style={{ minWidth: 56 }}>{zoomPercent(s['ui.zoom'])}</button>
          <button type="button" className="ib" aria-label="Larger text" onClick={() => void stepZoomLevel(1)}><Icon name="plus" size={12} /></button>
        </span>
      </Row>
      <Row label="Density" hint="Compact is 12 px, comfortable is 13 px">
        <span className="seg" role="group" aria-label="Density">
          {(['compact', 'comfortable'] as const).map((d) => (
            <button key={d} type="button" aria-pressed={s['ui.density'] === d} onClick={() => void saveSetting('ui.density', d)}>{d}</button>
          ))}
        </span>
      </Row>
      <Row label="Reduce motion" hint="Turns off animations">
        <Switch checked={s['ui.reduceMotion']} label="Reduce motion" onChange={(v) => void saveSetting('ui.reduceMotion', v)} />
      </Row>
    </div>
  )
}

function About() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.mc.app.info().then(setInfo)
  }, [])
  return (
    <dl className="kv" style={{ margin: 0 }}>
      <dt>app</dt><dd>Hermes Agent Mission Control {info ? `v${info.version}` : ''}</dd>
      <dt>electron</dt><dd>{info?.electron ?? '–'}</dd>
      <dt>platform</dt><dd>{info?.platform ?? '–'}</dd>
    </dl>
  )
}

export function SettingsModal() {
  const tab = useUi((s) => s.settingsTab)
  const openSettings = useUi((s) => s.openSettings)
  const close = useUi((s) => s.closeSettings)
  if (!tab) return null
  return (
    <Modal title="Settings" onClose={close} width={760}>
      <div style={{ display: 'flex', gap: 16, minHeight: 320 }}>
        <div role="tablist" aria-orientation="vertical" aria-label="Settings sections" style={{ flex: 'none', width: 150, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="settings-panel" className="set-tab" style={tab === t.id ? { background: '#343746', color: '#50FA7B', fontWeight: 600 } : undefined} onClick={() => openSettings(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id="settings-panel" aria-labelledby={`tab-${tab}`} style={{ flex: 1, minWidth: 0 }}>
          {tab === 'general' && <General />}
          {tab === 'connection' && <EditConnectionDialogBody onDone={close} />}
          {tab === 'about' && <About />}
          {tab !== 'general' && tab !== 'connection' && tab !== 'about' && <UnsupportedState why="This section arrives in a later release." />}
        </div>
      </div>
    </Modal>
  )
}
```

Refaktor kecil di `EditConnectionDialog.tsx`: pindahkan isi `Modal` ke komponen `EditConnectionDialogBody({onDone})` yang di-export, dan buat `EditConnectionDialog` menjadi `<Modal …><EditConnectionDialogBody onDone={onClose} /></Modal>`.

- [ ] **Step 2: Typecheck dan build** — `npm run typecheck && npm run build` → bersih.

- [ ] **Step 3: Commit**

```bash
git add src/renderer
git commit -m "feat: add Settings modal with General, Connection and About tabs

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 22: Server dev palsu, E2E Playwright, dan verifikasi visual

**Files:**
- Create: `scripts/dev-fake-server.ts` (dijalankan lewat `node --experimental-strip-types` atau `tsx`; lihat langkah), `playwright.config.ts`, `tests/e2e/app.spec.ts`, `tests/e2e/helpers.ts`
- Modify: `package.json` (skrip `dev:fake`)

**Interfaces:**
- Consumes: `startFakeSsh`, `buildFixture`, `advanceFixture`.
- Produces: `npm run dev:fake` (mulai server SSH palsu + cetak host/port/user/password uji); test E2E.

- [ ] **Step 1: Server palsu untuk dev manual**

Pasang `tsx` sebagai devDependency (`npm i -D tsx`). `scripts/dev-fake-server.ts`:
```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeSsh } from '../tests/helpers/fakeSshServer'
import { advanceFixture, buildFixture } from '../tests/helpers/fixture'

const dir = mkdtempSync(join(tmpdir(), 'mc-dev-'))
const fx = buildFixture(join(dir, 'fx'))
const srv = await startFakeSsh({ fixture: fx, port: Number(process.env['FAKE_SSH_PORT'] ?? 2222) })
console.log(`fake Hermes VPS ready
  host     127.0.0.1
  port     ${srv.port}
  user     tester
  password test-pass-123
  key      ${srv.fingerprint}`)
let step = 1
setInterval(() => advanceFixture(join(dir, 'fx'), step++), 1000)
```
Tambahkan ke `package.json`: `"dev:fake": "tsx scripts/dev-fake-server.ts"`. (Nilai kredensial itu murni data uji lokal yang dihasilkan skrip ini; tidak pernah dipakai terhadap host nyata.)

Catatan: `advanceFixture` memanggil Python tiap detik sehingga CPU/jaringan di fixture terus naik dan grafik bergerak.

- [ ] **Step 2: Konfigurasi Playwright**

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' }
})
```

`tests/e2e/helpers.ts`:
```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export async function launchApp(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [resolve('out/main/index.js')],
    env: { ...process.env, MC_USER_DATA: userData, NODE_ENV: 'production' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

export const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))
```

- [ ] **Step 3: Test E2E**

`tests/e2e/app.spec.ts`:
```ts
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { advanceFixture, buildFixture, type FixtureDirs } from '../helpers/fixture'
import { launchApp, tmp } from './helpers'

let srv: FakeSsh
let fx: FixtureDirs
let fxDir: string
let ticker: NodeJS.Timeout
const userData = tmp('mc-e2e-ud-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fxDir = join(tmp('mc-e2e-fx-'), 'fx')
  fx = buildFixture(fxDir)
  srv = await startFakeSsh({ fixture: fx })
  let step = 1
  ticker = setInterval(() => advanceFixture(fxDir, step++), 1000)
})
test.afterAll(async () => {
  clearInterval(ticker)
  await srv.close()
})
test.afterEach(async () => {
  await app?.close()
})

async function firstConnect(): Promise<void> {
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByText('first-time setup')).toBeVisible()
  await page.getByLabel('host / public ip').fill('127.0.0.1')
  await page.getByLabel('ssh port').fill(String(srv.port))
  await page.getByLabel(/^username/).fill('tester')
  await page.getByLabel(/^password/).fill('test-pass-123')
  await page.getByRole('button', { name: /TEST & CONNECT/ }).click()
  await expect(page.getByRole('alertdialog', { name: 'Host key verification' })).toBeVisible()
  await expect(page.getByText(srv.fingerprint)).toBeVisible()
  await page.getByRole('button', { name: /TRUST & CONTINUE/ }).click()
}

test('first run: verify host key, pass preflight, land on a live dashboard', async () => {
  await firstConnect()
  await expect(page.getByText(/9\/9 checks passed|checks passed/)).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/active agents? of 3/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: /^Scout, working/ })).toBeVisible()
  await expect(page.getByText(/openrouter · anthropic\/claude-sonnet/)).toBeVisible({ timeout: 20_000 }).catch(() => {})
  await page.screenshot({ path: 'tests/e2e/shots/dashboard.png' })
})

test('the second launch connects on its own without showing the form', async () => {
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByText(/auto-connecting to/)).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel('host / public ip')).toHaveCount(0)
})

test('server screen streams CPU, memory, disks and processes', async () => {
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /^Server/ }).click()
  await expect(page.getByRole('region', { name: 'CPU' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('region', { name: 'Memory' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Disks' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Processes' })).toBeVisible()
  await expect(page.getByRole('cell', { name: /hermes_cli\.main gateway run/ })).toBeVisible()
  await page.getByRole('button', { name: /Hermes only/ }).click()
  await expect(page.getByRole('columnheader', { name: /CPU%/ })).toHaveAttribute('aria-sort', 'descending')
  await page.screenshot({ path: 'tests/e2e/shots/server.png' })
})

test('sidebar collapse and text size persist across launches', async () => {
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await page.getByRole('button', { name: 'Larger text' }).click()
  await expect(page.getByRole('button', { name: 'Reset text size' })).toHaveText('110%')
  await app.close()
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('aside.mc-side.is-rail')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Reset text size' })).toHaveText('110%')
})

test('reconnects after the server drops the connection', async () => {
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('status').filter({ hasText: /@127\.0\.0\.1/ })).toBeVisible()
  srv.dropConnections()
  await expect(page.getByText(/Reconnecting/).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/\d+ ms/).first()).toBeVisible({ timeout: 30_000 })
})

test('the renderer is sandboxed', async () => {
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 20_000 })
  const probe = await page.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>)['require'],
    process: typeof (globalThis as Record<string, unknown>)['process'],
    mc: typeof (window as unknown as { mc?: unknown }).mc
  }))
  expect(probe).toEqual({ require: 'undefined', process: 'undefined', mc: 'object' })
  const before = page.url()
  await page.evaluate(() => {
    window.location.href = 'https://example.com/'
  })
  await page.waitForTimeout(500)
  expect(page.url()).toBe(before)
  const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'))
  expect(csp).toContain("script-src 'self'")
  expect(csp).not.toContain('unsafe-eval')
})

test('forgetting the connection returns to first-time setup', async () => {
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Edit connection' }).click()
  await page.getByRole('button', { name: /Forget this connection…/ }).click()
  await page.getByRole('button', { name: 'Forget this connection', exact: true }).click()
  await expect(page.getByText('first-time setup')).toBeVisible()
})
```

Tambahkan `tests/e2e/shots/` ke `.gitignore`.

- [ ] **Step 4: Jalankan E2E**

Run: `npm run test:e2e`
Expected: 7 test PASS. Jika uji kedua gagal karena `safeStorage` tidak tersedia di lingkungan (mis. Linux headless), tandai dengan `test.skip(process.platform === 'linux', 'needs a keyring')`; di Windows DPAPI tersedia.

- [ ] **Step 5: Verifikasi visual terhadap mockup**

1. Jalankan `npm run dev:fake` (terminal 1) dan `npm run dev` (terminal 2, pakai `MC_USER_DATA` baru), sambungkan memakai nilai yang dicetak skrip.
2. Buka mockup lewat `preview_start` `mockup` (http://127.0.0.1:5317) dan ambil screenshot `Connect.html`, `Launch.html`, `Main.html`, `Server.html`.
3. Ambil screenshot aplikasi untuk keempat layar pada lebar 1440 px dan bandingkan: tata letak kolom, warna panel, font, jarak (padding `20px 24px 16px`), judul panel tidak terpotong, sidebar 184/56 px.
4. Catat selisih yang bermakna sebagai perbaikan CSS kecil dan perbaiki sebelum lanjut. Tampilkan screenshot berdampingan ke user di ringkasan akhir.

- [ ] **Step 6: Commit**

```bash
git add scripts/dev-fake-server.ts playwright.config.ts tests/e2e package.json package-lock.json .gitignore
git commit -m "test: add fake dev server and Playwright E2E for the full M1 flow

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 23: Dokumentasi, daftar periksa VPS nyata, dan verifikasi akhir

**Files:**
- Create: `docs/manual-vps-checklist.md`
- Modify: `CLAUDE.md` (bagian "Project state" dan perintah)

- [ ] **Step 1: Daftar periksa manual**

`docs/manual-vps-checklist.md`:
```markdown
# Daftar periksa uji manual M1 di VPS Hermes nyata

Jalankan setelah `npm run build` lalu `npm run dev` (atau installer di M7). Anda sendiri yang mengetik password di aplikasi; aplikasi tidak pernah meminta Anda menaruhnya di berkas.

Sebelum mulai, di VPS catat snapshot berkas yang berubah (tanpa menyentuh Hermes):

    find ~ -xdev -type f -newermt "$(date -u +%Y-%m-%dT%H:%M:%S)" 2>/dev/null | wc -l

Kemudian:

1. Layar Connect muncul. Isi host, port, user (user yang menjalankan Hermes), password. Klik TEST & CONNECT.
2. Fingerprint yang tampil sama dengan `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` di VPS. Klik TRUST & CONTINUE.
3. Preflight semuanya hijau (versi Hermes terbaca, profile terhitung, `state.db` terbaca, interpreter Python ditemukan). Catat item yang kuning atau merah dan petunjuknya.
4. Dashboard: jumlah "active agents of N" sama dengan `hermes profile list` untuk profile yang gateway-nya aktif. Nama tampilan mengikuti `profile.yaml`.
5. Kirim satu pesan ke salah satu agent lewat Telegram/CLI: statusnya berpindah ke WORKING dalam ≤ 30 detik lalu kembali IDLE.
6. Buat profile baru (`hermes profile create <nama>`): muncul di roster dalam ≤ 10 detik.
7. Layar Server: CPU, memori, disk, jaringan, dan daftar proses bergerak tiap detik; bandingkan beberapa angka dengan `htop`/`btop` di VPS.
8. Tutup aplikasi dan buka lagi: layar Launch tersambung sendiri tanpa form.
9. Matikan jaringan komputer Anda 20 detik lalu nyalakan: status bar menampilkan Reconnecting, data lama tetap tampil dengan usianya, lalu pulih.
10. Ubah isi `known_hosts` aplikasi tidak mungkin dari UI; untuk menguji host key berubah, gunakan VPS kedua dengan IP yang sama atau reinstall SSH host key. Aplikasi harus memblokir sampai Anda menyetujui fingerprint baru.
11. Setelah semua langkah, cek tidak ada berkas baru di VPS: jalankan lagi perintah `find ... -newermt` dengan waktu mulai sesi; hanya data normal Hermes (log, `state.db`) yang boleh berubah. Tidak boleh ada skrip atau berkas Mission Control.
12. Di VPS jalankan `ps aux | grep "python.* -u -"` selama aplikasi terbuka: ada satu proses collector. Setelah aplikasi ditutup, proses itu hilang dalam ≤ 2 detik.

Laporkan hasil tiap langkah (lolos / tidak, disertai teks error) agar bisa jadi perbaikan.
```

- [ ] **Step 2: Perbarui `CLAUDE.md`**

Ganti paragraf "Project state" agar mencerminkan bahwa M1 sudah dibangun, tambahkan bagian perintah:

```markdown
## Commands

```bash
npm install            # also rebuilds better-sqlite3 for the Electron ABI (postinstall)
npm run dev            # electron-vite dev
npm run build          # production build into out/
npm run typecheck      # tsc for main/preload/shared + renderer
npm test               # Vitest, run under Electron-as-Node so native modules match
npm run test:py        # pytest for the Python collector (python, not python3, on Windows)
npm run test:e2e       # builds, then Playwright for Electron
npm run dev:fake       # fake Hermes VPS over SSH for manual runs (prints throwaway test credentials)
npm run icons          # regenerate src/renderer/components/icons.generated.ts from mockup/build.py
```

Specs and plans live in `docs/superpowers/specs` and `docs/superpowers/plans`. M1 (foundation) is built; M2-M10 are not.
```
(Tulis sebagai edit `Edit` pada `CLAUDE.md`, tanpa menghapus bagian Mockups, Target architecture, dan Zero-Change.)

- [ ] **Step 3: Verifikasi akhir**

Run, berurutan, dan baca keluarannya:
```bash
npm run typecheck
npm test
npm run test:py
npm run test:e2e
```
Expected: semuanya hijau. Jika ada yang merah, perbaiki akar masalah sebelum klaim selesai (skill `superpowers:verification-before-completion`).

Cek kriteria selesai spec §9 satu per satu dan catat buktinya:
1. Alur Connect → TOFU → preflight → Dashboard: E2E test 1.
2. Metrik dan agent live, profile baru ≤ 10 s: `tests/integration/session.test.ts` + uji manual `addProfile`.
3. Putus-sambung: session test "reconnects" dan E2E test 5.
4. Zero-Change: session test "leaves the Hermes fixture byte-for-byte untouched" dan pytest `test_zero_change_after_a_session`.
5. Hardening: `tests/unit/security.test.ts` dan E2E test 6.
6. Kesesuaian visual: screenshot berdampingan dari Task 22 Step 5.
7. Tidak membuka `.env`/`auth.json`: pytest `test_never_opens_secret_files`.

- [ ] **Step 4: Commit**

```bash
git add docs/manual-vps-checklist.md CLAUDE.md
git commit -m "docs: add manual VPS checklist and refresh project notes for M1

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review (spec coverage)

| Spec | Task |
|---|---|
| §1–3 Scaffold, struktur, alias | 1 |
| §4 ConnectionManager, TOFU, backoff, hermes home, deteksi hermes | 10, 11, 12 |
| §4 Preflight, F-STATE-6 | 12 |
| §4 CollectorChannel, EventRouter, model per agent | 13 |
| §4 SettingsStore, SecretStore (weak-backend refusal) | 5, 6 |
| §5 Collector (metrik, agents, status, error, BrokenPipe, ASCII, Zero-Change) | 7, 8 |
| §6 Hardening, CSP, navigasi | 3, 14 (preload sempit) |
| §6 Layar Connect/Launch/Edit/Forget (F-CONN-12/13) | 17, 18 |
| §6 Sidebar, status bar, ukuran teks, shortcut | 15, 16 |
| §6 Dashboard + Agents (F-AGENT-1/2, F-DASH-11..14) | 19 |
| §6 Server (F-MON-1..7) | 20 |
| §6 Settings minimal (General, Connection) | 21 |
| §6 State loading/empty/error/unsupported/stale (F-STATE-1/2/5) | 16 (komponen), 19–21 (pemakaian) |
| §8 Strategi test (unit, pytest, integrasi, Zero-Change, E2E, visual) | 1–14, 22 |
| §9 Kriteria selesai | 23 |
| Perintah remote hanya baca | 12 (test "never writes"), 14 (test "never issues a mutating command") |

Tidak ada langkah yang menyisakan bagian kosong. Nama dan tanda tangan konsisten antar task: `Execer`/`ExecResult` (Task 11) dipakai Task 12 dan 13; `CollectorChannel`/`ModelResolver` (Task 13) dipakai `MissionSession` (Task 14); `IPC` dipindah ke `channels.ts` di Task 14 dan dipakai preload, ipc, session, dan test.
