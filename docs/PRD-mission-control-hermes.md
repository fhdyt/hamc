# PRD — Hermes Agent Mission Control (Desktop Multiplatform)

| | |
|---|---|
| **Status** | Draft v1.3 — siap untuk rencana implementasi |
| **Tanggal** | 2026-10-11 |
| **Platform** | Desktop **Windows, macOS, Linux** — Electron + React/TypeScript |
| **Bahasa UI** | Inggris |
| **Target sistem** | Hermes Agent (Nous Research) v0.21.x di VPS Linux, instalasi standar apa adanya |

**Riwayat perubahan**
- v1.5 (v2, 2026-10-20): **multi-VPS** (F-CONN-14..17): banyak server tersimpan, satu yang tersambung; pindah server dari menu di item koneksi status bar, Settings → Servers, atau palette ("Switch to …"); tiap server boleh diberi nama (label) lokal; data per server (pin, foto, room, vault, sesi chat, snapshot memory) tidak pernah tercampur.
- v1.4 (v2, 2026-10-20): **chat room multi-agent** di layar Chat (6.22, F-ROOM-1..8): kamu dan 2–6 agent dalam satu room; satu Send memicu paling banyak 3 ronde giliran berurutan dengan aturan Hermes Desktop (@mention, `(pass)`, `@user`, batas 10 balasan). Diorkestrasi di aplikasi di atas gateway TUI; tiap anggota punya sesi Hermes tersembunyi `Group: <id>`; daftar room dan log room tersimpan lokal di `app.db`.
- v1.3: **sidebar kiri permanen** di semua layar (kecuali Launch dan Connect) menggantikan menu di status bar; status bar hanya berisi status; notifikasi desktop OS tetap muncul di atas aplikasi lain (F-R13-*); jarak halaman dan filter diseragamkan (F-UI-9).
- v1.2: semua menu pindah ke **status bar bawah** (rail kiri dihapus; F-NAV direvisi); terminal dibuka dari ikon di status bar dan muncul di lapisan yang sama dengan status bar; menu **Cron dihapus**: klik panel Cron di Dashboard membuka modal berisi seluruh isi Cron (6.14), dan klik panel Activity membuka modal Live feed; panel Cron dan Activity bisa disembunyikan; chat room di Dashboard tingginya tetap dan hanya isinya yang scroll; layar Chat dan Live feed setinggi jendela, hanya percakapan/feed yang scroll; klik node graph membuka **modal pembaca catatan**; **nama tampilan agent** lokal di Settings → Agents → Profile; layar **Kanban** baru (read-only). Lihat 6.20.
- v1.1: navigasi diganti **icon rail** di kiri (menggantikan menu di status bar/tab bar; 6.11, F-NAV) beserta command palette Ctrl+K; layar baru **Sessions** (6.12), **Usage** (6.13), **Skills** (6.15), **Logs** dengan sub-tab Gateway dan Approvals (6.16); **Cron** mendapat kontrol dan riwayat run (6.14, aksi cron maju dari v2 ke v1.1); **Second Brain** mendapat sub-tab Memory timeline (6.17); **Settings → Agents** bertambah MCP, Toolsets, Fallback, Backup, dan wizard profile baru (6.18); alert biaya harian; aturan state di semua layar (6.19). Fakta perintah dan lokasi file diverifikasi ke dokumentasi resmi Hermes dan dicatat di Lampiran (13.1), termasuk yang **tidak terdokumentasi**.
- v1.0: menu Agents dihapus dan dipindah ke Settings → Agents; path vault disembunyikan; node catatan hijau dan node tag abu-abu; graph ala Obsidian (drag, zoom, pan, hover, fade label); tombol ukuran teks −/+ di status bar (6.9f).
- v0.9: status bar dan modal Settings (auto start, notifikasi, alert ambang batas, foto agent, workspace, data); drag & drop urutan agent; Dashboard setinggi layar; Server dan Terminal bisa disembunyikan; markdown untuk balasan agent; ikon SVG; scrollbar bertema; animasi; teks yang tidak perlu dihapus; panel Second Brain bisa disembunyikan (6.9c–e).
- v0.8: Agent Interaction Graph (6.6b, F-AGRAPH-1..7) sebagai tab Agents di panel graph Dashboard; graph menyesuaikan ukuran panel.
- v0.7: alur model Base URL → API key → fetch models → pilih model (6.8.1, F-CFG-1..9); Zero-Change: menulis API key diizinkan sebagai aksi eksplisit, membaca tetap dilarang; Q10–Q13 diputuskan (Q10/Q11 default).
- v0.6: dashboard mengikuti wireframe user; menu tanpa sidebar (tab bar atas); panel chat berupa accordion per agent, bisa diciutkan jadi rail, dan lebarnya bisa di-drag; koneksi SSH hanya diisi sekali dengan auto-connect saat aplikasi dibuka, plus tombol Edit connection (F-CONN-12/13).
- v0.5: upload file di chat (F-CHAT-11..14); desain visual "hacker view" dengan palet Dracula (6.9) beserta link mockup; save manual tanpa autosave (F-CFG-18).
- v0.4: fitur **Agent Settings** (ganti model AI per agent; edit SOUL.md, MEMORY.md, USER.md); prinsip Zero-Change dipertajam menjadi "tanpa prasyarat & tanpa perubahan diam-diam", dengan aksi tulis yang eksplisit dan dikonfirmasi user.
- v0.3: stack diganti dari Python/PySide6 ke **Electron** (multiplatform); semua jawaban review (Q1–Q9) dimasukkan; UI berbahasa Inggris; graph view memakai PixiJS + d3-force (pendekatan Obsidian); penyimpanan rahasia memakai keychain OS lewat Electron `safeStorage`.
- v0.2: prinsip **Zero-Change**; chat lewat CLI `hermes chat`; collector tanpa file di VPS; pengaturan di SQLite lokal.
- v0.1: draft awal.

---

## 1. Ringkasan

Hermes Agent Mission Control adalah aplikasi desktop multiplatform (Windows, macOS, Linux) untuk memantau semua Hermes Agent yang berjalan di VPS milik user, secara realtime, dari satu layar.

Aplikasi terhubung lewat SSH dengan IP publik, username, dan password. Aplikasi **tidak butuh persiapan apa pun di VPS dan tidak pernah mengubah apa pun diam-diam**: tidak ada pemasangan, tidak ada perubahan source, plugin, hook, service, maupun port. Artinya, siapa pun yang sudah punya Hermes Agent terinstal bisa langsung memakai aplikasi ini. Perubahan hanya terjadi saat user sendiri menekan Save di Agent Settings.

Begitu terhubung, user langsung melihat:
- berapa agent yang aktif dan namanya;
- monitor server ala `btop` (CPU, RAM, disk, network, proses);
- jadwal cronjob dari semua agent;
- feed interaksi semua agent secara realtime, termasuk *thinking* (reasoning) dan tool call;
- graph view ala Obsidian untuk *second brain* (vault Obsidian di VPS);
- chat 1-on-1 dengan setiap agent (seperti DM) langsung dari aplikasi;
- pengaturan per agent: ganti model AI, serta edit SOUL.md, MEMORY.md, dan USER.md.

Sejak v1.1, aplikasi juga memberi:
- riwayat semua sesi dengan pencarian isi pesan dan transkrip lengkap (thinking dan tool call);
- analitik token dan biaya per hari, per agent, dan per model, plus inspector tool call;
- log agent dan gateway, status per platform gateway, dan kebijakan approval (read-only);
- kontrol cron (pause, resume, run now, ubah jadwal) dengan riwayat run dan diff output;
- penjelajah skills, termasuk skill yang ditulis agent sendiri;
- timeline perubahan memory dan USER/SOUL;
- MCP, toolsets, fallback model, backup, dan pembuatan profile baru di Settings → Agents;
- semua menu di sidebar kiri permanen (v1.3) dan command palette (Ctrl+K).

## 2. Latar Belakang & Masalah

Hermes Agent menyimpan semua datanya di filesystem VPS:
- `~/.hermes/` untuk profile default, dan `~/.hermes/profiles/<nama>/` untuk setiap agent tambahan;
- isinya: `state.db` (SQLite), `cron/jobs.json`, `memories/`, `logs/`, `gateway_state.json`.

Untuk tahu kondisi agent saat ini, user harus SSH manual lalu menjalankan banyak perintah (`hermes profile list`, `hermes cron list`, `hermes logs -f`, `btop`) di beberapa terminal. Belum ada tampilan terpadu yang memperlihatkan semua agent sekaligus dan realtime, apalagi isi *thinking*-nya dan graph second brain-nya.

Dashboard web bawaan Hermes (`hermes dashboard`) memang ada. Namun dashboard itu harus dijalankan dan di-tunnel manual, satu halaman hanya menampilkan satu profile, dan tidak punya monitor server ala btop maupun graph vault ala Obsidian.

## 3. Tujuan, Prinsip & Non-Tujuan

### 3.1 Tujuan
1. **G1** — Sekali login, semua informasi utama langsung terlihat tanpa membuka terminal.
2. **G2** — Status agent, interaksi, dan metrik server tampil *near-realtime* (latensi ≤ 2 detik).
3. **G3 — Zero-Change** — Aplikasi langsung berjalan di instalasi Hermes standar mana pun tanpa persiapan, dan tidak pernah mengubah VPS kecuali atas aksi eksplisit user (lihat 3.2).
4. **G4** — Graph view second brain terasa seperti Graph View Obsidian.
5. **G5** — Satu codebase berjalan di Windows, macOS, dan Linux.

### 3.2 Prinsip Zero-Change (wajib, berlaku juga untuk v2)

Prinsip ini punya dua lapis:
1. **Tanpa prasyarat:** aplikasi bisa langsung dipakai di instalasi Hermes standar mana pun, tanpa memasang atau mengubah apa pun lebih dulu.
2. **Tanpa perubahan diam-diam:** secara default aplikasi hanya membaca. Setiap penulisan ke VPS hanya terjadi karena **aksi eksplisit user** (tombol Save, Send, atau Restart dengan konfirmasi), dan sebisa mungkin memakai CLI resmi Hermes.

| ✅ Selalu boleh (baca) | ✍️ Boleh hanya atas aksi eksplisit user | ❌ Tidak pernah |
|---|---|---|
| Login SSH sebagai user yang menjalankan Hermes | Mengirim chat (`hermes chat`, 6.7) | Memasang paket, service, plugin, hook, atau dependency di VPS |
| Membaca file Hermes (`state.db`, `kanban.db`, `shared-state.db` read-only, `jobs.json`, `gateway_state.json`, `profile.yaml`, `SOUL.md`, `memories/`, log) | Mengganti model agent lewat `hermes -p <p> config set model.*`, termasuk provider custom (Base URL), dan **menulis** API key provider lewat `hermes config set <ENV_VAR>` (6.8.1) | Mengubah source Hermes |
| Membaca `/proc` dan file vault second brain | Mengedit `SOUL.md`, `memories/MEMORY.md`, dan `memories/USER.md` milik agent (6.8) | **Membaca** rahasia (`.env`, `auth.json`, isi API key); menulis `auth.json`/OAuth |
| Menjalankan perintah resmi `hermes` yang hanya membaca (`--version`, `config get`, `status`, `profile list`, …) | Restart gateway satu agent (`hermes -p <p> gateway restart`) untuk menerapkan perubahan | Menulis file helper/skrip ke VPS, atau perubahan apa pun yang tidak diminta user |
| Menjalankan interpreter Python milik Hermes dengan skrip collector lewat stdin (tidak disimpan ke disk) | Mengunggah lampiran chat ke folder upload (`~/hermes-uploads/`, 6.7) dan menghapusnya lagi lewat Settings | Membuka port baru atau mengaktifkan server (API server, dashboard) |
| Membaca `skills/` (termasuk `.usage.json` dan `.curator_ledger.jsonl`), `logs/`, `cron/output/`, `gateway_state.json`, dan `state.db` (termasuk tabel FTS) read-only; menjalankan `hermes … list/status/runs/suggest` yang hanya membaca | Aksi cron (`hermes -p <p> cron pause/resume/run/edit`, `incidents ack`), `hermes tools enable/disable`, `hermes skills install`, `hermes curator pin/unpin/archive/restore`, `hermes profile create`, `hermes gateway restart/stop`, `hermes sessions rename/pin`, dan `hermes mcp test` — masing-masing dengan pratinjau perintah dan konfirmasi (6.11–6.18) | Menulis file backup di VPS (`hermes backup` tidak dipakai; backup = unduhan SFTP ke komputer user); mengubah approval policy atau allowlist dari aplikasi |
| | | Memakai `sudo` |
| | | Mengesampingkan kebijakan Hermes (misalnya approval perintah berbahaya) |

> Catatan: chat dengan agent menghasilkan sesi baru di `state.db`. Itu perilaku normal Hermes saat dipakai, sama seperti user menjalankan `hermes chat` sendiri.

### 3.3 Non-Tujuan (v1)
- Mengedit file vault second brain dari aplikasi.
- Mengedit config Hermes di luar model, toolsets, dan fallback (v1.1: toolsets lewat `hermes tools`, fallback hanya dibaca). **Kebijakan approval, platform, dan isi MCP (env, header) tidak diedit dari aplikasi.** Login OAuth provider tetap dilakukan di terminal.
- Mengubah kebijakan approval: `approvals.mode: off`, `--yolo`, atau menambah `command_allowlist` dari aplikasi tidak pernah ada (prinsip Zero-Change). Aplikasi hanya menampilkannya.
- Mengganti atau menimpa seluruh profile dalam satu klik (restore backup dilakukan manual atau lewat `hermes import` di terminal).
- Menghapus sesi, skill, atau job secara permanen dari aplikasi.
- Versi sebelumnya melarang start/stop gateway; sejak v1.1, restart dan stop gateway **per profile** boleh atas aksi eksplisit (6.16). Aksi cron (pause/resume/run/edit/ack lewat `hermes cron …` resmi) ikut masuk v1.1 (6.14).
- Chat room multi-agent (beberapa agent dalam satu room, atau agent saling bicara). v1 hanya chat 1-on-1. **Dibangun di v2 (6.22, F-ROOM).**
- Mendukung banyak VPS sekaligus. v1 hanya satu VPS per jendela; multi-VPS masuk v2. **Dibangun di v2 (F-CONN-14..17):** banyak server tersimpan, satu yang tersambung pada satu waktu; koneksi latar belakang ke beberapa server dan tampilan gabungan lintas server tetap di luar cakupan.
- Versi mobile atau versi web.
- Lokalisasi selain bahasa Inggris.

## 4. Pengguna

- **Persona utama:** pemilik dan operator VPS yang menjalankan satu atau lebih Hermes Agent (multi-profile, gateway multiplex), misalnya agent riset, agent Telegram, dan agent penulis. Ia paham teknis dan terbiasa dengan SSH dan btop, tetapi ingin satu "ruang kontrol" visual yang bisa dibiarkan terbuka di monitor kedua.
- **Persona sekunder:** pengguna Hermes lain di Windows, macOS, atau Linux yang mengunduh aplikasi ini dan ingin langsung memakainya pada VPS mereka yang sudah berjalan, tanpa setup apa pun.

## 5. User Stories

| ID | Sebagai user, saya ingin… | Supaya… |
|---|---|---|
| US-1 | memasukkan IP publik, username, dan password VPS saat pertama kali membuka aplikasi | aplikasi bisa terhubung ke VPS saya |
| US-2 | aplikasi mengingat koneksi saya secara aman (opsional) | tidak perlu mengetik ulang setiap kali |
| US-3 | langsung melihat jumlah agent aktif dan namanya setelah login | tahu kondisi armada agent dalam sekali lihat |
| US-4 | melihat CPU, RAM, disk, network, dan proses VPS seperti btop | tahu apakah server sedang kewalahan |
| US-5 | melihat semua cronjob dari semua agent dalam satu daftar, termasuk run berikutnya dan status run terakhir | tidak ada jadwal yang terlewat atau gagal diam-diam |
| US-6 | melihat setiap pesan, tool call, dan *thinking* dari semua agent secara realtime | paham apa yang sedang dikerjakan dan dipikirkan agent |
| US-7 | memasukkan path vault second brain di VPS | aplikasi tahu vault mana yang harus divisualisasikan |
| US-8 | melihat second brain sebagai graph ala Obsidian yang ikut berubah saat agent menulis catatan baru | bisa menjelajah pengetahuan yang dibangun agent |
| US-9 | chat langsung dengan satu agent tertentu dari aplikasi dan melihat jawabannya mengalir | bisa memberi tugas atau bertanya ke agent tanpa membuka Telegram/terminal |
| US-10 | memakai aplikasi ini di VPS Hermes yang sudah berjalan tanpa mengubah apa pun di sana | instalasi Hermes saya tetap bersih dan aman |
| US-11 | memakai aplikasi yang sama di Windows, macOS, atau Linux | tidak terikat pada satu OS |
| US-12 | mengganti model AI (provider + model) yang dipakai setiap agent | bisa menyesuaikan biaya/kemampuan per agent tanpa SSH manual |
| US-13 | mengedit SOUL.md, MEMORY.md, dan USER.md milik setiap agent dari aplikasi | bisa mengatur persona dan ingatan agent dengan nyaman |

