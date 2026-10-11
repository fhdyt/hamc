# M1 Fondasi: desain

Tanggal: 2026-10-11. Sumber kebutuhan: `docs/PRD-mission-control-hermes.md` (v1.3), §6, §7, §8, §10. Referensi visual: `mockup/`.

Dokumen ini hanya mencakup **M1 (Fondasi)**. M2–M10 punya spec dan plan sendiri.

## 1. Tujuan

Aplikasi Electron yang bisa: login ke VPS Hermes lewat SSH, lolos preflight, menampilkan agent (profile) beserta statusnya, dan memantau server ala btop secara realtime. Semuanya tanpa mengubah apa pun di VPS (Zero-Change, PRD §3.2).

Hasil yang bisa dicoba (PRD §10): login, preflight, melihat agent aktif dan namanya, monitor server, dan navigasi lewat sidebar.

## 2. Cakupan

### Masuk M1

| Area | Requirement |
|---|---|
| Fondasi | Scaffold electron-vite + React 19 + TypeScript, hardening (NF-5), IPC bertipe, `app.db` dengan migrasi (§8.4), safeStorage |
| Koneksi | F-CONN-1..6, 8, 9, 10, 12, 13 (Connect, Launch, TOFU, preflight, reconnect, Edit/Forget connection) |
| Collector | Skrip Python stdlib via stdin; metrik `/proc` 1 detik; pemindaian profile 10 detik; status gateway |
| Agents | F-AGENT-1, F-AGENT-2, F-DASH-11..14 (roster, pin, cari, rail ciut) |
| Monitor | F-MON-1..7 (layar Server dan strip di Dashboard) |
| Shell | F-R13-1/2/3 (sidebar), F-SHELL-1 (status bar), F-R10-5 (ukuran teks), F-UI-9 (jarak) |
| State | F-STATE-1, 2, 5, 6 (loading, empty, error, unsupported; data basi; a11y; deteksi kemampuan) |
| Settings minimal | Modal Settings dengan tab General (ukuran teks, density, reduce motion) dan Connection |

### Tidak masuk M1

Panel Cron, Activity, Graph, dan Chat di Dashboard; layar Live feed, Sessions, Usage, Skills, Logs, Second brain, Kanban; Terminal xterm (F-TERM); Settings → Agents; notifikasi OS; palette Ctrl+K; auto start; tray; installer (M7).

Item sidebar dan panel Dashboard untuk fitur yang belum ada tetap tampil dengan state **"Coming in a later release"**. Tidak ada data palsu di panel itu.

## 3. Struktur repo

Satu paket electron-vite, tanpa monorepo.

```
src/
  main/
    index.ts                 jendela, hardening, siklus hidup
    connection/              ConnectionManager, hostkey, preflight, capabilities, quote
    collector/               CollectorChannel, EventRouter
    store/                   SettingsStore (app.db + migrasi), SecretStore (safeStorage)
    ipc/                     handler IPC bertipe
  preload/index.ts           mc.* (contextBridge)
  renderer/
    app/                     shell, sidebar, status bar, routing
    features/{connect,launch,dashboard,server,settings}/
    stores/                  Zustand: connection, agents, metrics, ui
    styles/                  token Dracula, CSS variables, Tailwind
  shared/                    tipe event, kontrak IPC, schema validasi
collector/collector.py       skrip Python (dibundel sebagai extraResource)
tests/{unit,collector,integration,e2e,fixtures}/
```

Tiap unit punya satu tugas dan antarmuka yang jelas, bisa diuji sendiri.

## 4. Main process

### ConnectionManager
- Memegang satu koneksi ssh2. Method: `connect`, `verifyHostKey`, `preflight`, `exec(argv[])`, `disconnect`.
- `exec` menerima array argumen dan men-quote tiap elemen. Tidak ada penyambungan string mentah.
- Host key: TOFU (F-CONN-3). Fingerprint SHA256 disimpan di tabel `known_hosts`. Jika berubah, koneksi diblokir sampai user menyetujui fingerprint baru.
- Reconnect dengan backoff 1s → 2s → 5s → 10s → 30s maksimum (F-CONN-6). Latensi diukur berkala dan dikirim ke status bar.
- Hermes home: `$HERMES_HOME` milik user SSH, fallback `~/.hermes` (F-CONN-5).
- Deteksi `hermes`: `command -v hermes`, lalu `~/.local/bin/hermes`, lalu venv. Interpreter Python diambil dari shebang `hermes`, fallback `python3` (F-CONN-10).

### Preflight (F-CONN-9)
Checklist: SSH OK, Hermes home, versi Hermes (`hermes --version`, F-CONN-8), jumlah profile, `state.db` bisa dibaca, `hermes` CLI ditemukan, Python ditemukan. Item merah memuat penyebab dan saran tanpa menawarkan perubahan di VPS. Fitur yang tidak bergantung pada item merah tetap berjalan.