## 6. Kebutuhan Fungsional

Prioritas: **P0** wajib ada di v1, **P1** diharapkan ada di v1, **P2** untuk nanti.

### 6.1 Koneksi & Onboarding (F-CONN)

| ID | Kebutuhan | Prio |
|---|---|---|
| F-CONN-1 | Layar pertama berisi form: **Host / Public IP**, **SSH Port** (default 22), **Username**, **Password**. User SSH ini dianggap sebagai user yang menjalankan Hermes. | P0 |
| F-CONN-2 | Tombol "Test & Connect". Pesan error dibedakan untuk host tidak terjangkau, auth gagal, timeout, dan Hermes tidak ditemukan. | P0 |
| F-CONN-3 | **Verifikasi host key (TOFU):** saat pertama connect, tampilkan fingerprint SSH (SHA256) lalu minta konfirmasi. Fingerprint disimpan. Jika fingerprint berubah, beri peringatan keras dan blokir koneksi sampai user menyetujui. | P0 |
| F-CONN-4 | Checkbox "Remember & auto-connect on launch" (**default aktif**). Host, port, username, dan fingerprint disimpan di `app.db` (lihat 8.4). Password dienkripsi dengan **keychain OS** lewat Electron `safeStorage` (Windows DPAPI, macOS Keychain, Linux Secret Service/KWallet). Jika di Linux tidak ada keyring yang tersedia, opsi menyimpan password dinonaktifkan dengan penjelasan, **tidak** jatuh ke enkripsi lemah. | P0 |
| F-CONN-5 | **Hermes home:** pakai `$HERMES_HOME` milik user SSH jika ada, jika tidak `~/.hermes`. Jika tidak ditemukan, tampilkan pesan yang jelas. | P0 |
| F-CONN-6 | Auto-reconnect dengan backoff (1s → 2s → 5s → 10s, maksimal 30s). Status bar menampilkan Connected / Reconnecting / Offline beserta latensi. | P0 |
| F-CONN-7 | Login dengan SSH private key sebagai alternatif password. **Dibangun (dimajukan dari v2, 2026-10-19):** satu metode per koneksi (Password atau Private key); file key dipilih lewat dialog native dan hanya path-nya disimpan; passphrase disimpan di keychain OS seperti password; format OpenSSH, PEM, dan PuTTY PPK v2 (PPK v3 ditolak dengan petunjuk ekspor); tab server di Terminal memakai key yang sama. Tanpa ssh-agent. | P2 |
| F-CONN-8 | Tampilkan versi Hermes di VPS (`hermes --version`) dan beri peringatan jika versi di bawah yang didukung. | P1 |
| F-CONN-9 | **Preflight check** setelah login, ditampilkan sebagai checklist hijau/merah: SSH OK · Hermes home ditemukan · versi Hermes · jumlah profile · `state.db` bisa dibaca · `hermes` CLI ditemukan · interpreter Python ditemukan. Untuk item merah, tampilkan penyebab dan saran **tanpa** menawarkan perubahan di VPS. Fitur yang tidak bergantung pada item merah tetap berjalan. | P0 |
| F-CONN-10 | **Deteksi `hermes` CLI** yang tahan terhadap PATH sesi SSH non-interaktif: cek `command -v hermes`, lalu `~/.local/bin/hermes`, lalu lokasi venv instalasi Hermes. Interpreter Python diambil dari shebang executable `hermes` (pasti ada karena Hermes berbasis Python), dengan fallback ke `python3`. | P0 |
| F-CONN-11 | Override path Hermes home secara manual di Settings, untuk instalasi non-standar. | P2 |
| F-CONN-12 | **Koneksi hanya diisi sekali.** Form koneksi hanya muncul saat pertama kali aplikasi dipakai, atau setelah "Forget this connection". Saat aplikasi dibuka berikutnya, layar **Launch** langsung tersambung memakai koneksi tersimpan (password dari keychain OS), menampilkan progres langkah demi langkah, lalu membuka Dashboard tanpa form. Jika gagal: host tidak terjangkau → retry dengan backoff dan Dashboard dibuka dalam mode offline; password ditolak → dialog Edit connection terbuka dengan isian yang sudah terisi; host key berubah → diblokir sampai user memverifikasi fingerprint baru. Di Linux tanpa keyring, semua isian tetap diingat dan hanya password yang diminta saat aplikasi dibuka. | P0 |
| F-CONN-14 | **Banyak server tersimpan (v2).** Tiap target `host:port:username` punya barisnya sendiri di `app.db` beserta metode login, rahasia di keychain OS, host key, pin, foto/nama agent, room, vault, sesi chat dan snapshot memory. Satu server tersambung pada satu waktu; pindah = putus lalu sambung. Saat aplikasi dibuka, server yang terakhir tersambung dipakai untuk auto-connect. Mengubah alamat server tersimpan mempertahankan datanya; alamat yang sudah dipakai server lain ditolak. | P1 |
| F-CONN-15 | **Menu server di status bar.** Item koneksi membuka menu: daftar server (yang aktif dicentang), *Add server…* dan *Manage servers…*. Memilih server lain menampilkan layar Launch lalu Dashboard. Command palette punya "Switch to <server>" dan "Add server". | P1 |
| F-CONN-16 | **Settings → Servers** (pengganti tab Connection): daftar server dengan alamat, metode login, waktu terakhir tersambung dan status; tombol Connect, Edit dan Forget (dua langkah) per server; Add server membuka form kosong. Form punya field **name** opsional (≤ 40 karakter, lokal saja; kosong = user@host). Melupakan server aktif menyambung ke server tersimpan berikutnya, atau kembali ke first-time setup bila tidak ada lagi. | P1 |
| F-CONN-17 | **Pindah dengan aman.** Bila pindah server akan menghentikan balasan chat yang sedang ditulis, room yang sedang berjalan, upload, atau perubahan Settings → Agents yang belum disimpan, aplikasi bertanya dulu ("This stops: …"). Tab Terminal ke server lama ditutup, tab lokal tetap. Semua data di layar dikosongkan sebelum server baru tersambung. | P1 |
| F-CONN-13 | **Tombol "Edit connection"** di Dashboard (blok status kiri atas) dan di header setiap layar. Tombol ini membuka dialog berisi koneksi saat ini (host, port, username, toggle auto-connect, info host key). Field password kosong berarti password tersimpan tetap dipakai. "Test & save" mengetes lalu menyambung ulang dengan pengaturan baru. "Forget this connection" menghapus data di `app.db` dan entri keychain, lalu kembali ke layar first-time setup. Jika host diganti, verifikasi host key baru wajib dilakukan. | P0 |

### 6.2 Overview Agent (F-AGENT)

**Definisi**
- **Agent** = satu *profile* Hermes: profile `default` (`~/.hermes`) ditambah setiap folder di `~/.hermes/profiles/<nama>/` yang berisi salah satu dari `config.yaml`, `.env`, `SOUL.md`, `profile.yaml`, atau `state.db`. Aplikasi hanya memeriksa keberadaan file-file ini dan tidak membaca isi `.env`.
- Jumlah agent **dinamis**: profile baru yang dibuat user terdeteksi otomatis (pemindaian ulang setiap 10 detik), dan profile yang dihapus ikut hilang.
- **Aktif**: gateway multiplex (mode default) sedang melayani profile tersebut. Cara memastikannya:
  1. **utama:** profile tercantum di `served_profiles` pada `~/.hermes/gateway_state.json`, heartbeat-nya masih segar, dan PID di `gateway.pid` masih hidup;
  2. **cadangan:** profile punya gateway standalone yang berjalan (`gateway.pid` milik profile hidup);
  3. **tambahan:** ada sesi CLI yang sedang berjalan (sesi tanpa `ended_at` dengan pesan dalam 5 menit terakhir).
- **Parked**: ada marker `gateway.parked`.
- **Sibuk** (*working*): agent aktif yang punya pesan baru dalam 30 detik terakhir.

| ID | Kebutuhan | Prio |
|---|---|---|
| F-AGENT-1 | Header besar: **"N active agents of M"**. | P0 |
| F-AGENT-2 | Kartu per agent berisi: nama (`display_name` dari `profile.yaml`, fallback ke nama folder), status (Active / Working / Idle / Offline / Parked), model, platform yang terhubung (telegram, discord, …), dan waktu aktivitas terakhir. | P0 |
| F-AGENT-3 | Statistik per agent untuk hari ini: jumlah sesi, pesan, tool call, token (input/output/reasoning), dan estimasi biaya (USD). Sumbernya tabel `sessions` di `state.db`. | P1 |
| F-AGENT-4 | Klik kartu agent untuk membuka feed interaksi (6.5) yang sudah difilter ke agent tersebut, membuka chat-nya (6.7), atau membuka pengaturannya (6.8). | P0 |

### 6.3 Monitor Server ala btop (F-MON)

| ID | Kebutuhan | Prio |
|---|---|---|
| F-MON-1 | **CPU:** grafik total dan per-core (riwayat 60 detik), load average 1/5/15, uptime. | P0 |
| F-MON-2 | **Memory:** RAM terpakai, cache, dan tersedia, plus swap. Ditampilkan sebagai bar dan grafik. | P0 |
| F-MON-3 | **Disk:** pemakaian per mount point serta kecepatan baca/tulis. | P0 |
| F-MON-4 | **Network:** kecepatan rx/tx per interface (grafik) dan total. | P0 |
| F-MON-5 | **Processes:** tabel top proses (PID, user, CPU%, MEM%, command) yang bisa diurutkan. Ada filter cepat "Hermes only", dan proses Hermes disorot. | P0 |
| F-MON-6 | Refresh setiap 1 detik. Datanya dibaca dari `/proc`, jadi tidak perlu memasang `psutil` atau btop di VPS. | P0 |
| F-MON-7 | Tema gelap ala btop: gradien hijau → kuning → merah sesuai beban. | P1 |
| F-MON-8 | Suhu CPU (jika `/sys/class/thermal` tersedia) dan pemakaian GPU (jika `nvidia-smi` sudah ada). | P2 |

### 6.4 Jadwal Cronjob (F-CRON)

Sumber data: `cron/jobs.json` di setiap profile, dibaca saja.

| ID | Kebutuhan | Prio |
|---|---|---|
| F-CRON-1 | Tabel gabungan semua job dari semua agent dengan kolom: **Agent**, **Name**, **Schedule** (`schedule.display`, misalnya "every day at 07:00"), **Next run** (dengan hitung mundur), **Last run**, **Last status** (ok / error / delivery_failed / blocked_config), **State** (scheduled / paused / running / completed), dan **Deliver** ke mana. | P0 |
| F-CRON-2 | Filter per agent dan status, serta pencarian nama. | P0 |
| F-CRON-3 | Detail job: prompt, skills, model/provider, repeat (`times`/`completed`), `last_error`, dan output run terakhir (dari `cron/output/` jika `deliver: local`, atau dari sesi `source='cron'` di `state.db`). | P1 |
| F-CRON-4 | Tampilan **timeline 24 jam ke depan**: setiap job digambar sebagai titik di sumbu waktu, diberi warna per agent. | P1 |
| F-CRON-5 | Notifikasi native OS saat ada job yang berakhir dengan status `error`. | P1 |
| F-CRON-6 | Aksi pause, resume, dan run now lewat CLI resmi `hermes -p <agent> cron …`. | **v1.1** — dirinci di 6.14 (F-CRON-7..14) |

### 6.5 Feed Interaksi Realtime (F-FEED)

Sumber data: tabel `messages` dan `sessions` di `state.db` milik setiap profile, dibaca **read-only**. Hanya baris dengan `active=1` yang ditampilkan, karena Hermes menyimpan duplikat baris lama saat konteks dikompres.

| ID | Kebutuhan | Prio |
|---|---|---|
| F-FEED-1 | Satu feed gabungan (*timeline*) dari semua agent, diurutkan berdasarkan waktu. Setiap item diberi warna/badge agent dan sumber sesi (telegram, cli, cron, subagent, mission-control, …). | P0 |
| F-FEED-2 | Jenis item dibedakan secara visual: **user message**, **agent reply**, **thinking** (dari kolom `reasoning` / `reasoning_content`, ditampilkan collapsible dan miring), **tool call** (nama tool + argumen JSON), dan **tool result** (dipotong, bisa di-expand). | P0 |
| F-FEED-3 | Pesan baru muncul ≤ 2 detik setelah ditulis ke `state.db`. Ada auto-scroll yang berhenti saat user scroll ke atas, plus tombol "↓ Jump to latest". | P0 |
| F-FEED-4 | Filter berdasarkan agent, jenis item (misalnya sembunyikan tool result), dan sumber; ada juga pencarian teks. | P0 |
| F-FEED-5 | Tampilan per sesi: klik item untuk melihat seluruh percakapan sesi itu, termasuk relasi *parent/subagent* (`parent_session_id`). | P1 |
| F-FEED-6 | Saat aplikasi dibuka, muat 200 item terakhir sebagai riwayat. Riwayat yang lebih lama dimuat saat user scroll ke atas (virtualized list). | P1 |

> **Keputusan (Q5):** *thinking* tampil per langkah, yaitu setiap kali satu langkah agent selesai dan tersimpan ke `state.db`, tidak token per token. Streaming token per token butuh plugin di VPS sehingga melanggar Zero-Change, dan tidak direncanakan. Sebagian model/provider memang tidak mengembalikan reasoning; untuk kasus itu UI menampilkan label "This model doesn't expose reasoning".

### 6.6 Second Brain — Graph View ala Obsidian (F-BRAIN)

Second brain diasumsikan berupa **vault Obsidian**: folder berisi file `.md` dengan `[[wikilink]]`, mungkin disertai folder `.obsidian/`.

| ID | Kebutuhan | Prio |
|---|---|---|
| F-BRAIN-1 | Saat pertama membuka tab Second Brain, user **diminta memasukkan path vault di VPS** (contoh: `/home/user/vault`, `~/Documents/Obsidian Vault`). Ada tombol "Browse" untuk menjelajah folder VPS lewat SFTP (read-only). Path disimpan per koneksi di `app.db` dan bisa diubah di Settings. | P0 |
| F-BRAIN-2 | Validasi path: folder harus ada, bisa dibaca, dan berisi file `.md`. Tampilkan jumlah catatan yang ditemukan. | P0 |
| F-BRAIN-3 | Parsing semua `*.md` secara rekursif. Abaikan `.obsidian/`, `.git/`, dan `.trash/`. Yang diambil: `[[wikilink]]`, `[[link\|alias]]`, `[[link#heading]]`, `![[embed]]`, link markdown `[teks](catatan.md)`, `#tag` (termasuk tag bertingkat `#a/b`), dan YAML frontmatter (`tags`, `aliases`). Resolusi nama link mengikuti aturan Obsidian (nama file tanpa ekstensi, tidak case-sensitive, path terpendek, alias). Parsing dilakukan di VPS oleh collector. | P0 |
| F-BRAIN-4 | **Graph force-directed seperti Obsidian:** node = catatan, edge = link. Ukuran node sebanding dengan jumlah koneksi. Bisa zoom, pan, dan drag node. Label memudar saat zoom out. Latar gelap. | P0 |
| F-BRAIN-5 | **Interaksi ala Obsidian:** hover node menyorot node dan tetangganya serta meredupkan sisanya, dan judul tampil di dekat node. Klik node membuka panel pratinjau markdown (render read-only) yang memuat backlinks dan outgoing links. | P0 |
| F-BRAIN-6 | **Panel kontrol ala Obsidian:** *Filters* (pencarian, toggle Tags, Attachments, Existing files only, Orphans); *Groups* (warna berdasarkan query path/tag); *Display* (panah, label fade threshold, ukuran node, ketebalan link); *Forces* (center force, repel force, link force, link distance). Pengaturan graph disimpan di `app.db`. | P1 |
| F-BRAIN-7 | **Local graph:** dari pratinjau catatan, tampilkan graph hanya untuk catatan itu dengan kedalaman 1–3. | P1 |
| F-BRAIN-8 | **Realtime:** graph diperbarui otomatis saat agent menambah atau mengubah catatan (polling mtime setiap 3 detik oleh collector; pakai `inotifywait` jika sudah tersedia di VPS). Node baru muncul dengan animasi "pulse" dan tidak mengacak ulang layout. | P0 |
| F-BRAIN-9 | Performa: lancar (≥ 30 fps) untuk vault berisi 5.000 catatan dan 20.000 link. | P0 |
| F-BRAIN-10 | Membaca `.obsidian/graph.json` milik vault (read-only) supaya warna *groups* dan pengaturan forces sama dengan yang user pakai di Obsidian. | P2 |
| F-BRAIN-11 | Tombol "Animate": memutar ulang pertumbuhan vault berdasarkan waktu pembuatan file (fitur timelapse ala Obsidian). | P2 |
| F-BRAIN-12 | Mendukung lebih dari satu vault per koneksi (dropdown). | P2 |

### 6.6b Agent Interaction Graph (F-AGRAPH)

Tab kedua di panel Graph View Dashboard (**Second Brain | Agents**) yang memperlihatkan agent mana sedang berinteraksi dengan agent mana. Semua sumber datanya adalah mekanisme resmi Hermes di VPS yang sama, dan semuanya dibaca **read-only**:

| Interaksi | Mekanisme Hermes | Sumber data |
|---|---|---|
| Serah-terima tugas | Kanban board (tugas punya satu `assignee` profile; komentar adalah "protokol antar agent") | `~/.hermes/kanban.db` (tabel tugas, `task_links`, `task_runs`, `task_events`); papan tambahan di `kanban/boards/<slug>/kanban.db`; fallback `hermes kanban list/show --json` |
| Pesan langsung | Bot Mode `message_agent(target, message)` | `state.db` milik agent tujuan, sesi berjudul "Bot Chat", pesan berawalan "Message from … (@handle):" |
| Ruang bersama | Group chat (room) | `shared-state.db` dan sesi tiap anggota berjudul "Group: <room> · <thread>" |
| Delegasi internal | `delegate_task` (subagent anonim di profile yang sama) | `state.db`, sesi dengan `source='subagent'` / penanda `$._delegate_from` |

| ID | Kebutuhan | Prio |
|---|---|---|
| F-AGRAPH-1 | Tab **Agents** di panel graph Dashboard. Tab yang dipilih disimpan di `app.db`. | P1 |
| F-AGRAPH-2 | **Node:** agent (lingkaran besar dengan warna agent dan status), subagent (lingkaran kecil putus-putus di dekat induknya), dan room (kotak). Agent tanpa interaksi tampil redup. | P1 |
| F-AGRAPH-3 | **Garis** per jenis interaksi, dengan warna dari token desain: kanban `orange`, message_agent `pink`, room `purple`, delegate_task `cyan` putus-putus. Arahnya pengirim → penerima. Label di tengah garis (misalnya `#42`, `msg`) bisa diklik. | P1 |
| F-AGRAPH-4 | **Realtime:** interaksi dengan event dalam 60 detik terakhir ditandai sebagai *aktif*, berupa titik yang bergerak di sepanjang garis. Data baru masuk ≤ 2 detik (collector membaca `task_events` dengan id > terakhir, sesi baru, dan perubahan room). | P1 |
| F-AGRAPH-5 | **Klik garis atau node** untuk membuka kartu detail: jenis, pengirim → penerima, judul tugas atau isi pesan terakhir, waktu, dan lokasi sumber data, dengan tautan ke sesi terkait di Live Feed. Klik node agent menyorot semua interaksinya dan menampilkan ringkasan jumlah per jenis. | P1 |
| F-AGRAPH-6 | Filter jenis interaksi dan rentang waktu (1 jam / 24 jam / 7 hari). | P2 |
| F-AGRAPH-7 | Interaksi lintas mesin (A2A plugin, `hermes peer`). | v2 |

> **Batasan:** graph hanya terisi jika agent memang memakai mekanisme di atas. `message_agent` hanya ada di instalasi Bot Mode. Skema `kanban.db` tidak didokumentasikan lengkap, jadi pembacaannya toleran (`PRAGMA table_info`) dengan fallback `hermes kanban … --json`. Format `source` untuk turn Bot Chat tidak terdokumentasi, sehingga deteksinya memakai judul sesi dan awalan pesan.

### 6.7 Chat 1-on-1 dengan Agent (F-CHAT)

**Mekanisme:** CLI resmi Hermes yang sudah terinstal, dijalankan lewat SSH exec satu kali per giliran chat:

```
hermes -p <profile> chat --oneshot --query-file - --format stream-json \
       --source mission-control [--resume <session_id>]
```

- Isi pesan dikirim lewat **stdin** (`--query-file -`), sehingga tidak diinterpretasi shell dan aman dari injeksi perintah.
- Output berupa JSON Lines: `system` (berisi `session_id`), `text` (delta jawaban), `tool_use`, `tool_result`, dan `result` (token, durasi, `exit_code`).
- Giliran berikutnya memakai `--resume <session_id>` agar konteks percakapan tersambung.
- Chat tidak bergantung pada gateway. Chat tetap bisa dipakai meski gateway sedang mati, selama provider model agent terkonfigurasi.
- Tidak perlu API server, API key, atau perubahan config apa pun.

| ID | Kebutuhan | Prio |
|---|---|---|
| F-CHAT-1 | Tab **Chat** bergaya aplikasi pesan: daftar agent di kiri dan percakapan dengan agent terpilih di kanan. | P0 |
| F-CHAT-2 | Kirim pesan dengan perintah CLI di atas. Ambil `session_id` dari event `system` dan simpan pemetaan agent → sesi di `app.db`. Isi pesannya tidak disimpan. | P0 |
| F-CHAT-3 | **Jawaban mengalir** dari event `text`. Progres tool (`tool_use` / `tool_result`) ditampilkan sebagai chip, misalnya "🔧 web_search… ✓ 1.2s". Statistik giliran (token, durasi) diambil dari event `result`. | P0 |
| F-CHAT-4 | **Thinking:** setelah setiap langkah tersimpan, *thinking* dari `state.db` (lewat collector, 6.5) disisipkan ke percakapan sebagai blok collapsible, sesuai urutan langkahnya. | P0 |
| F-CHAT-5 | Tombol **Stop**: kirim sinyal interrupt ke proses `hermes` di VPS (event `result` dengan `exit_code: 130`). | P0 |
| F-CHAT-6 | Tombol **"New chat"** memulai sesi baru. Riwayat chat dari aplikasi (sesi dengan `source='mission-control'` di `state.db`) bisa dibuka kembali dan dilanjutkan. | P1 |
| F-CHAT-7 | **Perintah berbahaya mengikuti kebijakan Hermes (Q9):** aplikasi tidak menambahkan `--yolo` dan tidak mengesampingkan pengaturan approval apa pun. Apa pun yang dikonfigurasi user di Hermes (default `approvals.single_query_mode: deny`, `command_allowlist`, dan seterusnya) yang berlaku. Jika ada perintah yang ditolak, aplikasi menampilkan info "Command blocked by Hermes approval policy". | P0 |
| F-CHAT-8 | Jawaban dirender sebagai markdown: code block dengan tombol copy, tabel, dan link. | P1 |
| F-CHAT-9 | Pesan dan jawaban chat dari aplikasi juga muncul di Live Feed (6.5) dengan badge sumber "mission-control". | P1 |
| F-CHAT-10 | Mode sesi persisten lewat `hermes acp` (JSON-RPC stdio: satu proses untuk banyak giliran, plus permintaan approval interaktif yang tetap mengikuti kebijakan Hermes). Hanya diaktifkan jika `hermes acp --check` lolos di VPS tersebut. | P2 |
| F-CHAT-11 | **Upload file:** tombol *attach* dan drag & drop, bisa banyak file sekaligus. File diunggah lewat SFTP ke `~/hermes-uploads/<agent>/<YYYYMMDD>/<nama-file>` (folder bisa diubah di Settings). Setiap file punya progress bar dan tombol batal/hapus. Batas default 50 MB per file (bisa diubah). Nama file disanitasi: tanpa `../`, dan nama yang bentrok diberi akhiran. Upload hanya terjadi saat user menekan Send. | P0 |
| F-CHAT-12 | Pesan yang dikirim ke Hermes diberi blok lampiran di awal, berisi path absolut, ukuran, dan tipe MIME setiap file (misalnya `[Attached: /root/hermes-uploads/atlas/20261010/report.pdf · 2.1 MB · application/pdf]`). Agent lalu membacanya dengan tool miliknya sendiri (file / vision). Gambar tampil sebagai thumbnail di percakapan. | P0 |
| F-CHAT-13 | Settings → "Uploads": daftar file yang pernah diunggah per agent, beserta total ukurannya, dan tombol hapus (aksi eksplisit, dengan konfirmasi). | P1 |
| F-CHAT-14 | Jika `terminal.backend` agent berupa container (`docker`, `modal`, dan lain-lain, dibaca lewat `hermes config get`), beri peringatan bahwa file di folder upload mungkin tidak terlihat dari dalam sandbox agent, dan sarankan folder yang di-mount. | P1 |

> Saat spike M5, cek juga apakah `hermes chat` punya flag lampiran bawaan (misalnya untuk gambar/vision). Jika ada, flag itu dipakai di samping blok lampiran.

### 6.8 Agent Settings (F-CFG)

Halaman pengaturan per agent (dibuka dari kartu agent atau menu Agents) dengan empat tab: **Model**, **Soul**, **Memory**, dan **User Profile**.

Semua penulisan mengikuti aturan berikut:
- terjadi hanya setelah user menekan **Save**, dan sebelumnya ditampilkan **diff** (sebelum → sesudah) untuk dikonfirmasi;
- memakai **CLI resmi Hermes** bila tersedia;
- file markdown ditulis lewat SFTP secara atomik (tulis ke file sementara di folder yang sama, lalu rename), dengan permission file asli dipertahankan.

#### 6.8.1 Model AI

Alurnya empat langkah, semuanya lewat CLI resmi Hermes:

1. **Pilih provider.**
   - Preset: OpenRouter, Anthropic, Nous Portal (OAuth), Ollama (lokal).
   - **Custom**: endpoint OpenAI-compatible apa saja.
2. **Isi Base URL dan API key.**
   - Preset sudah mengisi Base URL; nilainya tetap bisa diubah untuk proxy.
   - Custom meminta nama provider dan Base URL.
   - API key dikirim ke Hermes dan tidak pernah dibaca kembali.
3. **Ambil daftar model.** Aplikasi memanggil `GET {base_url}/models` dari VPS, lalu menampilkan hasilnya sebagai daftar model yang bisa difilter.
4. **Pilih model, Test, lalu Save** dengan diff.

Perintah yang dipakai:
- **Baca konfigurasi:** `hermes -p <p> config get model --json` dan `config get agent.reasoning_effort --json`. Nilai yang berbentuk kredensial ditampilkan bertopeng oleh Hermes, misalnya `sk-o…7890`.
- **Provider yang sudah punya kredensial:** `hermes -p <p> status`. Perintah ini tidak mencetak isi key.
- **Simpan provider custom:**
  - `config set providers.<nama>.api <base_url>`
  - `config set providers.<nama>.key_env <NAMA>_API_KEY`
- **Simpan API key:** `config set <ENV_VAR> <key>`. Hermes menulisnya ke `.env` milik profile.
- **Simpan model:** `config set model.provider <slug>`, `config set model.default <model-id>`, dan `config set model.base_url <url>` bila preset diarahkan ke proxy atau endpoint lokal.

| ID | Kebutuhan | Prio |
|---|---|---|
| F-CFG-1 | Tab **Model** menampilkan model saat ini: provider, model ID, reasoning effort, fallback, dan model yang benar-benar dipakai di sesi terakhir (dari `sessions.model`). | P0 |
| F-CFG-2 | **Langkah 1 · Provider:** pilihan preset dan Custom, masing-masing dengan status kredensial ("key saved ✓", "oauth ✓", "no key", atau "needs key"). Memilih provider mengisi Base URL default. | P0 |
| F-CFG-3 | **Langkah 2 · Base URL & API key.** Base URL bisa diedit (untuk Custom wajib diisi; preset boleh diganti ke proxy). Field API key bertipe password. Jika key sudah tersimpan, field menampilkan versi bertopeng dan boleh dikosongkan untuk mempertahankan key lama. Provider tanpa key (Ollama) tidak menampilkan field key. Provider OAuth (Nous) hanya menampilkan info; proses login OAuth tetap dilakukan di terminal. | P0 |
| F-CFG-4 | **Langkah 3 · Fetch models:** `GET {base_url}/models` dijalankan **dari VPS** lewat skrip Python efemeral (stdin), sehingga endpoint yang hanya terjangkau dari VPS ikut bisa didaftar. Key dikirim lewat stdin, bukan argumen. Hasilnya berupa daftar model yang bisa difilter (beserta context length bila tersedia). Jika gagal: tampilkan status HTTP/error, dan Model ID boleh diketik manual. | P0 |
| F-CFG-5 | **Langkah 4 · Simpan:** tampilkan pratinjau perintah (key ditampilkan sebagai `••••`) dan diff konfigurasi, lalu jalankan perintah `config set` di atas, lalu baca ulang dengan `config get` untuk verifikasi. Jika Hermes menolak (validasi skema), tampilkan pesan error-nya apa adanya. Tombol Save nonaktif sebelum model dipilih. | P0 |
| F-CFG-6 | **API key tidak pernah dibaca kembali** oleh aplikasi; yang ditampilkan hanya versi bertopeng dari `config get`. Key tidak disimpan di `app.db` dan tidak masuk log. Field key langsung dikosongkan setelah Save. | P0 |
| F-CFG-7 | Ubah **Reasoning effort** (`agent.reasoning_effort`: off, minimal … ultra) lewat `config set`. | P1 |
| F-CFG-8 | Tombol **Test model:** jalankan `hermes -p <p> chat --oneshot -q "Reply with OK" --format stream-json --source mission-control-test`, lalu periksa event `system` (model yang dipakai) dan `exit_code`. Hasilnya ✓/✗ beserta latensi. | P1 |
| F-CFG-9 | **Kapan berlaku:** model baru berlaku untuk sesi baru. Tombol **"Restart this agent's gateway"** (`hermes -p <p> gateway restart`) hanya me-restart profile tersebut dalam mode multiplex. Ada dialog konfirmasi. | P1 |
| F-CFG-19 | Fallback providers (`fallback_providers`) dan model auxiliary/delegation memakai alur yang sama. | P2 |

> Model per cron job tidak termasuk, karena Hermes tidak menyediakan CLI untuk mengubah model sebuah job.
> **Perlu diverifikasi di spike M6:** apakah `hermes config set` / `hermes auth add` bisa menerima nilai key dari stdin. Jika tidak, key terpaksa dikirim sebagai argumen, sehingga sempat terlihat di `/proc/<pid>/cmdline` oleh user lain di VPS yang sama selama perintah berjalan (biasanya < 1 detik). Risiko ini didokumentasikan di 11.

#### 6.8.2 Soul, Memory & User Profile

| File | Isi | Batas (dari Hermes) |
|---|---|---|
| `SOUL.md` | Persona / identitas agent | Tidak ada batas yang terdokumentasi |
| `memories/MEMORY.md` | Ingatan agent; entri dipisah `§` | 2.200 karakter |
| `memories/USER.md` | Profil user yang dikenal agent; entri dipisah `§` | 1.375 karakter |

| ID | Kebutuhan | Prio |
|---|---|---|
| F-CFG-10 | Tab **Soul**: editor markdown (CodeMirror 6) untuk `SOUL.md` dengan pratinjau berdampingan. Jika file belum ada, tombol "Create SOUL.md". | P0 |
| F-CFG-11 | Tab **Memory** dan **User Profile**: editor berbasis entri. Setiap entri `§` tampil sebagai kartu yang bisa diedit, ditambah, dihapus, dan diurutkan. Ada juga mode "Raw" untuk mengedit teks mentah. | P0 |
| F-CFG-12 | Penghitung karakter dengan batas Hermes (2.200 / 1.375). Tombol Save dinonaktifkan dan diberi tanda merah jika melewati batas. | P0 |
| F-CFG-13 | **Deteksi konflik:** saat membuka editor, catat hash isi file. Sebelum menyimpan, cek ulang. Jika agent mengubah file selama user mengedit (misalnya lewat memory tool), tampilkan diff 3 arah dengan pilihan "Keep mine", "Take theirs", atau gabung manual. Tidak ada penimpaan diam-diam. | P0 |
| F-CFG-14 | Info "Changes apply to new sessions", karena Hermes memuat memory dan soul sebagai snapshot di awal sesi. Ada tautan ke tombol restart gateway (F-CFG-9). | P1 |
| F-CFG-15 | **Undo**: selama aplikasi terbuka, versi sebelum simpan disimpan di memori, sehingga ada tombol "Revert last save". Tidak ada file backup yang ditulis ke VPS maupun ke disk lokal. | P1 |
| F-CFG-16 | Isi editor yang diperbarui otomatis bila file berubah di VPS selama editor tidak sedang diedit, dengan sumber data dari collector. | P1 |
| F-CFG-18 | **Tanpa autosave:** perubahan hanya ada di editor (memori) sampai user menekan Save. Tab diberi tanda ● "unsaved". Peringatan "You have unsaved changes" muncul saat user pindah agent, menutup aplikasi, atau saat koneksi putus. Draft tidak disimpan ke disk lokal. | P0 |
| F-CFG-17 | Ubah nama tampilan agent (`display_name` di `profile.yaml`) lewat CLI resmi, jika Hermes menyediakannya. | P2 |

### 6.9 Desain Visual (F-UI)

**Mockup interaktif:** https://claude.ai/artifact/6XGut2zPpH7aMW35JZ77s8 (8 layar: Connect, Overview, Live Feed, Chat, Server, Cron, Second Brain, Agent Settings). Sejak v1.1 mockup lokal `mockup/index.html` (dibangun dengan `python mockup/build.py`) memuat 12 layar: Dashboard, Launch, Connect, Live feed, Chat, **Sessions**, **Kanban**, **Usage**, Server, **Skills**, **Logs**, Second brain (sejak v1.2 Cron menjadi modal di Dashboard); lihat 6.11–6.19. Layar baru bisa dibuka dengan `?state=loading|empty|error`.