### Deteksi kemampuan (F-STATE-6)
Setelah `hermes --version`, probe sekali untuk subperintah yang dipakai milestone berikutnya (`cron runs`, `curator status`, `sessions list`, `tools --summary`, `fallback list`, `mcp list`, `approvals suggest`). Hasilnya disimpan di memori dan ditampilkan di tooltip status bar. Di M1 hasil ini hanya dicatat dan ditampilkan, belum mengaktifkan fitur.

### CollectorChannel
1. Membuka exec `<python> -u -`.
2. Menulis isi `collector.py` ke stdin, lalu **menutup stdin**. Python membaca skrip sampai EOF sebelum menjalankannya, jadi stdin tidak bisa jadi kanal kontrol. Interval pemindaian karena itu tetap di dalam skrip.
3. Membaca stdout per baris, mengurai JSON, dan mengoper ke `EventRouter`.
4. Jika channel menutup, `ConnectionManager` menangani reconnect dan collector dijalankan ulang dari awal.

### EventRouter
Memvalidasi event terhadap schema di `src/shared`. Event yang tidak valid dicatat ke log aplikasi dan dibuang, tanpa membuat aplikasi crash. Event yang valid diteruskan ke renderer lewat IPC.

Format event (PRD §8.3): `{"type": "metrics|agents|error", "ts": ..., "profile": ..., "data": {...}}`. M1 memakai tiga tipe itu. Tipe lain ditambahkan oleh milestone berikutnya.

### Model per agent
Dijalankan oleh `ConnectionManager.exec`: `hermes -p <profile> config get model --json`. Hasilnya di-cache per profile dan baru dijalankan ulang ketika collector melaporkan mtime `config.yaml` berubah. YAML tidak di-parse sendiri.

### SettingsStore dan SecretStore
- `app.db` (better-sqlite3) di folder userData. Tabel M1: `schema_version`, `connections`, `known_hosts`, `settings`, `agent_pins`. `agent_names` menyusul di milestone Settings → Agents.
- Migrasi berurutan berbasis `schema_version`.
- Password hanya disimpan sebagai blob `safeStorage`. Jika backend `safeStorage` hanya `basic_text` (Linux tanpa keyring), opsi simpan password dimatikan dengan penjelasan. Semua isian lain tetap diingat dan password diminta tiap peluncuran (F-CONN-12).
- Log aplikasi lokal (F-APP-4) tidak pernah memuat password.

## 5. Collector Python (stdlib saja)

| Event | Interval | Isi |
|---|---|---|
| `metrics` | 1 s | CPU total dan per-core, load 1/5/15, uptime, memori (used/cache/available), swap, disk per mount dan rate baca/tulis, rate rx/tx per interface, top proses (PID, user, CPU%, MEM%, command). CPU% dan rate dihitung dari selisih antar sampel. |
| `agents` | 10 s, atau saat mtime berubah | Daftar profile, `display_name` dari `profile.yaml` (fallback nama folder), status gateway (`served_profiles`, heartbeat, `gateway.pid` hidup), marker `gateway.parked`, aktivitas terakhir, mtime `config.yaml`, kehadiran SOUL/MEMORY/USER. |
| `error` | sesuai kejadian | Kegagalan non-fatal (file tidak terbaca, skema tidak dikenal). |

Aturan:
- Profile = `default` ditambah tiap folder di `profiles/<nama>/` yang punya salah satu dari `config.yaml`, `.env`, `SOUL.md`, `profile.yaml`, atau `state.db`. `.env` dan `auth.json` **hanya dicek keberadaannya**, tidak pernah dibuka.
- Status: Active jika profile ada di `served_profiles`, heartbeat segar (≤ 120 s), dan PID hidup; cadangan: gateway standalone milik profile hidup; tambahan: sesi CLI berjalan. Working jika aktif dan ada pesan dalam 30 detik terakhir. Parked jika ada `gateway.parked`. Offline jika tidak ada satupun.
- `state.db` dibuka `?mode=ro`. Collector membaca `PRAGMA user_version`/`schema_version` dan memakai `PRAGMA table_info`. Jika skema tidak dikenal, ia mengirim `error` bertipe `unsupported_schema` dan tetap berjalan tanpa data aktivitas.
- Penanganan BrokenPipe/EOF di stdout: proses keluar bersih. Tidak ada file yang ditulis ke VPS.
- NF-2: rata-rata < 2% CPU dan < 50 MB RAM.

## 6. Renderer