Gayanya **"hacker view"**: tampilan terminal, huruf monospace, panel bergaris dengan judul di garis tepi (`┤ cpu ├`) ala btop, tab bar horizontal dengan shortcut F1–F7 (tanpa sidebar), dan kursor blok `▌` saat streaming. Warna memakai palet **Dracula** (draculatheme.com).

| Token | Hex | Dipakai untuk |
|---|---|---|
| `bg` | `#282A36` | Latar area konten |
| `bg-deep` | `#191A21` | Title bar, blok kode, input editor |
| `bg-panel` | `#21222C` | Sidebar, panel, kartu |
| `line` / `selection` | `#44475A` | Garis panel, baris terpilih, bubble user |
| `comment` | `#6272A4` | Garis aksen dan dekorasi saja (kontras teks hanya ±3:1) |
| `fg` | `#F8F8F2` | Teks utama |
| `fg-dim` | `#A9B2D3` | Label, teks sekunder (turunan Comment yang lebih terang, kontras ≥ 4.5:1) |
| `fg-muted` | `#8B95BD` | Timestamp, catatan kecil (≥ 4.5:1) |
| `green` | `#50FA7B` | Aksen utama, status aktif/ok, nav aktif |
| `cyan` | `#8BE9FD` | Thinking, info, mode read-only |
| `orange` | `#FFB86C` | Tool call, peringatan, unsaved |
| `red` | `#FF5555` | Error, blocked, disconnect |
| `purple` | `#BD93F9` | Judul panel, lampiran, wikilink |
| `pink` | `#FF79C6` | Tag, warna agent |
| `yellow` | `#F1FA8C` | Teks kode / string, path |

| ID | Kebutuhan | Prio |
|---|---|---|
| F-UI-1 | Semua warna berasal dari token di atas (CSS variables), tanpa hex lepas di komponen. | P0 |
| F-UI-2 | Tipografi: **JetBrains Mono** untuk seluruh UI; **VT323** hanya untuk judul layar dan angka besar (misalnya "04/05 agents online"). **Logo dan ikon aplikasi** adalah gambar HMAC (empat huruf blok tebal hijau `#50FA7B` di atas `#21222C`) dari `assets/brand/`, bukan teks; di sidebar tampil sebagai tanda 28 px dengan teks kecil "HERMES AGENT MISSION CONTROL", dan hanya tanda saat sidebar diciutkan. Font dibundel di aplikasi, tidak dimuat dari internet. | P0 |
| F-UI-3 | Warna agent konsisten di semua layar (kartu, feed, cron, graph). Ditetapkan otomatis dari palet dan bisa diubah per agent di Settings. | P1 |
| F-UI-4 | Kontras teks minimal 4.5:1. Warna status juga dibedakan dengan label/ikon, tidak hanya dengan warna. | P0 |
| F-UI-5 | Efek opsional (scanline/CRT glow) bisa dimatikan; default mati. Opsi "reduce motion" mematikan animasi pulse dan kursor berkedip. | P2 |

### 6.9b Terminal Server di Dashboard (F-TERM)

| ID | Kebutuhan | Prio |
|---|---|---|
| F-TERM-1 | Panel **Terminal** di bagian paling bawah Dashboard: shell SSH interaktif (PTY lewat `ssh2` `shell()`) di koneksi yang sama, dirender dengan **xterm.js** (+ fit addon). Mendukung warna, aplikasi TUI (htop, vim), copy/paste, dan resize (mengirim window-change). | P0 |
| F-TERM-2 | Bisa **disembunyikan dan dibuka** (tombol hide/show, shortcut Ctrl+`). Saat disembunyikan, panel menjadi bar tipis, dan sesi shell tetap hidup. | P0 |
| F-TERM-3 | Tinggi terminal bisa **di-drag** (140–520 px) atau diatur dengan tombol panah. | P0 |
| F-TERM-4 | **Disimpan di SQLite (`app.db`, tabel `settings`):** `dashboard.terminalOpen`, `dashboard.terminalHeight`, `dashboard.chatWidth`, dan `dashboard.chatCollapsed`. Disimpan saat toggle dan saat drag selesai, lalu dipulihkan saat aplikasi dibuka. | P0 |
| F-TERM-5 | Peringatan jelas bahwa ini **shell penuh**: perintah dijalankan langsung di VPS sebagai user SSH, tidak read-only. Aplikasi tidak pernah menjalankan perintah otomatis di terminal, dan ketikan user tidak dicatat di log. | P0 |
| F-TERM-6 | Beberapa tab terminal, reconnect otomatis, scrollback 5.000 baris, dan pencarian. | P1 |
| F-TERM-7 | Snippet perintah tersimpan (misalnya `hermes gateway status`) di `app.db`. | P2 |

> Zero-Change: perintah yang diketik user sendiri di terminal termasuk "aksi eksplisit user".

### 6.9c Shell Aplikasi, Pengaturan & Notifikasi (F-SHELL)

| ID | Kebutuhan | Prio |
|---|---|---|
| F-SHELL-1 | **Status bar bawah (ala VS Code)** di semua layar setelah login. Kiri: koneksi (klik untuk membuka pengaturan Connection), latensi, versi Hermes, dan jumlah agent online. Kanan: CPU, memori, lonceng notifikasi (dengan jumlah belum dibaca), ukuran teks, dan tombol Settings. **Sejak v1.3 status bar tidak berisi menu navigasi** (menu ada di sidebar, F-R13-1). | P0 |
| F-SHELL-2 | **Modal Settings** dengan tab General, Connection, Notifications, Alerts, Agents, Workspace, Data, dan About. Tutup dengan Esc, klik backdrop, atau tombol ×. Semua nilai disimpan di `app.db`. | P0 |
| F-SHELL-3 | **General:** launch at login (auto start), start minimized, tetap jalan di tray saat ditutup, cek update otomatis, density (compact 12 px / comfortable 13 px), reduce motion. | P0 |
| F-SHELL-4 | **Notifications:** balasan atau chat baru dari agent, cron gagal, gateway mati atau agent offline, serah-terima kanban, preview isi pesan, suara, do-not-disturb (rentang jam). Notifikasi tampil sebagai toast di dalam aplikasi dan sebagai notifikasi native OS yang **tetap muncul di atas aplikasi lain** saat aplikasi di latar belakang, diminimalkan, atau di tray (F-R13-4). Ada daftar riwayat notifikasi di lonceng. | P0 |
| F-SHELL-5 | **Alerts** dengan ambang yang bisa diatur dan durasi minimum: CPU > x %, memori > x %, disk > x %, load (1m) > x, **biaya harian semua agent > x USD (v1.1, dari `sessions.estimated_cost_usd`/`actual_cost_usd`)**, gateway mati, agent offline, cron gagal. | P0 |
| F-SHELL-6 | **Agents:** urutan agent (drag & drop) dan **foto profil per agent** yang dipilih dari komputer, di-crop jadi 96×96, dan disimpan di `app.db`. Foto tidak dikirim ke VPS dan tidak mengubah `profile.yaml` atau konfigurasi Hermes. | P0 |
| F-SHELL-7 | **Workspace:** path vault, interval cek vault, folder dan batas ukuran upload, Hermes home. **Data:** reset layout, ekspor/impor pengaturan, hapus cache lokal. | P1 |

### 6.9d Dashboard: interaksi & tata letak (revisi v0.9)

| ID | Kebutuhan | Prio |
|---|---|---|
| F-DASH-1 | Tinggi Dashboard selalu sama dengan tinggi jendela, tanpa scrollbar halaman. Panel yang isinya panjang (Cron, Activity, Chat) di-scroll di dalam panelnya. Cron punya tinggi tetap; Activity mengisi sisa tinggi. | P0 |
| F-DASH-2 | **Urutan agent bisa di-drag & drop** di bagian Pinned panel Agents. Urutan disimpan di `app.db` dan dipakai juga di layar Chat, Kanban, rail agent yang diciutkan, dan modal Settings. | P0 |
| F-DASH-3 | Baris agent di roster hanya menampilkan foto/inisial, nama, dan status (WORKING / IDLE / PARKED). Titik biru menandai pesan baru yang belum dibaca. | P0 |
| F-DASH-4 | Section Server dan Terminal bisa disembunyikan atau dibuka lewat tombol ikon (chevron). Saat Server tersembunyi, headernya tetap menampilkan ringkasan cpu/mem/disk/net. Statusnya disimpan di `app.db`. | P0 |
| F-DASH-5 | Balasan agent dirender sebagai markdown (paragraf, list, `code`, **bold**, heading, code block), tidak pernah sebagai teks mentah. | P0 |
| F-DASH-6 | Graph View secara default menampilkan seluruh node (fit), ada tombol "fit all", dan kanvasnya menyesuaikan ukuran panel. Saat panel kecil, legenda dan kartu detail disembunyikan otomatis. | P0 |
| F-DASH-7 | Tinggi awal terminal menyesuaikan tinggi layar (±17 %, 100–200 px). | P1 |
| F-DASH-8 | Pembatas antara Cron dan Activity bisa di-drag naik/turun (atau digeser dengan tombol panah) untuk mengatur tinggi Cron (90–560 px); Activity mengisi sisa tinggi. Disimpan di `app.db` (`dashboard.cronHeight`). Semua drag pembatas memperhitungkan zoom teks. | P0 |
| F-DASH-9 | Panel Activity dan Alerts selalu diurutkan **terbaru di atas**; event baru masuk di baris paling atas dengan animasi. | P0 |
| F-DASH-10 | **Motion chat:** pesan yang dikirim naik dari composer (≈400 ms, sedikit memantul) dan ikon tombol kirim "terbang" lalu kembali. Balasan agent didahului indikator mengetik (tiga titik dengan warna agent), lalu bubble masuk dari kiri (≈340 ms) dengan tepi yang berkedip hijau sekali. Saat chat agent tertutup, titik belum-dibaca muncul (pop) dan toast tampil. Riwayat yang sudah ada saat layar dibuka tidak dianimasikan. Berlaku di Dashboard dan layar Chat, dan mengikuti opsi Reduce motion. | P1 |
| F-DASH-11 | **Panel Agents untuk armada besar (20+ agent).** Panel dibagi dua: **roster** padat (±30 px per baris, scroll di dalam, tinggi maks. 40 % panel saat chat terbuka) dan **satu chat room** untuk agent yang dipilih, mengisi sisa tinggi. Accordion multi-buka diganti master-detail. Roster berisi grup **Pinned** (urutan drag & drop, F-DASH-2) lalu **All agents** (urut WORKING → IDLE → PARKED, lalu nama). Dengan ≤ 6 agent tampilannya hanya satu daftar tanpa judul grup dan tanpa kotak cari. | P0 |
| F-DASH-12 | **Cari agent** (muncul bila agent > 6): kotak cari memfilter nama tampilan dan nama profile, hasilnya satu daftar datar bernama *Results · N* (drag dinonaktifkan). Enter membuka agent pertama, Esc atau tombol × menghapus kata kunci. Tidak ada hasil → pesan "No agent matches …". | P0 |
| F-DASH-13 | **Pin agent:** tombol pin di tiap baris (muncul saat hover/fokus, tetap terlihat bila sudah dipin). Pin disimpan di `app.db` (`agent_pins`), bawaan 5 agent pertama, dan tidak pernah mengubah config Hermes. | P0 |
| F-DASH-14 | **Rail yang diciutkan** hanya menampilkan agent yang dipin, ditambah agent yang sedang dibuka atau punya pesan belum dibaca, dan tombol **+N** (N = agent lain) yang membuka panel penuh. Rail bisa di-scroll bila tetap melebihi tinggi layar. Header menghitung `online/total` dari data nyata, bukan angka tetap. | P0 |

### 6.9e Gaya visual (revisi v0.9)

- **Font lebih kecil:** dasar 12 px (opsi comfortable 13 px), metadata 10–11 px.
- **Ikon:** satu set ikon SVG ber-stroke seragam untuk semua tombol yang bisa diwakili ikon, misalnya paperclip untuk attach, send, stop, settings, chevron untuk hide/show, external untuk membuka layar penuh, trash, plus, dan panel-left/right. Glyph Unicode (●, ▾, ▲, ━) tidak dipakai sebagai pengganti ikon. Titik status dibuat dengan CSS.
- **Scrollbar, seleksi teks, dan caret** mengikuti palet Dracula (tipis, thumb `#44475A`).
- **Navigasi tidak pernah scroll:** menu di status bar memakai ikon dengan tooltip, label hanya untuk item aktif kecuali di jendela lebar (F-NAV-3/4). *(Semula untuk tab bar, v1.1 untuk rail, sejak v1.2 untuk status bar.)*
- **Animasi:** 150–320 ms ease-out untuk masuk panel, buka accordion chat, modal (fade + scale), toast (slide), switch tab, item feed baru, dan hover/press tombol. Tidak ada animasi yang berulang tanpa henti selain indikator yang menandai state aktif (titik mengalir di interaksi yang sedang aktif). Pulse untuk catatan baru berhenti setelah 3 kali. Bisa dimatikan dengan opsi *Reduce motion* atau `prefers-reduced-motion`.
- **Teks dihapus:** "layout saved → app.db", "full shell — commands run on your VPS…", "read-only", "remote hash…", catatan autosave, dan pesan kosong "No chat from Mission Control yet…".
- **Second Brain:** panel kiri (kontrol) dan kanan (preview) bisa disembunyikan; statusnya disimpan di `app.db`.

### 6.9f Revisi v1.0: navigasi, Agents di Settings, graph ala Obsidian, ukuran teks

| ID | Kebutuhan | Prio |
|---|---|---|
| F-R10-1 | Menu/tab **Agents dihapus**. Semua pengaturan per agent ada di **Settings → Agents**. Daftar agent di kiri bisa di-drag untuk mengatur urutan. Di kanan ada sub-tab **Profile** (foto lokal), **Model** (provider → Base URL → API key → fetch models → pilih model, reasoning effort, test, save), **Soul** (editor dan preview markdown), **Memory**, dan **User profile** (editor entri dengan batas karakter, revert, dan diff sebelum menulis ke VPS). Tombol gear di panel agent Dashboard membuka tab ini. Navigasi antar layar: **menu di status bar** (F-NAV-1, v1.2; sebelumnya icon rail v1.1 dan tab bar F1–F6). | P0 |
| F-R10-2 | Path vault tidak ditampilkan di UI (Second Brain dan Dashboard); path hanya diatur di Settings → Workspace. | P0 |
| F-R10-3 | **Warna node:** semua catatan **hijau** (`#50FA7B`), node **tag abu-abu** (`#8B95BD`) dan ditampilkan sebagai node yang terhubung ke catatan yang memakainya, link yang belum ada (unresolved) berupa lingkaran putus-putus abu-abu. Tidak ada color group per folder secara default. | P0 |
| F-R10-4 | **Interaksi graph mengikuti Obsidian:** drag node (simulasi gaya: pegas link, tolakan antar-node; node yang dilepas tetap di tempat dan tetangganya menyesuaikan), scroll untuk zoom ke arah kursor (15 %–400 %), drag area kosong untuk pan, hover untuk menyorot node dan tetangganya (yang lain diredupkan), klik untuk membuka preview catatan, label memudar saat zoom out dan label catatan kecil muncul saat zoom in, tombol "fit" untuk kembali melihat semua node. Tampilan awal selalu fit ke seluruh node. Berlaku di Dashboard dan halaman Second Brain. | P0 |
| F-R10-5 | **Ukuran teks:** tombol **− / persen / +** di status bar (di samping Settings), langkah 10 %, rentang 70 %–150 %, klik angka persen untuk reset ke 100 %. Juga tersedia di Settings → General → Text size, dan pintasan Ctrl + / Ctrl −. Disimpan di `app.db`. Di aplikasi asli diterapkan lewat `webContents.setZoomFactor`, sehingga seluruh UI ikut diskalakan tanpa memunculkan scrollbar. | P0 |

### 6.10 Umum (F-APP)

| ID | Kebutuhan | Prio |
|---|---|---|
| F-APP-1 | **Dashboard satu layar** (mengikuti wireframe user) sebagai layar utama. Kolom kiri: logo + status koneksi, panel **Cron Jobs**, dan panel **Live Activity** (tab Activity / Alerts). Kolom tengah: strip **Server Monitor** di atas dan **Graph View** second brain berukuran besar. Kolom kanan: panel **Agents & chat** berbentuk *accordion*. Klik kartu agent untuk membuka chat room-nya di bawah kartu (pesan, thinking, chip tool, input, attach); klik lagi untuk menutup. Hanya satu chat yang terbuka sekaligus. Panel bisa **diciutkan** (») menjadi rail 64 px berisi inisial dan titik status tiap agent; klik agent di rail untuk membuka panel langsung ke chat-nya. Lebar panel bisa **di-drag** lewat handle di tepi kirinya, atau digeser dengan tombol panah (280–640 px). Lebar dan status ciut/terbuka disimpan di `app.db`. Setiap panel punya tombol untuk membuka tampilan detailnya: modal Live feed dan modal Cron (v1.2), Server, Second Brain, Chat, dan Agent Settings. **Navigasi (revisi v1.2):** semua menu ada di status bar bawah (F-NAV-1, F-R12-1); panel Cron dan Activity membuka modal (F-R12-3/4). Di layar sempit, ketiga kolom Dashboard bertumpuk. | P0 |
| F-APP-2 | Tema Dracula (6.9) sebagai satu-satunya tema di v1. Seluruh teks UI dalam **bahasa Inggris**. | P0 |
| F-APP-3 | Installer per OS: Windows (`.exe` NSIS), macOS (`.dmg`, universal arm64 + x64), Linux (`.AppImage` dan `.deb`). | P0 |
| F-APP-4 | Log aplikasi lokal di folder `logs/` milik userData untuk troubleshooting. Log tidak boleh berisi password. | P1 |
| F-APP-5 | Semua pengaturan aplikasi disimpan di **SQLite lokal** (`app.db`, lihat 8.4), termasuk ukuran dan posisi jendela, tab terakhir, filter, dan pengaturan graph. Ada menu "Reset settings" dan "Forget this connection". | P0 |
| F-APP-6 | Auto-update lewat `electron-updater`. | P2 |

### 6.11 Navigasi: Icon Rail & Command Palette (F-NAV) — v1.1

**Mockup:** `mockup/*.html` (menu di status bar semua layar; buka `Main.html`, tekan Ctrl+K).

| ID | Kebutuhan | Prio |
|---|---|---|
| F-NAV-1 | **(Revisi v1.2)** Semua menu ada di **status bar bawah**, di kanan tombol koneksi, dengan urutan: Dashboard, Chat, Live feed, Sessions, Kanban, Usage, Skills, Logs, Second brain, Server; lalu pemisah, **Terminal**, dan Search (membuka palette). Cron tidak lagi menjadi menu (F-R12-3). CPU/memori, notifikasi, ukuran teks, dan Settings tetap di kanan status bar. Rail kiri v1.1 dihapus. | P0 |
| F-NAV-2 | Item aktif ditandai latar, ikon hijau, garis hijau di tepi atas, label tebal, dan `aria-current="page"`. Status aktif tidak hanya dibedakan lewat warna (F-UI-4). | P0 |
| F-NAV-3 | **(Revisi v1.2)** Item non-aktif hanya menampilkan ikon dengan tooltip (nama + pintasan); item aktif dan Terminal menampilkan label. Di jendela ≥ 1640 px semua label tampil; di bawah 820 px semua item ikon saja. | P0 |
| F-NAV-4 | Menu di status bar **tidak pernah scroll atau terpotong**: lebar dijaga lewat aturan label F-NAV-3. Jika ukuran teks besar membuatnya tetap tidak muat, item paling kanan (Second brain, Server) dilipat ke menu "More". *(Pelipatan belum ada di mockup.)* | P1 |
| F-NAV-5 | **Badge** pada item: Chat (pesan belum dibaca, cyan), Logs (baris ERROR dalam 1 jam terakhir, oranye). Job cron yang gagal ditandai di panel Cron Dashboard. `aria-label` item menyebut jumlahnya. | P1 |
| F-NAV-6 | Pintasan **Ctrl+1 … Ctrl+0** (Cmd di macOS) mengikuti urutan menu di status bar; Ctrl+` membuka/menutup terminal. | P1 |
| F-NAV-7 | **Command palette** (Ctrl+K atau tombol Search): satu kotak untuk berpindah ke layar, membuka chat dengan agent, membuka pengaturan agent (model, soul, memory), melompat ke sesi (judul), ke catatan vault, atau menjalankan aksi (buka/tutup terminal, buka Settings, buka modal Cron, "show errors from the last hour", "show today's cost"). ↑ ↓ memilih, Enter membuka, Esc menutup. Indeks sesi dan catatan dibangun lokal dari data yang sudah dibaca, tanpa permintaan baru ke VPS. Hasil kosong menjelaskan apa yang bisa dicoba. | P1 |
| F-NAV-8 | **Filter bersama:** pilihan agent dan rentang waktu dipakai bersama oleh Sessions, Usage, Logs, dan Skills (agent) dan disimpan di `app.db` (`filters.agent`, `filters.range`), sehingga user tidak mengatur ulang di tiap layar. | P1 |

### 6.12 Sessions (F-SESS) — v1.1

Sumber data: `state.db` per profile, **read-only**: tabel `sessions` (`title`, `source`, `model`, `started_at`, `ended_at`, `end_reason`, `message_count`, `tool_call_count`, token, biaya, `parent_session_id`, `pinned`, `archived`) dan `messages` (hanya `active=1`). Pencarian memakai tabel FTS `messages_fts` (FTS5) milik Hermes.

| ID | Kebutuhan | Prio |
|---|---|---|
| F-SESS-1 | Daftar sesi terbaru di atas dengan judul, agent (warna agent), chip `source`, jumlah pesan dan tool call, biaya (ditandai "est." bila perkiraan), dan waktu relatif. Sesi yang di-pin ditandai. Status: running (belum ada `ended_at`), ended, failed (`end_reason` error), compressed (punya anak). | P0 |
| F-SESS-2 | Filter agent (chip), `source`, dan rentang waktu. **Pencarian isi pesan** lewat `messages_fts` dengan debounce 250 ms dan `LIMIT 200`, menampilkan potongan teks dengan kata yang cocok disorot. Bila tabel FTS tidak ada (skema lama), pencarian turun ke judul sesi dengan catatan jelas. | P0 |
| F-SESS-3 | **Transkrip** di panel kanan: pesan user, balasan agent (markdown disanitasi, F-DASH-5), langkah *thinking* (dari `reasoning`/`reasoning_content`) yang bisa dibuka, dan tool call sebagai chip berisi nama, ringkasan argumen, dan durasi perkiraan (selisih waktu antara baris panggilan dan baris hasil). Chip bisa dibuka untuk melihat input dan output; hasil error berwarna merah dengan label. | P0 |
| F-SESS-4 | Rantai sesi lewat `parent_session_id`: "continues …" dan "continued in …" sebagai tautan. | P1 |
| F-SESS-5 | Aksi: **Continue in Chat** (memakai `--resume <session_id>`, F-CHAT), **Pin/Unpin** (`hermes -p <p> sessions pin|unpin <id>`), **Rename** (`hermes -p <p> sessions rename <id> "<judul>"`), masing-masing dengan pratinjau perintah dan konfirmasi. **Export** (jsonl, markdown, html) dibuat **lokal** dari baris yang sudah dibaca dan disimpan di komputer user; `hermes sessions export` tidak dipakai karena menulis file di VPS. Menghapus sesi tidak disediakan. | P1 |
| F-SESS-6 | State: loading (kerangka baris), empty ("belum ada sesi" dan "tidak ada hasil" dengan tombol hapus filter), error (state.db terkunci atau tidak terbaca: penyebab, tombol retry, data terakhir tetap tampil dengan usianya), versi skema tidak didukung. | P0 |
| F-SESS-7 | Performa: daftar di-virtualisasi; transkrip dimuat per 200 pesan; tidak pernah memuat semua pesan sekaligus. Pembacaan memakai `?mode=ro` dan tidak menahan lock. | P0 |

### 6.13 Usage: Biaya & Tool Call (F-USAGE) — v1.1

Sumber data: kolom `sessions.input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`, `estimated_cost_usd`, `actual_cost_usd`, `cost_status`, `billing_provider`, `model`, tabel `session_model_usage`, dan baris tool di `messages`. Semua read-only.

| ID | Kebutuhan | Prio |
|---|---|---|
| F-USAGE-1 | Tab **Cost**: grafik batang bertumpuk per hari per agent (7/14/30 hari) dengan sumbu-Y berskala rapi, satu garis ringkasan ("total · rata-rata per hari · hari ini") tanpa kartu angka besar. Klik batang untuk mengunci satu hari; tabel di bawahnya mengikuti. | P0 |
| F-USAGE-2 | Garis ambang dari alert **biaya harian** (Settings → Alerts, F-SHELL-5). Hari yang melewati ambang diberi garis oranye dan disebut di atas grafik dengan tautan ke Sessions. | P0 |
| F-USAGE-3 | Tabel **by agent** (sesi, token masuk, keluar, cache read, biaya, porsi) dan **by model** (provider, panggilan API, biaya). | P0 |
| F-USAGE-4 | Aturan biaya: pakai `actual_cost_usd` bila ada, jika tidak `estimated_cost_usd` dengan tanda "est."; `cost_status` yang tidak dikenal ditampilkan "—". Provider langganan atau OAuth bisa bernilai $0.00 dan UI menjelaskannya. | P0 |
| F-USAGE-5 | Tab **Tools**: per tool jumlah panggilan, batang proporsi, persentase gagal, rata-rata waktu (perkiraan), terlama, terakhir dipakai; bisa diurutkan menurut panggilan, error, atau waktu. Panel detail berisi panggilan per agent dan kegagalan terbaru yang menaut ke Sessions. Kegagalan dideteksi dari teks hasil (usaha terbaik, dinyatakan di UI). | P1 |
| F-USAGE-6 | Filter agent dan rentang memakai filter bersama (F-NAV-8). State loading, empty, dan error mengikuti F-STATE. | P0 |

### 6.14 Cron: Kontrol & Riwayat Run (F-CRON-7..14) — v1.1

Melengkapi 6.4. Aksi tulis memakai CLI resmi, dengan pratinjau perintah dan konfirmasi di dalam panel detail. **Sejak v1.2 seluruh isi ini tampil di modal Cron yang dibuka dari panel Cron di Dashboard, bukan di layar tersendiri (F-R12-3).**

| ID | Kebutuhan | Prio |
|---|---|---|
| F-CRON-7 | **Pause / Resume:** `hermes -p <agent> cron pause|resume <job>`. Job direferensikan dengan nama atau id. Nama bersifat case-insensitive dan Hermes menolak nama yang ambigu; pesan penolakannya ditampilkan apa adanya. | P0 |
| F-CRON-8 | **Run now:** `hermes -p <agent> cron run <job>`. Konfirmasi menyebut bahwa run memakai token, bisa mengirim pesan, dan jadwal reguler tidak berubah. | P0 |
| F-CRON-9 | **Ubah jadwal:** `hermes -p <agent> cron edit <job> --schedule "<ekspresi>"`. Validasi dilakukan Hermes; berlaku pada tick berikutnya (gateway men-tick tiap 60 detik). | P1 |
| F-CRON-10 | **Riwayat run:** enam run terakhir dari `hermes -p <agent> cron runs <job> --limit 6` (waktu, pemicu scheduled/manual, durasi, status). Memilih run menampilkan outputnya dari `cron/output/<job_id>/<timestamp>.md` dengan **diff terhadap run sebelumnya** (baris baru hijau, baris hilang merah). Format nama file timestamp tidak terdokumentasi, sehingga file diurutkan menurut waktu modifikasi. | P1 |
| F-CRON-11 | **Insiden:** dari `hermes cron incidents` (state alerted, detected, resolved, closed). Job dengan insiden terbuka menampilkan "failed N runs in a row" dan tombol **Acknowledge** (`cron incidents ack <id>`). Insiden menutup sendiri setelah run berikutnya berhasil. | P1 |
| F-CRON-12 | Hitungan di header (jumlah job, running, error, paused) ikut berubah setelah aksi. Status job dibedakan dengan label, bukan hanya warna. | P0 |
| F-CRON-13 | Tidak termasuk: membuat atau menghapus job dari aplikasi (dilakukan lewat chat dengan agent atau terminal). | — |
| F-CRON-14 | Job yang sedang running tidak bisa di-run-now lagi; tombolnya dinonaktifkan dengan penjelasan. | P2 |

### 6.15 Skills (F-SKILL) — v1.1

Sumber data (read-only): `~/.hermes/skills/` (profile bernama: `~/.hermes/profiles/<nama>/skills/`) dengan struktur `<kategori>/<skill>/SKILL.md`, serta `skills/.usage.json`, `.curator_ledger.jsonl`, `.bundled_manifest`, dan `.hub/lock.json`. Lokasi diverifikasi ke dokumentasi (13.1).

| ID | Kebutuhan | Prio |
|---|---|---|
| F-SKILL-1 | Tab **Library**: skill per agent dengan `kategori/nama`, deskripsi (frontmatter), chip asal — **agent-written** (`.usage.json` memuat `created_by: agent` dan nama tidak ada di `.bundled_manifest` maupun `.hub/lock.json`), **from hub**, **bundled** — status (active, stale, archived), penanda pin, jumlah pemakaian, dan terakhir dipakai. | P0 |
| F-SKILL-2 | Filter Active, Agent-written, Hub, Bundled, Stale, Archived (dengan jumlah) dan pencarian nama, deskripsi, tag. | P0 |
| F-SKILL-3 | Detail: fakta frontmatter (versi, platform, tag, `requires_toolsets`, **nama** variabel environment yang dibutuhkan, tanpa nilai), fakta pemakaian dari `.usage.json` (`use_count`, `view_count`, `patch_count`, `created_at`, `last_used_at`, `created_by`, `state`), dan isi `SKILL.md` yang dirender dan disanitasi. | P0 |
| F-SKILL-4 | **Pin/Unpin** (`hermes -p <p> curator pin|unpin <nama>`) dan **Archive/Restore** (`curator archive|restore <nama>`) dengan pratinjau perintah dan konfirmasi. Tidak ditawarkan untuk skill bundled. | P1 |
| F-SKILL-5 | **Install from hub:** `hermes -p <p> skills inspect <id>` lalu `skills install <id>`; pemindaian keamanan Hermes tetap berlaku. `--force` tidak pernah dipakai. | P1 |
| F-SKILL-6 | Tab **Changes:** isi `.curator_ledger.jsonl` (aktor curator/agent/user, aksi, skill, catatan) dengan diff yang bisa dibuka bila blob tersedia di `.curator_backups/`; status curator dari `hermes curator status`. | P1 |
| F-SKILL-7 | Batas yang dinyatakan di UI: `created_by` adalah penanda kebijakan, bukan bukti penulis; **tidak ada enable/disable per skill** karena perintahnya tidak terdokumentasi; skill dari `skills.external_dirs` atau folder proyek hanya muncul bila ada di keluaran `hermes skills list`. | P0 |

### 6.16 Logs, Gateway & Approvals (F-LOG) — v1.1

Satu layar dengan tiga sub-tab.

| ID | Kebutuhan | Prio |
|---|---|---|
| F-LOG-1 | Tab **Logs:** pilih berkas `agent.log`, `errors.log`, `gateway.log`, dan `tool_calls.log` (hanya bila ada; berkas terakhir muncul bila `display.tool_progress: log`) dari `~/.hermes/logs/` atau `profiles/<nama>/logs/`. Dibaca lewat `tail` di SSH, tidak pernah menulis. Setara dengan `hermes logs <nama> -n N`. | P0 |
| F-LOG-2 | Filter level (DEBUG mati secara default), komponen (gateway, agent, tools, cli, cron), rentang (15 menit sampai 24 jam), pencarian dengan sorotan, dan agent. Level selalu ditulis sebagai teks, tidak hanya warna. | P0 |
| F-LOG-3 | **Follow:** baris baru mengalir dan daftar mengikuti ke bawah. Membuka sebuah baris atau jeda menghentikan follow; muncul tombol "N new lines" untuk lompat ke terbaru. Ada tombol Wrap dan detail baris yang bisa dibuka. Logs memakai urutan kronologis (terbaru di bawah), berbeda dari Activity (F-DASH-9), karena ini konvensi tail. | P0 |
| F-LOG-4 | Hermes sudah menyamarkan rahasia di berkas log; aplikasi menambahkan penyamaran pola token saat menampilkan dan tidak menyalin teks mentah. | P0 |
| F-LOG-5 | Tab **Gateway:** status proses dari `gateway_state.json` (`gateway_state`, `updated_at` sebagai heartbeat yang diperbarui tiap 60 detik dan dianggap basi bila > 120 detik, `served_profiles`, `exit_reason`) dan baris per profile dan platform (running, paused-by-breaker, fatal, degraded, parked) beserta detail. Field per platform **tidak terdokumentasi lengkap**: parser toleran dan field yang tidak dikenal ditampilkan apa adanya. | P0 |
| F-LOG-6 | Aksi gateway per profile: **Restart** (`hermes -p <p> gateway restart`, menunggu giliran yang sedang berjalan selesai) dan **Stop** (`gateway stop`), dengan pratinjau perintah dan konfirmasi. **Start tidak disediakan**; user memulai lewat terminal atau systemd. | P1 |
| F-LOG-7 | Tab **Approvals** (read-only): kebijakan per agent dari config (`approvals.mode`, `cron_mode`, `single_query_mode`, `unattended_mode`, `timeout`, daftar `deny`, `command_allowlist`) dan daftar "perintah yang terus disetujui" dari `hermes approvals suggest --days 30` (hanya tombol Copy command). Untuk mengubah kebijakan, user memakai terminal. Aplikasi tidak pernah mengubah mode menjadi `off`, memakai `--yolo`, atau menambah allowlist. | P1 |
| F-LOG-8 | Dinyatakan di UI: Hermes **tidak menyimpan log keputusan approve/deny**, sehingga tidak ada riwayat keputusan dan tidak ada daftar approval yang menunggu (dijawab di chat atau aplikasi pesan tempat agent bertanya). | P0 |
| F-LOG-9 | Badge: tab Logs (jumlah ERROR dalam 1 jam), tab Gateway (jumlah platform bermasalah). | P1 |

### 6.17 Memory Timeline (F-MEMT) — v1.1

Sub-tab **Memory timeline** di layar Second brain. Tujuannya melihat apa yang dipelajari atau diubah agent pada `MEMORY.md`, `USER.md`, dan `SOUL.md`.

| ID | Kebutuhan | Prio |
|---|---|---|
| F-MEMT-1 | Pilih agent dan berkas; daftar versi dikelompokkan per hari, masing-masing dengan jam, penulis, jumlah entri ditambah dan dihapus, dan jumlah karakter terhadap batas (MEMORY 2.200, USER 1.375; SOUL tanpa batas). | P1 |
| F-MEMT-2 | **Snapshot lokal:** selama terhubung, collector membaca ketiga berkas dan membandingkan hash tiap ±30 detik; setiap perubahan disimpan sebagai versi di `app.db` (tabel `memory_snapshots`, 8.4). Perubahan yang terjadi saat aplikasi tertutup dicatat sebagai satu versi berlabel "while away". Retensi: 200 versi per berkas atau 180 hari. Tidak ada yang ditulis ke VPS. | P1 |
| F-MEMT-3 | **Penulis (perkiraan):** "agent" bila ada sesi dengan tool `memory` dalam ±2 menit dari perubahan; "you" bila ditulis lewat aplikasi (aksi lokal dicatat tanpa isi); selain itu "while away". Dinyatakan sebagai perkiraan di UI. | P1 |
| F-MEMT-4 | Panel diff untuk versi terpilih terhadap versi sebelumnya: tingkat entri untuk MEMORY dan USER (dipisah `§`), tingkat baris untuk SOUL; entri yang tidak berubah dilipat dengan tombol "Show N unchanged". Versi pertama diberi penjelasan. | P1 |
| F-MEMT-5 | **Restore in the editor:** memuat versi ke editor Settings → Agents (F-CFG-10..18) untuk ditinjau; penyimpanan tetap lewat diff dan cek hash (F-CFG-13). Tidak ada penimpaan satu klik. | P1 |
| F-MEMT-6 | Tombol Copy this version; Settings → Data mendapat "Clear snapshots". | P2 |

### 6.18 Settings → Agents: MCP, Toolsets, Fallback, Backup, Profile Baru (F-CFG-19..26) — v1.1

Urutan sub-tab: Profile, Model, Soul, Memory, User profile, **MCP, Toolsets, Fallback, Backup**. Di bawah daftar agent ada tombol **New profile**.

| ID | Kebutuhan | Prio |
|---|---|---|
| F-CFG-19 | Semua perubahan di bagian ini berlaku untuk sesi baru; catatan itu ditampilkan, plus tombol restart gateway (F-LOG-6) untuk chat yang sedang berjalan. | P0 |
| F-CFG-20 | **MCP:** daftar dari `hermes -p <p> mcp list` (nama, transport, perintah atau URL, status, jumlah tool). Hanya **nama** variabel env dan header yang ditampilkan; config.yaml bisa memuat token inline, sehingga file itu tidak dibaca mentah. **Test** menjalankan `hermes mcp test <nama>` (menyalakan server sekali, atas aksi user). **Add/Remove** hanya mengisi perintah `hermes mcp add|remove` di terminal; user menekan Enter sendiri. | P1 |
| F-CFG-21 | **Toolsets:** matriks toolset × platform dari `hermes -p <p> tools --summary` (nama dibaca dari keluaran, tidak ditulis keras). Perubahan ditahan dulu (kotak oranye), lalu **Apply** menjalankan `hermes tools enable|disable <toolset> --platform <p>` satu per satu setelah daftar perintahnya ditampilkan. Toolset `kanban` tidak aktif oleh `all`. Perintah `disable` belum terlihat eksplisit di dokumentasi dan diverifikasi saat capability detection (F-STATE-6). | P1 |
| F-CFG-22 | **Fallback:** daftar `fallback_providers` (provider dan model, dicoba berurutan) dari `hermes fallback list`. Add/Remove memakai picker Hermes di terminal (perintah diisi, user menekan Enter). | P2 |
| F-CFG-23 | **Backup:** unduhan **SFTP** ke zip lokal: `SOUL.md`, `memories/`, `profile.yaml`, `config.yaml` (nilai `env`, `headers`, dan kunci API dikosongkan di sisi lokal sebelum disimpan), `cron/jobs.json`, `skills/`, dan opsional `state.db` (besar, mati secara default). **Tidak pernah**: `.env`, `auth.json`, `mcp-tokens/`. Tidak ada yang ditulis di VPS. Restore dilakukan manual atau `hermes import` di terminal. | P1 |
| F-CFG-24 | **New profile:** nama (`^[a-z][a-z0-9-]{1,23}$` dan belum dipakai), deskripsi, mulai dari kosong atau salinan (`--clone-from`), opsi `--no-skills`; pratinjau `hermes profile create …`; tombol Create adalah aksi eksplisit. | P1 |
| F-CFG-25 | Kebijakan approval **tidak** diedit di sini; hanya ditampilkan di Logs → Approvals (F-LOG-7). | P0 |
| F-CFG-26 | Tombol "… in the terminal" membuka terminal dan mengisi perintahnya saja. Aplikasi tidak pernah menekan Enter atas nama user (F-TERM-5). | P0 |

### 6.19 State, Konsistensi & Deteksi Kemampuan (F-STATE) — v1.1

| ID | Kebutuhan | Prio |
|---|---|---|
| F-STATE-1 | Setiap layar data punya empat state yang dirancang: **loading** (kerangka baris atau batang, bukan spinner di tengah), **empty** (menjelaskan penyebab dan langkah berikutnya), **error** (penyebab spesifik, tombol retry, data terakhir tetap tampil), dan **unsupported** ("Not available on Hermes vX", fitur dimatikan tanpa membuat layar lain rusak). | P0 |
| F-STATE-2 | Data basi atau saat offline tetap ditampilkan dengan usianya, bukan dikosongkan. | P0 |
| F-STATE-3 | Aksi tulis selalu: pratinjau perintah → konfirmasi (dalam panel, bukan modal, kecuali butuh fokus penuh) → toast hasil → catatan lokal tanpa isi. Kosakata tombol konsisten: utama hijau, sekunder outline, destruktif outline merah. | P0 |
| F-STATE-4 | Alat tinjau desain: setiap layar baru bisa dibuka dengan `?state=loading`, `?state=empty`, atau `?state=error` di mockup (Brain: `?tab=timeline`). | P2 |
| F-STATE-5 | Aksesibilitas: peran `tablist`/`tab`, `listbox`/`option`, `aria-pressed` untuk toggle, `aria-sort` untuk kolom, semua bisa dioperasikan keyboard dengan fokus yang terlihat; kontras ≥ 4,5:1; Reduce motion dihormati. | P0 |
| F-STATE-6 | **Deteksi kemampuan** saat connect: `hermes --version` lalu probe sekali untuk subperintah yang dipakai (`cron runs`, `curator status`, `sessions list`, `tools --summary`, `fallback list`, `mcp list`, `approvals suggest`). Fitur yang tidak ada dimatikan dengan penjelasan; hasilnya terlihat di tooltip status bar. Alasannya: dokumentasi Hermes tidak diberi versi, jadi tidak boleh diasumsikan bahwa v0.21.x punya semuanya. | P0 |

### 6.20 Revisi v1.2: menu di status bar, modal Cron & Activity, Kanban

**Mockup:** `mockup/*.html` (`python mockup/build.py`). Menu ada di status bar semua layar; Dashboard membuka modal Cron dan Live feed; layar baru `Kanban.html`.

| ID | Kebutuhan | Prio |
|---|---|---|
| F-R12-1 | **Menu di status bar** menggantikan icon rail (F-NAV-1..6 direvisi). | P0 |
| F-R12-2 | **Terminal** dibuka lewat ikon terminal di status bar (dan Ctrl+`), bukan lagi section di Dashboard. Panel terminal muncul di atas status bar, menempel penuh selebar jendela, pada **lapisan (z-index) yang sama dengan status bar**, bisa diubah tingginya dengan drag atau panah, dan tersedia di semua layar. Status terbuka dan tingginya disimpan di `app.db`. Esc menutupnya jika tidak ada lapisan lain yang terbuka. | P0 |
| F-R12-3 | **Menu Cron dihapus.** Klik panel Cron di Dashboard (judul, tombol ⤢, atau baris job) membuka **modal Cron** berisi semua isi 6.14: timeline 24 jam, tabel job, detail job, pause/resume, run now, edit schedule, acknowledge insiden, riwayat run, dan diff output. Klik baris job langsung memilih job itu di modal. Palette punya aksi "Open cron jobs". | P0 |
| F-R12-4 | Klik panel Activity di Dashboard membuka **modal Live feed** dengan isi yang sama seperti layar Live feed (filter agent dan jenis, pencarian, feed terbaru di atas). Layar Live feed tetap ada di menu. | P0 |
| F-R12-5 | Panel **Cron** dan **Activity** di Dashboard bisa disembunyikan (ciut ke judulnya) seperti panel Server. Jika salah satu disembunyikan, panel lain mengisi tinggi kolom; handle resize hanya tampil saat keduanya terbuka. Disimpan di `app.db`. | P0 |
| F-R12-6 | **Area scroll:** chat room di panel Agents Dashboard tingginya tetap (mengisi sisa panel, minimal ±280 px) dan riwayat chat scroll di dalam box, menempel ke pesan terbaru. Layar **Chat** setinggi jendela: daftar agent di kiri dan kotak input tetap di tempat, hanya percakapan yang scroll. Layar **Live feed**: hanya daftar feed yang scroll; judul, filter, dan panel samping tetap. | P0 |
| F-R12-7 | **Klik node graph** (Dashboard dan Second brain) langsung membuka **modal pembaca catatan**: judul, path, tag (bisa diklik), isi markdown dengan `[[wikilink]]` yang bisa diklik, dan daftar tautan. Node tag menampilkan catatan yang memakai tag itu; node unresolved menampilkan catatan yang menautnya. Kartu info node di pojok graph Dashboard dihapus. Isi catatan disanitasi seperti markdown agent (DOMPurify). | P0 |
| F-R12-8 | **Auto start:** Settings → General → "Start automatically when your computer starts" (login item di Windows/macOS, autostart `.desktop` di Linux). | P0 |
| F-R12-9 | **Nama tampilan agent:** Settings → Agents → Profile punya input *Display name* (maks 24 karakter, kosong = nama profile). Disimpan hanya di `app.db` (`agent_names`), dipakai di semua layar (panel Agents, chat, feed, cron, kanban, graph), dan **tidak pernah mengubah** nama profile atau config Hermes di VPS. Kunci internal tetap nama profile. | P0 |
| F-R12-10 | **Layar Kanban (read-only):** kolom triage, to do, ready, running, blocked, review, done dari `~/.hermes/kanban.db` dan `kanban/boards/<slug>/kanban.db` (pilihan board; fallback `hermes kanban list/show --json`). Kartu menampilkan nomor, judul, prioritas, assignee (foto dan nama tampilan), jumlah komentar, dan umur. Filter assignee dan pencarian. Klik kartu membuka modal detail: deskripsi markdown, komentar antar agent, pembuat, waktu, run (`task_runs`), tautan (`task_links`), dan activity (`task_events`). Kolom menyusut agar tujuh kolom muat di 1440 px; di layar lebih sempit papan scroll horizontal. Tidak ada aksi tulis di v1.2. | P1 |

## 7. Kebutuhan Non-Fungsional

| ID | Kebutuhan |
|---|---|
| NF-1 **Latensi** | Event agent dan metrik server tampil ≤ 2 detik setelah terjadi di VPS. Token chat pertama tampil ≤ (waktu start `hermes` + latensi model). |
| NF-2 **Beban VPS** | Proses collector di VPS memakai < 2% CPU dan < 50 MB RAM rata-rata. |
| NF-3 **Read-only secara default** | Akses `state.db` selalu memakai mode SQLite `?mode=ro` (aman dengan WAL Hermes). Penulisan hanya terjadi lewat aksi eksplisit di kolom ✍️ tabel 3.2. Setiap aksi tulis dicatat di log aplikasi lokal (waktu, agent, file/key, jenis aksi; tanpa isi). |
| NF-4 **Zero-Change** | Mematuhi tabel 3.2. Collector dikirim lewat stdin ke interpreter Python milik Hermes dan hidup hanya selama koneksi; begitu koneksi ditutup, proses itu berhenti dan tidak meninggalkan file. Diverifikasi dengan test: snapshot `find ~ -newer` sebelum dan sesudah satu sesi pemakaian **tanpa aksi tulis** tidak menunjukkan file baru maupun perubahan di luar data normal Hermes. |
| NF-5 **Keamanan** | Password hanya disimpan terenkripsi oleh keychain OS (`safeStorage`). Host key diverifikasi. File `.env` dan `auth.json` tidak pernah dibaca. Isi pesan dan isi catatan tidak disimpan ke disk lokal. Input chat dikirim lewat stdin, tidak melalui string shell. Hardening Electron: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, CSP ketat, navigasi dan `window.open` diblokir. Konten markdown dari vault dan agent disanitasi (DOMPurify) sebelum dirender, karena konten itu tidak tepercaya. |
| NF-6 **Responsif UI** | SSH, parsing, dan layout graph berjalan di luar thread render: SSH di main process, layout graph di Web Worker. UI tidak boleh freeze lebih dari 100 ms. |
| NF-7 **Ketahanan** | Koneksi putus tidak membuat aplikasi crash. Setelah reconnect, data disusul (feed lanjut dari `id` pesan terakhir yang diterima). |
| NF-8 **Kompatibilitas** | VPS: Linux dengan Hermes Agent ≥ v0.21 yang terinstal dengan cara standar, tanpa prasyarat lain. Desktop: Windows 10+, macOS 12+, Linux x64 (Ubuntu 22.04+ / Fedora 38+ atau setara). |
| NF-9 **Resource desktop** | Aplikasi yang dibiarkan terbuka dengan semua tab aktif memakai < 500 MB RAM dan stabil selama 24 jam. |

## 8. Pendekatan Teknis


### 6.21 Revisi v1.3: sidebar permanen, notifikasi di atas aplikasi lain, kerapian jarak

**Mockup:** `mockup/*.html` (`python mockup/build.py`). Sidebar ada di semua layar kecuali Launch dan Connect (belum terhubung, tidak ada tujuan navigasi).

| ID | Kebutuhan | Prio |
|---|---|---|
| F-R13-1 | **Sidebar kiri permanen** di Dashboard, Chat, Live feed, Sessions, Kanban, Usage, Skills, Logs, Second brain, dan Server. Isi: logo, lalu menu (Dashboard, Chat, Live feed; Sessions, Kanban, Usage; Skills, Logs, Second brain, Server; tiap kelompok dipisah garis tipis), dan di bawah: Terminal, Search (Ctrl+K), Collapse. Menu **dihapus dari status bar** (F-NAV-1, F-NAV-3, F-NAV-4 dan F-R12-1 digantikan). | P0 |
| F-R13-2 | Sidebar punya dua mode: **lebar** (ikon + label, 184 px) dan **rail** (hanya ikon, 56 px, dengan tooltip). Tombol Collapse berganti mode dan pilihannya disimpan di `app.db`. Di bawah 900 px lebar jendela sidebar otomatis menjadi rail. Item aktif memakai latar, teks hijau, label tebal, dan `aria-current="page"`; badge Chat dan Logs (F-NAV-5) tetap ada. | P0 |
| F-R13-3 | Pintasan Ctrl+1 … Ctrl+0 dan Ctrl+` mengikuti urutan sidebar. Panel terminal (F-R12-2) tetap membentang di atas status bar. | P1 |
| F-R13-4 | **Notifikasi desktop OS** (Electron `Notification` dari main process) muncul **di atas aplikasi lain** saat Mission Control diminimalkan, tidak fokus, atau berjalan di tray; klik notifikasi memfokuskan jendela dan membuka layar terkait. Diatur di Settings → Notifications ("Show desktop notifications over other apps", default aktif) bersama preview, suara, dan do-not-disturb; ada tombol **Send a test notification**. Saat jendela fokus, notifikasi cukup tampil sebagai toast di dalam aplikasi. Mockup memakai Notification API browser sebagai pengganti. | P0 |
| F-UI-9 | **Kerapian jarak:** isi halaman memakai padding 20 px (atas), 24 px (kiri/kanan), 16 px (bawah); judul halaman, baris filter, dan isi dipisah 14 px; baris filter memakai jarak antar-kontrol 8-12 px; panel dengan judul di garis tepi (`┤ judul ├`) memberi ruang minimal 10 px di atasnya sehingga judul tidak terpotong oleh area scroll atau tertutup baris filter. | P0 |
### 6.22 Chat room multi-agent (F-ROOM) — v2

Spec: `docs/superpowers/specs/2026-10-20-group-chat-rooms-design.md`. Diverifikasi ke sumber Hermes tag v2026.8.31: room "hosted" Hermes (`groups.*`, tabel `hosted_rooms`) hanya dijalankan oleh `hermes serve`/dashboard, jadi **tidak dipakai** (Zero-Change). Aplikasi mengikuti jalur room milik klien di Hermes Desktop: tiap anggota punya sesi Hermes sendiri berjudul `Group: <roomId>`, dibuat lewat gateway TUI dengan `session.create {title, hidden, room_plumbing, follow_profile_config}`.

| ID | Kebutuhan | Prio |
|---|---|---|
| F-ROOM-1 | Layar **Chat** punya bagian **Rooms** di atas Direct messages, dengan tombol New room. Baris room menampilkan avatar anggota, nama, dan status (`working…`, `needs you`, jumlah balasan baru, atau jumlah agent). | P1 |
| F-ROOM-2 | **New room / Edit room**: nama 1–60 karakter dan **2–6 agent** dari VPS ini. Membuat, mengganti nama, mengubah anggota, dan menghapus room hanya mengubah `app.db`; sesi anggota di server tetap ada setelah room dihapus. | P1 |
| F-ROOM-3 | **Ronde:** satu Send memicu paling banyak **3 ronde** berurutan (tidak paralel). Yang mendapat giliran: agent yang di-@mention sejak pesan user terakhir, atau semua bila tidak ada mention atau ada `@everyone`/`@all`. Urutan digeser tiap ronde. Agent hanya ditanya bila ada baris room yang baru baginya (maks 24 baris di prompt). Room selesai bila satu ronde diam, atau setelah **10 balasan**. | P1 |
| F-ROOM-4 | **Prompt anggota** sama dengan Hermes Desktop: siapa saja di room, baris baru, dan aturan room (jawab singkat, `(pass)` bila tidak ada yang baru, `@name` menarik teman, `@user` untuk keputusan user, tanpa membocorkan chat 1:1). `(pass)`, jawaban kosong, atau turn gagal dihitung diam. | P1 |
| F-ROOM-5 | Percakapan room menampilkan pesan user, balasan per agent dengan avatar dan warna, gelembung live agent yang sedang menjawab (chip tool, kartu approval/clarify), baris "X passed", catatan gagal, dan alasan room berhenti. Composer: Enter mengirim, `@` menawarkan anggota (panah + Enter), chip `@agent`, **Stop** selama room berjalan; Send ditolak selama run. | P1 |
| F-ROOM-6 | Room butuh **gateway TUI** (`chat.useGateway`); tanpa gateway room menampilkan alasannya dan Send nonaktif (tidak ada fallback ACP/one-shot). Approval tidak pernah dijawab otomatis; turn yang dihentikan menjawab `deny`. | P0 |
| F-ROOM-7 | Room yang selesai saat tidak dilihat memberi **badge** di Chat, notifikasi (`<room>: N new replies` atau `<agent> needs you`, klik membuka room) dan suara balasan. Room muncul di command palette; graph agent dan layar Sessions menampilkan nama room lokal untuk judul `Group: mc-…`. | P2 |
| F-ROOM-8 | Log room tersimpan lokal (maks 2.000 entri per room); **Settings → Data → Clear room history** mengosongkannya. `app.log` hanya mencatat `room <id> run/turn …`, tanpa isi pesan. | P1 |

### 8.1 Arsitektur yang dipilih

**Pemantauan: SSH + collector efemeral lewat stdin.**
- Saat connect, main process Electron menjalankan `<python-hermes> -u -` lewat satu channel SSH, lalu mengirim skrip collector (Python stdlib saja, dibundel di dalam aplikasi) lewat stdin.
- Skrip itu hidup di memori proses dan mengalirkan event JSON-lines ke stdout:
  - metrik dari `/proc`;
  - pesan baru dari `state.db` (read-only, berdasarkan `id > last_id`);
  - perubahan `jobs.json`;
  - status gateway dan daftar profile;
  - graph dan perubahan vault.
- Saat koneksi putus, proses mati sendiri. Tidak ada file yang ditulis.

> Collector ditulis dalam Python karena interpreter Python **pasti ada** di VPS sebagai bagian dari instalasi Hermes. Di sisi desktop tidak ada Python sama sekali.

**Chat: `hermes chat --oneshot --format stream-json`** lewat SSH exec terpisah untuk setiap giliran (6.7).

**Agent Settings (6.8):**
- Model diubah lewat `hermes -p <p> config get/set`, sehingga validasi skema dan pembersihan `base_url` ditangani Hermes sendiri.
- `SOUL.md`, `MEMORY.md`, dan `USER.md` ditulis lewat SFTP secara atomik dengan cek hash untuk deteksi konflik. Hermes tidak menyediakan CLI untuk mengedit file-file ini, dan file-file ini memang dirancang sebagai markdown yang bisa diedit user.
- Argumen perintah selalu di-escape (dibangun dari daftar argumen yang di-quote satu per satu), tidak pernah lewat penyambungan string mentah.

Opsi yang **ditolak**:

| Opsi | Alasan ditolak |
|---|---|
| Upload skrip collector ke `~/.cache/…` | Menulis file ke VPS. Diganti stdin. |
| API server Hermes (`/v1/runs`, SSE) | Butuh `API_SERVER_ENABLED` dan key di `.env`, serta restart gateway. |
| Dashboard Hermes (`hermes dashboard`) via tunnel | Harus dijalankan dulu (menjalankan server baru); API per-profile. |
| Plugin hook untuk streaming thinking token per token | Memasang plugin di VPS. |
| `hermes acp` sebagai jalur utama chat | Butuh extra `[acp]` yang belum tentu terpasang. Dijadikan mode opsional (F-CHAT-10). |
| Mengedit `config.yaml` langsung lewat SFTP untuk ganti model | Melewati validasi Hermes dan berisiko merusak YAML. Diganti `hermes config set`. |
| Polling perintah shell murni (`cat`, `sqlite3`) | Boros dan lambat, dan `sqlite3` CLI belum tentu ada. |

### 8.2 Stack (Electron)

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Shell aplikasi | **Electron** + **electron-vite** | Chromium dibundel sehingga rendering (WebGL, font, CSS) identik di Windows, macOS, dan Linux. electron-vite memberi HMR dan build cepat. |
| Bahasa | **TypeScript** (main, preload, renderer) | Satu bahasa di seluruh aplikasi; tipe event dan IPC dibagi antar proses. |
| UI | **React 19** + **Tailwind CSS** + **Zustand** (state) + **TanStack Virtual** (list panjang) | Ekosistem terbesar, cocok untuk dashboard realtime. |
| SSH | **ssh2** (Node, di main process) | Library SSH paling matang di Node: password auth, exec, signal, SFTP, verifikasi host key. |
| Grafik monitor | **uPlot** | Sangat ringan dan cepat untuk time-series realtime 1 detik ala btop. |
| Graph view | **PixiJS v8** (render WebGL) + **d3-force** (layout di **Web Worker**) | Pendekatan yang sama dengan Graph View Obsidian, sehingga slider forces Obsidian (center/repel/link force, link distance) bisa dipetakan langsung ke parameter d3-force. Mampu menangani ribuan node dengan lancar. |
| Penyimpanan pengaturan | **better-sqlite3** | SQLite sinkron yang cepat di main process. |
| Penyimpanan rahasia | Electron **safeStorage** | Enkripsi berbasis keychain OS (DPAPI / Keychain / libsecret) tanpa modul native tambahan. |
| Render markdown | **markdown-it** (+ plugin wikilink) + **DOMPurify** | Pratinjau catatan dan jawaban chat, disanitasi. |
| Editor & diff | **CodeMirror 6** (+ `@codemirror/merge`) | Editor markdown ringan untuk SOUL/MEMORY/USER, dengan tampilan diff dan merge untuk konfirmasi dan konflik. |
| Packaging | **electron-builder** | NSIS, DMG (universal), AppImage, dan deb dari satu konfigurasi; menyiapkan code signing dan notarization. |
| Test | **Vitest** (unit: parser stream-json, parser vault, store), **Playwright for Electron** (E2E), **pytest** (collector terhadap fixture `~/.hermes` palsu; hanya di mesin dev/CI) | Setiap lapisan bisa diuji terpisah. |

### 8.3 Arsitektur proses & alur data

```
[VPS — tidak ada yang diinstal]                 [Desktop — Electron]
<python-hermes> -u -  (collector dari stdin)    MAIN PROCESS (Node)
 ├─ /proc → metrics (1s)            ─┐           ├─ ConnectionManager (ssh2)
 ├─ gateway_state.json → agents      │  SSH #1   ├─ CollectorChannel → EventRouter
 ├─ state.db (ro) → messages (1s)    ├─ JSONL ──▶├─ ChatService (exec per giliran)
 ├─ SOUL/MEMORY/USER.md (mtime)      │           ├─ AgentConfigService (config get/set, SFTP atomik)
 ├─ cron/jobs.json (mtime) → cron    │           ├─ SettingsStore (better-sqlite3 → app.db)
 └─ vault/*.md (mtime) → brain       ─┘          └─ SecretStore (safeStorage)
                                                        │  IPC typed (contextBridge/preload)
hermes -p X chat --oneshot --format stream-json         ▼
  (stdin = pesan, stdout = JSONL)  ◀── SSH #2..n   RENDERER (React, sandboxed)
                                                 ├─ Zustand stores (agents, metrics, cron, feed, brain, chat)
                                                 ├─ Views: Overview, Agents, Chat, Feed, Server, Cron, Brain
                                                 └─ Web Worker: d3-force layout → PixiJS graph
```

- Renderer **tidak** punya akses Node maupun SSH. Semuanya lewat API preload yang sempit dan bertipe, misalnya `mc.connect()`, `mc.onEvent()`, `mc.chat.send()`, `mc.settings.get/set()`.
- Format event collector: `{"type": "metrics|agents|cron|message|session|brain_snapshot|brain_delta|error", "ts": ..., "profile": ..., "data": {...}}`
- Graph vault: snapshot penuh dikirim saat pertama kali, lalu *delta* (note ditambah/diubah/dihapus) setiap kali vault berubah.

### 8.4 Penyimpanan Lokal

Semua pengaturan disimpan di **`app.db`** (SQLite) di folder userData Electron:
- Windows: `%APPDATA%\Hermes Agent Mission Control\`
- macOS: `~/Library/Application Support/Hermes Agent Mission Control/`
- Linux: `~/.config/Hermes Agent Mission Control/`

Password **tidak** disimpan sebagai plaintext. Yang disimpan di `app.db` hanya blob terenkripsi `safeStorage`, yang hanya bisa didekripsi oleh user OS yang sama di mesin yang sama.

| Tabel | Isi |
|---|---|
| `schema_version` | Versi skema untuk migrasi. |
| `connections` | id, nama, host, port, username, `remember` (bool), `password_enc` (blob safeStorage, nullable), `last_connected_at`. |
| `known_hosts` | connection_id, algoritma, fingerprint SHA256, `first_seen_at`. |
| `vaults` | connection_id, path di VPS, nama tampilan, `is_default`. |
| `chat_sessions` | connection_id, profile, `session_id` Hermes, judul, `last_used_at`. Hanya pemetaan; isi pesan tetap dibaca dari `state.db`. |
| `settings` | key → value JSON: tema, layout jendela, tab terakhir, filter feed/cron, pengaturan graph (forces, groups, display), **`filters.agent`, `filters.range`** (v1.1), **`terminal` (open, height), `dashboard.cronOpen`, `dashboard.actOpen`, `agent_names`** (v1.2). |
| `memory_snapshots` (v1.1) | connection_id, profile, file (`MEMORY`/`USER`/`SOUL`), `taken_at`, `hash`, `content`, `author_guess` (`agent`/`you`/`away`), `session_id` (nullable). Retensi 200 versi per berkas atau 180 hari. Tidak pernah dikirim ke VPS. |
| `action_log` (v1.1) | connection_id, `at`, `kind` (misalnya `cron.pause`, `tools.enable`), `target`, `ok`. **Tanpa isi** perintah atau data, hanya jejak bahwa aksi eksplisit terjadi (F-STATE-3). |

## 9. Metrik Keberhasilan

- Dari klik "Connect" sampai semua panel terisi: ≤ 5 detik (VPS dengan latensi < 100 ms).
- **Zero-Change terverifikasi:** setelah satu sesi pemakaian penuh, tidak ada file baru maupun perubahan di instalasi Hermes atau home user, selain sesi chat di `state.db` yang memang dibuat user.
- Berhasil dipakai di minimal 2 VPS Hermes berbeda yang belum pernah disentuh, tanpa langkah setup apa pun.
- Installer berjalan dan semua fitur P0 lolos E2E di Windows 11, macOS (Apple Silicon), dan Ubuntu 24.04.
- 100% profile yang muncul di `hermes profile list` juga muncul di aplikasi dengan status yang sama, termasuk profile yang baru dibuat saat aplikasi sedang terbuka.
- 100% job yang muncul di `hermes cron list` (semua profile) juga muncul di tabel cron.
- Aplikasi bisa dibiarkan terbuka 24 jam dengan RAM < 500 MB dan tanpa koneksi menggantung.
- Graph vault berisi 5.000 catatan berjalan ≥ 30 fps di ketiga OS.

## 10. Rilis Bertahap (Milestone)

| Milestone | Isi | Hasil yang bisa dicoba |
|---|---|---|
| **M1 — Fondasi** | Scaffold Electron + React + TS, hardening, IPC bertipe, `app.db`, safeStorage, F-CONN (termasuk preflight), collector via stdin, F-AGENT-1/2, F-MON, **F-NAV-1..4 (menu di status bar), F-STATE-1..3, F-STATE-6 (capability detection)** | Login, preflight, melihat agent aktif dan namanya, monitor server ala btop, navigasi di status bar |
| **M2 — Cron** | F-CRON-1..5 | Tabel dan timeline cron semua agent |
| **M3 — Live Feed** | F-FEED-1..6, F-AGENT-3/4 | Interaksi dan thinking semua agent realtime |
| **M4 — Graphs** | Spike performa graph (vault sintetis 5k node di ketiga OS), lalu F-BRAIN-1..9 dan F-AGRAPH-1..5 | Input path vault, graph ala Obsidian yang realtime, dan graph interaksi antar agent |
| **M5 — Chat** | Spike verifikasi flag CLI di Hermes asli, lalu F-CHAT-1..9 dan F-CHAT-11..14 (upload file) | Chat 1-on-1 dengan setiap agent, termasuk lampiran file |
| **M6 — Agent Settings** | Spike key-via-stdin, lalu F-CFG-1..9 (model: provider, Base URL, API key, fetch models), F-CFG-10..18 (Soul/Memory/User Profile) | Ganti model per agent (termasuk endpoint custom), edit SOUL/MEMORY/USER dengan diff dan deteksi konflik |
| **M7 — Rilis v1** | Installer 3 OS, polish, F-APP, test Zero-Change di VPS bersih, E2E di 3 OS | Installer siap pakai |
| **M8 — Insights** (v1.1) | F-SESS-1..7 (spike: kueri FTS di `state.db` besar), F-USAGE-1..6, F-NAV-5..8 (badge, pintasan, command palette, filter bersama), alert biaya | Riwayat dan pencarian sesi, analitik biaya dan tool, palette Ctrl+K |
| **M9 — Operations** (v1.1) | F-LOG-1..9, F-CRON-7..14 (spike: perintah `cron runs` dan `incidents` di Hermes asli), notifikasi cron/gateway yang diperluas | Log tail, status gateway, kebijakan approval, kontrol dan riwayat cron |
| **M10 — Agent management** (v1.1) | F-SKILL-1..7, F-MEMT-1..6, F-CFG-19..26 (spike: `tools --summary`, `mcp list`, `fallback list` untuk parser) | Skills, memory timeline, MCP, toolsets, fallback, backup, profile baru |
| v2 (kandidat) | ~~Multi-VPS~~ (dibangun, F-CONN-14..17), ~~chat room multi-agent~~ (dibangun, 6.22), ~~mode ACP~~ (dibangun), ~~auto-update~~ (dibangun), membaca `.obsidian/graph.json`, auxiliary model, katalog model, aksi tulis di Kanban | Room multi-agent di layar Chat |

## 11. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Skema `state.db` berubah di versi Hermes berikutnya (saat ini versi skema 31) | Feed rusak | Collector membaca `schema_version`, memakai query yang toleran (cek kolom lewat `PRAGMA table_info`), dan menampilkan peringatan "unsupported Hermes version". |
| Kombinasi `--query-file -` dengan `--format stream-json` dan `--resume` belum dicontohkan di dokumentasi | Chat tidak jalan sesuai rencana | Spike di awal M5 untuk memverifikasi di Hermes asli. Fallback: `-q '<pesan>'` dengan quoting shell yang ketat. |
| Startup `hermes` per giliran chat (proses Python baru) menambah jeda 1–3 detik | Chat terasa lambat | Tampilkan indikator "agent is starting…". Mode ACP persisten (F-CHAT-10) untuk VPS yang mendukungnya. |
| Electron boros RAM bila dibiarkan terbuka lama | Mesin user berat | Target NF-9. Throttle render saat jendela tidak terlihat (grafik dan graph dijeda, data tetap diterima). Batasi buffer feed di memori. |
| Linux tanpa keyring (Secret Service/KWallet) | Password tidak bisa disimpan dengan aman | Deteksi backend `safeStorage`. Jika hanya `basic_text`, nonaktifkan "remember password" dan tampilkan penjelasan. |
| Code signing: tanpa sertifikat, macOS Gatekeeper dan Windows SmartScreen menampilkan peringatan | Instalasi membingungkan bagi user lain | Siapkan konfigurasi signing dan notarization di electron-builder. Butuh Apple Developer ID dan sertifikat Windows (lihat Q10). |
| Performa WebGL di VM atau GPU lemah | Graph patah-patah | Spike di awal M4. Ada batas jumlah node, opsi "reduce motion", dan layout dibekukan setelah stabil. |
| PATH di sesi SSH non-interaktif tidak memuat `~/.local/bin` | `hermes` tidak ditemukan | Deteksi berlapis (F-CONN-10). |
| Login SSH dengan password ke IP publik rentan brute-force (sisi VPS) | Keamanan VPS | Dokumentasikan rekomendasi memakai SSH key dan fail2ban. Login SSH key sudah tersedia (F-CONN-7). |
| Konten vault atau balasan agent berisi HTML/JS berbahaya | XSS di renderer | DOMPurify, CSP ketat, renderer di-sandbox tanpa akses Node. |
| User dan agent mengedit MEMORY.md bersamaan | Ingatan agent hilang atau tertimpa | Cek hash sebelum simpan, diff 3 arah, tanpa penimpaan diam-diam (F-CFG-13). Penulisan atomik. |
| API key dikirim sebagai argumen `hermes config set` (bila Hermes tidak menerima stdin) | Key sempat terlihat di daftar proses (`ps`, `/proc/<pid>/cmdline`) oleh user lain di VPS yang sama, selama < 1 detik | Utamakan stdin bila didukung (spike M6). Jika tidak bisa, tampilkan peringatan sebelum Save di VPS multi-user. Exec SSH non-interaktif tidak menulis riwayat shell. Key tidak pernah dicatat di log aplikasi. |
| Model ID salah ketik (Hermes tidak memvalidasi nama model) | Agent gagal menjawab setelah diganti | Daftar model dari `/models` (F-CFG-4), tombol Test model (F-CFG-8), plus peringatan jika Model ID tidak pernah terlihat sebelumnya. |
| `hermes status` hanya menghasilkan teks (tanpa `--json`) | Parsing daftar provider rapuh antar versi | Parser toleran dengan test fixture per versi Hermes. Jika parsing gagal, dropdown provider berubah menjadi input bebas. |
| Model baru tidak langsung berlaku di sesi gateway yang sedang berjalan | User mengira perubahan gagal | Info yang jelas (F-CFG-9/14) dan tombol restart gateway per agent. |
| Vault sangat besar (> 20 rb catatan) | Graph lambat | Parsing dilakukan di VPS, sehingga yang dikirim hanya node dan edge. Isi catatan diambil hanya saat diklik. Ada batas node dan peringatan. |
| Dokumentasi Hermes tidak diberi versi; subperintah (`cron runs`, `curator`, `tools`, `fallback`, `mcp`) bisa berbeda di v0.21.x yang terpasang | Tombol atau layar memanggil perintah yang tidak ada | Deteksi kemampuan saat connect (F-STATE-6); fitur yang tidak ada dimatikan dengan penjelasan; fixture uji per versi. |
| `config.yaml` bisa memuat token inline (`mcp_servers.*.env`, `headers`) | Kebocoran rahasia lewat tampilan atau backup | Daftar MCP lewat `hermes mcp list`, tidak membaca config mentah (F-CFG-20); backup mengosongkan nilai env/header/key secara lokal (F-CFG-23); `.env`, `auth.json`, `mcp-tokens/` tidak pernah dibaca. |
| Skema `gateway_state.json` per platform tidak terdokumentasi | Status platform salah baca | Parser toleran, field tak dikenal ditampilkan apa adanya, heartbeat basi > 120 detik ditandai (F-LOG-5). |
| Hermes tidak punya log keputusan approval | User mengira ada jejak audit | UI menyatakannya (F-LOG-8); tab Approvals hanya kebijakan dan riwayat perintah yang berjalan. |
| Kueri FTS dan agregasi biaya pada `state.db` besar (jutaan baris pesan) | UI macet atau lock | `?mode=ro`, `LIMIT`, debounce, agregasi per hari di collector dengan cache, tanpa memuat pesan penuh (F-SESS-7). |
| Tebakan penulis memory salah (F-MEMT-3) | User salah menyalahkan agent | Dilabeli perkiraan; "while away" untuk perubahan yang tidak bisa dikaitkan. |
| Tombol "… in the terminal" memancing user menjalankan perintah tanpa membaca | Perubahan tak diinginkan | Hanya mengisi perintah, tidak menekan Enter; perintah ditampilkan jelas (F-CFG-26). |
| Biaya perkiraan berbeda dari tagihan provider | Angka dianggap pasti | Tanda "est.", catatan semantik biaya (F-USAGE-4); `actual_cost_usd` dipakai bila ada. |

## 12. Keputusan Review & Pertanyaan Terbuka

### 12.1 Keputusan

| # | Topik | Keputusan |
|---|---|---|
| Q1 | Jumlah agent / gateway | Dinamis sesuai profile yang dibuat user; gateway mode **multiplex** sebagai skenario utama. |
| Q2 | User Hermes | User SSH yang diisi di form login adalah user yang menjalankan Hermes. |
| Q3 | Format second brain | Vault Obsidian. |
| Q4 | Aksi cron | Masuk v2. |
| Q5 | Thinking | Per langkah bisa diterima. |
| Q6 | Bahasa UI | Inggris. |
| Q7 | Stack | Desktop multiplatform (Windows/macOS/Linux) dengan **Electron** + React/TypeScript; tidak memakai Python di sisi desktop. |
| Q8 | Simpan password | Ya, opsional, lewat keychain OS. |
| Q9 | Perintah berbahaya | Mengikuti kebijakan Hermes sepenuhnya; aplikasi tidak mengesampingkan apa pun. |
| Q10 | Distribusi & code signing | **Default (belum dijawab):** v1 dirilis tanpa tanda tangan beserta panduan membuka di macOS/Windows. Konfigurasi signing dan notarization sudah disiapkan di electron-builder supaya tinggal diaktifkan. |
| Q11 | "profile.md" | **Diasumsikan** `memories/USER.md` (tab "User Profile"). |
| Q12 | Zero-Change | **Diterima** (user melanjutkan): tanpa prasyarat dan tanpa perubahan diam-diam; penulisan hanya lewat aksi eksplisit user (Save, Send, Restart, Upload, perintah di Terminal, menyimpan API key). |
| Q13 | Base URL + API key + pilih model | Ya: alur empat langkah di 6.8.1; aplikasi boleh **menulis** API key lewat CLI resmi, tetapi tidak pernah membacanya. |
| Q14 | Navigasi untuk fitur v1.1 | v1.1 memakai icon rail di kiri. **Direvisi v1.2 (permintaan user):** semua menu kembali ke status bar bawah, termasuk menu layar v1.1; Cron menjadi modal di Dashboard. Command palette Ctrl+K tetap ada. |
| Q15 | Cakupan v1.1 | Semua fitur dari daftar usulan (Sessions, Usage, Logs/Gateway/Approvals, kontrol Cron, Skills, memory timeline, MCP/Toolsets/Fallback/Backup/Profile baru, palette, alert biaya). Multi-VPS dan chat room multi-agent ditunda ke v2. |
| Q16 | Approval | **Read-only.** Aplikasi tidak mengubah `approvals.mode`, `deny`, atau `command_allowlist` (konsisten dengan Q9). |
| Q17 | Backup | Unduhan SFTP ke komputer user, bukan `hermes backup` (yang menulis file di VPS). Restore manual. |
| Q18 | Skills | Tanpa tombol enable/disable per skill karena perintahnya tidak terdokumentasi. Yang ada: pin/unpin dan archive/restore lewat `hermes curator`, plus install dari hub. |
| Q19 | Export sesi | Dibuat lokal dari data yang sudah dibaca, bukan `hermes sessions export` (menulis file di VPS). |

### 12.2 Pertanyaan terbuka

Tidak ada yang memblokir. Q10 dan Q11 memakai default di atas; koreksi bila tidak sesuai.

| # | Topik | Pertanyaan |
|---|---|---|
| Q20 | Layar **Kanban** | Mockup lama menaut ke `Kanban.dc.html` dan menyebut serah-terima tugas antar agent (6.6b, F-SHELL-4), tetapi berkas sumbernya tidak ada di `mockup/src/`. Kanban tidak dimasukkan ke rail v1.1. **Diputuskan v1.2:** layar Kanban dibangun read-only (6.20, F-R12-10); aksi tulis menunggu v2. |
| Q21 | Nama toolset | Daftar toolset di mockup adalah contoh. Nama sebenarnya dibaca dari `hermes tools --summary` saat berjalan; perlu diverifikasi di Hermes asli. |


## 13. Lampiran — Referensi Hermes yang Dipakai

| Data / Fitur | Lokasi / Perintah di VPS (per profile) |
|---|---|
| Profile | `~/.hermes` (default), `~/.hermes/profiles/<nama>/`; nama tampilan di `profile.yaml` → `display_name` |
| Status gateway (multiplex) | `~/.hermes/gateway_state.json` (`served_profiles`, heartbeat), `~/.hermes/gateway.pid`, `gateway.parked`; systemd `hermes-gateway.service` |
| Sesi & pesan | `state.db` (SQLite WAL): tabel `sessions` (source, model, token, biaya, started/ended_at, parent_session_id), `messages` (role, content, `reasoning`/`reasoning_content`, `tool_calls`, `tool_name`, timestamp, `active`) |
| Cron | `cron/jobs.json` (id, name, prompt, schedule{kind,expr,display}, state, enabled, next_run_at, last_run_at, last_status, last_error, deliver, skills, model); output di `cron/output/` |
| Memory | `memories/MEMORY.md`, `memories/USER.md` |
| Log | `logs/agent.log`, `logs/gateway.log`, `logs/errors.log` |
| Chat (CLI) | `hermes -p <p> chat --oneshot --query-file - --format stream-json --source <tag> [--resume <id>]`. Event: `system{session_id}`, `text{text}`, `tool_use{name,input}`, `tool_result{name,output,duration_ms,is_error}`, `result{session_id,exit_code,text,tokens,duration_ms}`. Exit 0 = selesai, 1 = gagal, 130 = diinterupsi |
| Approval one-shot | `approvals.single_query_mode` (default `deny`), `command_allowlist`; diikuti apa adanya |
| Model (config) | `model.provider`, `model.default`, `model.base_url`, `model.api_mode`, `agent.reasoning_effort`, `fallback_providers`. Baca: `hermes -p <p> config get model --json`. Tulis: `hermes -p <p> config set <key> <value>` (divalidasi skema; ganti provider membersihkan `base_url`/`api_mode`). Berlaku untuk sesi baru; `hermes -p <p> gateway restart` menerapkannya ke semua sesi (multiplex: hanya profile itu) |
| Provider berkredensial | `hermes -p <p> status` (teks, tanpa isi key) |
| Soul & memory | `SOUL.md`; `memories/MEMORY.md` (≤ 2.200 karakter), `memories/USER.md` (≤ 1.375 karakter), entri dipisah `§`; dimuat sebagai snapshot di awal sesi |
| Versi | `hermes --version` |

Sumber: dokumentasi resmi Hermes Agent (hermes-agent.nousresearch.com/docs: CLI reference, sessions, session-storage, cron-internals, profiles, multi-profile-gateways, security, acp-internals), Hermes Agent v0.21.6 (8 Okt 2026).

### 13.1 Fakta tambahan untuk v1.1 (diverifikasi ke dokumentasi resmi, 2026-10-11)

Dokumentasi di hermes-agent.nousresearch.com/docs adalah versi terbaru tanpa pemilih versi. Bagian panjang beberapa halaman hanya terbaca sebagai ringkasan, jadi semua baris di bawah **wajib diverifikasi lagi lewat capability detection (F-STATE-6) dan spike di Hermes asli** sebelum dianggap pasti.

| Fitur | Lokasi / perintah | Catatan |
|---|---|---|
| Skills | `~/.hermes/skills/<kategori>/<skill>/SKILL.md` (profile bernama: `profiles/<nama>/skills/`); `skills/.usage.json`, `.bundled_manifest`, `.hub/lock.json`, `.archive/`, `.curator_ledger.jsonl`; `hermes skills list|inspect|install|check|update|audit|uninstall|opt-out|opt-in|publish|snapshot|tap|config` | Frontmatter: `name`, `description`, `version`, `platforms`, `metadata.hermes.tags/category/requires_toolsets/requires_tools`, `required_environment_variables`. Penanda agent-written: `created_by: agent` di `.usage.json` ("policy flag, not provenance"). **Tidak ada `skills enable/disable`.** |
| Curator | `hermes curator status|run|pause|resume|pin|unpin|adopt|list-unmanaged|restore|list-archived|archive|prune|ledger|rollback|purge|backup`; laporan `~/.hermes/logs/curator/<timestamp>/run.json`, `REPORT.md` | Ledger: aktor `curator`/`agent`/`user`. |
| Cron | `hermes cron list|create|edit|pause|resume|run|remove|status|runs|incidents|doctor|tick`; job di `cron/jobs.json`; output `cron/output/{job_id}/{timestamp}.md`; ledger dan insiden di `cron/executions.db` | `runs [job] --limit N` (alias `history`), `incidents [--state …]`, `incidents ack <id>`. Referensi job: id atau nama (case-insensitive, nama ambigu ditolak). Gateway men-tick tiap 60 detik. Format timestamp nama file **tidak terdokumentasi**. |
| Gateway | `hermes gateway run|start|stop|restart|status|list|install|uninstall|setup|…`; `~/.hermes/gateway_state.json` (`gateway_state`, `updated_at` tiap 60 detik, basi > 120 detik, `served_profiles`, `exit_reason`); `gateway.pid` | `restart` menunggu giliran selesai (drain-aware). Field per platform **tidak terdokumentasi lengkap**. |
| MCP | `mcp_servers:` di `config.yaml` (stdio: `command`, `args`, `env`, `cwd`; HTTP: `url`, `headers`; juga `enabled`, `tools.include/exclude`); `hermes mcp list|add|remove|test|configure|login|install|catalog|serve` | Token boleh ditulis inline atau lewat `${VAR}` dari `~/.hermes/.env`; token OAuth di `~/.hermes/mcp-tokens/<server>.json`. Karena itu config mentah tidak dibaca. |
| Toolsets | `toolsets:` dan `custom_toolsets:` di config; `hermes tools [--summary]`, `hermes tools enable <toolset> --platform <p>`; di sesi `/tools list|enable|disable` | Bentuk YAML `platform_toolsets` dan perintah `tools disable` **tidak terlihat eksplisit**. `all`/`*` tidak mengaktifkan `kanban`. |
| Approvals | `approvals.mode` (`smart`/`manual`/`off`), `timeout`, `cron_mode`, `single_query_mode`, `unattended_mode`, `deny` (glob), `command_allowlist`; `hermes approvals suggest [--days N] [--json]` | `suggest` membaca riwayat perintah yang berjalan dari `state.db`. **Tidak ada log keputusan approve/deny.** |
| Profiles | `hermes profile list|use|create|delete|export|import|show|describe|rename|…`; `create` punya `--clone`, `--clone-all`, `--clone-from`, `--description`, `--no-skills` | `profile export` mengecualikan `auth.json` dan `.env`, tetapi menulis arsip di VPS, jadi tidak dipakai untuk backup. |
| Backup | `hermes backup [-o path] [-q]`, `hermes import <zip>` | Menulis berkas di VPS; tidak dipakai (Q17). |
| Sessions | `hermes sessions list|export|delete|rename|pin|unpin|pinned|prune|archive|stats|…`; `state.db` skema 31 dengan `sessions`, `messages`, `session_model_usage`, `messages_fts`, `messages_fts_trigram`, `messages_fts_cjk` | Kolom biaya: `estimated_cost_usd`, `actual_cost_usd`, `cost_status`. Tidak ada `sessions search`; pencarian lewat tabel FTS. Daftar kolom lengkap tidak dijamin ("abridged"). |
| Logs | `hermes logs [agent|errors|gateway|…] [-n N] [-f] [--level L] [--since T] [--component C]`; berkas `logs/agent.log`, `errors.log`, `gateway.log`, `gateway.error.log`, `tool_calls.log` (opsional), `curator/` | Rahasia sudah disamarkan Hermes. Ukuran rotasi **tidak terdokumentasi**. |
| Fallback | `fallback_providers:` (daftar `{provider, model}`; kustom: `base_url`, `key_env`); `hermes fallback add|list|remove|clear` | Dicoba berurutan. |

**Tidak terdokumentasi (jangan diasumsikan):** enable/disable per skill; subperintah `skills hub`; format nama berkas `cron/output`; skema penuh `gateway_state.json` per platform; log keputusan approval; bentuk YAML `platform_toolsets`; ukuran rotasi log; daftar kolom lengkap tabel `sessions`; pernyataan eksplisit bahwa rilis terbaru adalah v0.21.x.