### Hardening (NF-5)
`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, CSP ketat, navigasi dan `window.open` diblokir. Renderer tidak punya akses Node maupun SSH.

### API preload
`mc.connection.{connect,disconnect,confirmHostKey,saved,forget}`, `mc.onEvent(cb)`, `mc.settings.{get,set}`, `mc.app.setZoom`. Semuanya bertipe dari `src/shared`.

### Store dan data
- Zustand: `connection` (status, latensi, preflight, kemampuan), `agents`, `metrics`, `ui`.
- Riwayat 60 detik disimpan di ring buffer. uPlot menggambar langsung dari buffer itu.
- Render dijeda saat jendela tidak terlihat. Data tetap diterima.

### Layar
- **Connect** dan **Launch**: tanpa sidebar. Alur F-CONN-12.
- **Dashboard**: kolom kiri (status koneksi dan tombol Edit connection, panel Cron dan Activity dalam state "Coming in a later release"), kolom tengah (strip Server Monitor, panel Graph dalam state sama), kolom kanan (panel Agents).
- **Server**: F-MON-1..7 penuh. Tabel proses bisa diurutkan dengan `aria-sort` dan punya filter "Hermes only".
- **Settings** (modal): General dan Connection.
- Item sidebar lain membuka layar placeholder state **unsupported/coming-later**.

### Visual
Token Dracula dan JetBrains Mono dari PRD §6.9 dan `mockup/src/_shared/shared.css` diterjemahkan menjadi CSS variables dan konfigurasi Tailwind. Komponen React ditulis ulang, bukan menyalin runtime mockup. Warna `#6272A4` hanya untuk dekorasi. Teks sekunder memakai `#A9B2D3` / `#8B95BD`. Ukuran teks lewat `webContents.setZoomFactor`, rentang 70–150%, langkah 10%.

## 7. Error handling

- Pesan koneksi dibedakan: host tidak terjangkau, auth gagal, timeout, `hermes` tidak ditemukan, host key berubah.
- Host tidak terjangkau saat Launch: retry dengan backoff dan Dashboard dibuka dalam mode offline. Password ditolak: dialog Edit connection terbuka dengan isian terisi. Host key berubah: diblokir sampai fingerprint baru diverifikasi.
- Putus koneksi tidak membuat crash. Data terakhir tetap tampil dengan usianya. Status bar menjadi Reconnecting/Offline.
- Setiap layar data punya state loading (kerangka), empty (penyebab dan langkah berikutnya), error (penyebab, retry, data terakhir tetap tampil), dan unsupported.

## 8. Strategi test

| Lapisan | Alat | Cakupan |
|---|---|---|
| Unit | Vitest | Parser JSON-lines, validasi EventRouter, builder quote argumen, SettingsStore dan migrasi, store Zustand, logika backoff |
| Collector | pytest | Terhadap fixture `~/.hermes` palsu: profile, `gateway_state.json`, `state.db` ber-WAL, profile baru muncul, skema tidak dikenal, BrokenPipe |
| Integrasi | Vitest + server ssh2 dalam proses | Server palsu menjalankan collector Python asli terhadap fixture. Menguji connect, TOFU, host key berubah, preflight, stream metrik, reconnect |
| Zero-Change | Integrasi | Snapshot (path, ukuran, mtime, hash) seluruh fixture sebelum dan sesudah satu sesi **tanpa aksi tulis**; hasilnya harus identik (NF-4) |
| E2E | Playwright for Electron | Connect → Launch → Dashboard, sidebar, collapse, ukuran teks, terhadap server palsu yang sama |
| Visual | Browser pane | Bandingkan hasil build dengan screenshot mockup untuk Connect, Launch, Dashboard, Server |

Tidak diuji otomatis: VPS dan Hermes nyata. Setelah build, saya sediakan daftar periksa manual singkat. Anda yang mengetik password di aplikasi.

## 9. Kriteria selesai M1

1. `npm run dev` membuka aplikasi. Alur Connect dengan TOFU, preflight, lalu Dashboard berjalan terhadap server palsu.
2. Metrik server tampil dan diperbarui tiap 1 detik. Agent muncul dengan nama, status, dan model. Profile baru di fixture muncul dalam ≤ 10 detik.
3. Putus dan sambung kembali bekerja: data lama tetap tampil dengan usianya, lalu tersusul.
4. Test Zero-Change lolos. Semua test lainnya hijau.
5. Hardening Electron terverifikasi dengan test (flag `webPreferences`, CSP, navigasi diblokir).
6. Dibuka berdampingan dengan mockup, tampilan Connect, Launch, Dashboard, dan Server sesuai dari sisi tata letak, warna, dan font.
7. Tidak ada `.env`/`auth.json` yang dibuka (diperiksa lewat test pada fixture).

## 10. Risiko khusus M1

| Risiko | Mitigasi |
|---|---|
| `better-sqlite3` butuh binary yang cocok dengan ABI Electron | Pakai prebuild resmi, `electron-builder install-app-deps`/`electron-rebuild` di skrip postinstall. Diverifikasi di awal plan sebagai langkah pertama. |
| Python di Windows (dev) berbeda dari VPS | Collector hanya berjalan terhadap Linux nyata atau via server palsu yang memakai `/proc` fixture. Test pytest dan integrasi memakai direktori `/proc` yang bisa diganti lewat variabel (`MC_PROC_ROOT`) khusus test, sehingga tidak bergantung OS. |
| Format `gateway_state.json` tidak terdokumentasi | Parser toleran, field tak dikenal dibiarkan, heartbeat basi > 120 s ditandai. |
| Keterbatasan verifikasi tanpa VPS nyata | Daftar periksa manual dan fixture per versi Hermes yang didukung. |
