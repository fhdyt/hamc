# M2 Cron: desain

Tanggal: 2026-10-11. Sumber kebutuhan: PRD v1.3 §6.4 (F-CRON-1..5), §6.20 (F-R12-3, F-R12-5), §10 (M2). Referensi visual: `mockup/src/_parts/cron.html`. Melanjutkan `2026-10-11-m1-foundation-design.md`.

## 1. Tujuan

Menampilkan semua job cron dari semua profile Hermes di Dashboard (panel Cron) dan di modal Cron: tabel, filter, detail, timeline 24 jam, dan notifikasi OS saat sebuah job gagal. **Hanya baca.** Tidak ada aksi tulis di VPS, jadi Zero-Change tetap utuh.

Task pertama M2 juga **memperbaiki logika status agent M1** yang salah untuk susunan gateway nyata (bagian 4).

## 2. Cakupan

### Masuk M2
| Requirement | Isi |
|---|---|
| F-CRON-1 | Tabel gabungan semua job: Agent, Name, Schedule, Next run (hitung mundur), Last run, Status, State, Deliver |
| F-CRON-2 | Filter agent dan status, pencarian nama |
| F-CRON-3 | Detail: prompt, skills, model/provider, repeat, `last_error`, output run terakhir |
| F-CRON-4 | Timeline 24 jam ke depan, satu lajur per agent |
| F-CRON-5 | Notifikasi OS saat job berakhir dengan status gagal |
| F-CRON-12 | Hitungan header (job, running, error, paused), status berupa label teks |
| F-R12-3 | Klik panel Cron di Dashboard membuka modal Cron |
| F-R12-5 | Panel Cron bisa diciutkan, disimpan di `app.db` |
| F-STATE-1/2 | State loading, empty, error, stale |
| Koreksi M1 | Status agent dari `gateway_state.json` milik tiap profile |

### Tidak masuk M2
Pause, resume, run now, edit schedule, acknowledge insiden, riwayat run, dan diff output (F-CRON-7..11, milestone M9). Pembatas drag Cron/Activity (F-DASH-8). Filter tersimpan (F-NAV-8). Toggle dan do-not-disturb notifikasi (menunggu Settings → Notifications). Render markdown untuk output.

## 3. Bentuk data nyata (Hermes v0.21.0, diamati 2026-10-11)

Satu VPS milik pemilik proyek dengan 6 profile (`default`, `gamos`, `hestia`, `themis`, `wardah`, `zelos`). Struktur diambil dengan skrip hanya-baca yang menyingkat teks.

`<profile>/cron/jobs.json`:
```
{ "jobs": [ <job>, ... ], "updated_at": "<ISO8601 +07:00>" }
```
Field job yang teramati: `id`, `name`, `prompt`, `skills[]`, `skill`, `model`, `provider`, `provider_snapshot`, `model_snapshot`, `base_url`, `script`, `no_agent`, `monitor_script`, `monitor_url`, `monitor_state{last_output_hash,last_changed_at}`, `context_from`, `schedule{kind,expr,display}`, `schedule_display`, `repeat{times,completed}`, `enabled`, `state` (`scheduled`), `paused_at`, `paused_reason`, `created_at`, `next_run_at`, `last_run_at`, `last_status` (`ok`, `error`, atau `null` bila belum pernah jalan), `last_error`, `last_delivery_error`, `failure_streak`, `deliver` (`local`, `origin`, atau `telegram:<id>`), `origin{platform,chat_id,chat_name,...}`, `enabled_toolsets`, `workdir`, `attach_to_session`, `last_dispatch{scheduled_at,dispatched_at,lateness_seconds,kind}`, `fire_claim`.

Catatan penting:
- Semua waktu adalah **ISO 8601 dengan offset zona waktu**, bukan epoch.
- `cron/output/` berisi folder `<job_id>/` dengan berkas `YYYY-MM-DD_HH-MM-SS.md`, **dan** berkas lepas seperti `<job_id>_20260920_190257.txt`. Pembaca harus menangani keduanya.
- Profile tanpa job (`wardah`) tidak punya `cron/jobs.json`.
- Satu job nyata gagal berulang (`last_status: "error"`, `failure_streak: 10`).
- Setiap profile punya `gateway_state.json` sendiri: `pid`, `kind`, `argv`, `start_time`, `gateway_state`, `exit_reason`, `restart_requested`, `active_agents`, `platforms{<nama>{state,error_code,error_message,updated_at,...}}`, `updated_at`, `code_sha`, `code_version`, `session_store`. **Tidak ada** `served_profiles` atau `heartbeat`.
- `state.db` (`user_version` 0, tabel `schema_version`) memakai `messages.timestamp`, `messages.active`, `sessions.ended_at`, sesuai asumsi M1.

## 4. Koreksi M1: status agent

Asumsi M1 (satu gateway multiplex melayani semua profile lewat `served_profiles`, kesegaran lewat `heartbeat`) tidak berlaku di susunan satu gateway per profile. Akibatnya `default` kemungkinan tampil OFFLINE.

Aturan baru di `collect_agents`, per profile:
1. `pid` = `gateway_state.json.pid` dari folder profile itu, atau isi `gateway.pid` jika berkas state tidak ada.
2. Gateway profile **hidup** jika `pid` ada di `/proc` dan `gateway_state` bukan salah satu nilai berhenti (`stopped`, `stopping`, `exited`, `failed`, `crashed`, `shutdown`) dan `exit_reason` kosong.
3. Susunan multiplex tetap didukung: jika `gateway_state.json` di home punya `served_profiles` dan gateway home hidup, profile di dalamnya aktif.
4. Aktif jika (2) atau (3), atau jika ada sesi CLI terbuka dengan pesan ≤ 5 menit (aturan lama). Parked, working (pesan ≤ 30 s), dan idle tidak berubah.
5. Kesegaran `updated_at` **tidak lagi** menentukan status, karena frekuensi pembaruannya belum diketahui. Nilainya tetap dilaporkan sebagai `heartbeatAgeS` (informasi).
6. `gateway.up` dalam event `agents` berarti gateway di home (profile `default`) hidup.
7. `platforms` diambil dari `gateway_state.json` profile itu.

Test status M1 diganti memakai bentuk nyata ini, dan satu test mempertahankan susunan multiplex.

## 5. Collector: event `cron`

Fungsi baru `collect_cron(home, now)` di `collector/mc_collector.py` (ASCII, stdlib, hanya baca, memakai `open` dan `os` saja).

- Untuk tiap profile (aturan penemuan yang sama dengan agents), baca `cron/jobs.json`. Dukung `{"jobs":[...]}` maupun daftar polos. File tidak ada: nol job, tanpa error. JSON rusak: catat di `profiles[].error`, job profile lain tetap dikirim.
- Normalisasi tiap job menjadi:

| Field | Sumber / aturan |
|---|---|
| `profile`, `id`, `name` | profile; `id`; `name` (fallback `id`) |
| `schedule` | `{kind, expr, display}`; `display` dari `schedule.display`, lalu `schedule_display`, lalu `expr` |
| `state` | `paused` jika `state=="paused"` atau `enabled==false`; `running` jika `state=="running"` atau `fire_claim` terisi; `completed` jika `state=="completed"` atau (`repeat.times` ada dan `completed >= times`); selain itu `scheduled` |
| `nextRunTs`, `lastRunTs` | epoch detik dari ISO (`Z` atau offset), `null` jika kosong atau tak terbaca |
| `tzOffsetMin` | offset menit dari `next_run_at`, lalu `last_run_at`; `null` jika tidak ada |
| `lastStatus` | string huruf kecil apa adanya, `null` bila belum pernah jalan |
| `lastError`, `lastDeliveryError` | string dipotong 500 karakter atau `null` |
| `failureStreak` | integer ≥ 0 |
| `deliver` | string apa adanya |
| `model`, `provider` | `model` atau `model_snapshot`; `provider` atau `provider_snapshot` |
| `skills` | gabungan `skills[]` dan `skill`, tanpa duplikat |
| `repeat` | `{times, completed}` |
| `prompt` | dipotong 4000 karakter |
| `lastOutput` | `{rel, mtime}` atau `null`, lihat di bawah |

- **`lastOutput`:** di `<profile>/cron/output/`, bila ada folder `<id>/` ambil berkas biasa terbaru (mtime) di dalamnya; ambil juga berkas lepas yang namanya diawali `<id>` ; pilih yang mtime-nya paling baru. `rel` berupa `<id>/<berkas>` atau `<berkas>` dan harus cocok `^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?$`, jika tidak, `lastOutput` bernilai `null`. Isi berkas tidak dibaca oleh collector.
- **Event:** `{"type":"cron","ts":...,"profile":null,"data":{"jobs":[...],"profiles":[{"profile":"x","ok":true,"error":null}]}}`. Dikirim setiap pemindaian agents (10 detik) **hanya bila hasilnya berubah** dari yang terakhir dikirim (digest SHA-1 dari JSON), dan selalu pada pemindaian pertama. Dengan begitu prompt yang besar tidak dikirim berulang.
- Batas: 500 job total, 200 per profile; kelebihannya dibuang dan dilaporkan di `profiles[].error`.

## 6. Main process

### Skema dan saluran bersama
- `src/shared/events.ts`: `CronJob`, `CronData`, dan varian `cron` pada `CollectorEvent`.
- `src/shared/channels.ts`: `cronOutput: 'mc:cron:output'`, `evOpenCron: 'mc:ev:open-cron'`.
- `src/shared/ipc.ts`: `MissionApi.cron.output(profile, jobId): Promise<CronOutputResult>` dan `onOpenCron(cb)`.
- `src/shared/settings.ts`: `'dashboard.cronOpen': boolean` (bawaan `true`).

### CronStore
Menyimpan job terakhir dari event `cron` (kunci `profile/id`). Dipakai untuk mencari path output dan oleh watcher. Dikosongkan saat disconnect.

### Pembaca output
IPC `cron:output({profile, jobId})`:
1. Validasi dengan zod; `profile` harus cocok `^[A-Za-z0-9._-]{1,64}$`.
2. Cari job di `CronStore`. Tidak ada, atau `lastOutput === null`: `{ok:false, reason:'no-output'}`.
3. Path absolut = `<home>/cron/output/<rel>` untuk `default`, atau `<home>/profiles/<profile>/cron/output/<rel>`. **Path tidak pernah datang dari renderer.**
4. Jalankan `head -c 65536 <path>` lewat `buildCommand`, dengan batas waktu 10 detik. Hasil: `{ok:true, text, truncated, name, mtime}`; kegagalan: `{ok:false, reason}`.

### CronWatcher dan notifikasi (F-CRON-5)
- `CronWatcher.ingest(jobs): CronAlert[]` memegang peta `profile/id → lastRunTs`.
- **Peta kosong = baseline:** semua job dicatat, tidak ada notifikasi. (Ini menjaga job lama yang sudah gagal sepuluh kali tidak berbunyi.)
- Sesudahnya, untuk job yang sudah dikenal: jika `lastRunTs` lebih besar dari yang tercatat **dan** `lastStatus` termasuk gagal (`error`, `delivery_failed`, `blocked_config`, atau diawali `error`), hasilkan satu alert. Job baru yang belum dikenal hanya dicatat. Peta dikosongkan saat berpindah koneksi (forget, host berbeda), tidak saat reconnect biasa, sehingga run gagal yang terjadi selama terputus tetap diberitahukan sekali.
- Penampil notifikasi disuntikkan (`notify(alert)`), sehingga logika bisa diuji tanpa Electron. Di `index.ts`: Electron `Notification` bila `Notification.isSupported()` **dan** jendela tidak fokus, diminimalkan, atau tidak terlihat. Judul `Cron failed: <nama job>`, isi `<profile> · <last_error 120 karakter | status>`. Klik: tampilkan, pulihkan, fokuskan jendela, kirim `evOpenCron {profile, jobId}`.
- Notifikasi tidak menyertakan prompt.

## 7. Renderer

### Store dan pustaka murni
- `stores/cron.ts`: `jobs`, `profiles`, `receivedAt`, `selected` (`profile/id` atau `null`), `filter {agent, status, query}`, `modalOpen`. Aksi: `applyCron(data, now)`, `select`, `setFilter`, `openModal(key?)`, `closeModal`, `reset`.
- `lib/cron.ts`: `jobKey`, `statusLabel` (`ok`→`OK`, `error`→`ERROR`, `delivery_failed`→`DELIVERY FAILED`, `null`→`NEVER RUN`, lainnya huruf besar apa adanya), `isFailure`, `stateLabel`, `counts(jobs)`, `filterJobs`, `sortJobs` (running dulu, lalu `nextRunTs` naik, `null` terakhir), `formatCountdown(ts, now)` (`in 3h 12m`, `in 40s`, `due`, `—`), `formatLocal(ts)`, `formatOffset(min)`.
- `lib/cronExpr.ts`: `nextOccurrences(job, fromTs, toTs, limit): number[]`. Mengurai ekspresi cron 5 field (`*`, `a`, `a-b`, `a,b`, `*/n`, `a-b/n`, nama bulan/hari tiga huruf, dow 7 = 0, semantik OR bila dom dan dow sama-sama dibatasi) dan evaluasi di zona `tzOffsetMin`. Juga mengenali interval sederhana (`every 30m`, `2h`, `1d`). Ekspresi tak dikenal: hanya `nextRunTs` yang dikembalikan. `nextRunTs` selalu menjadi titik pertama bila dalam jendela.

### Komponen
- `screens/dashboard/CronPanel.tsx`: kartu `variant="card"`, header `cron` dengan `N jobs` dan lencana teks `k error`, `p paused`, tombol ciut/buka dan tombol buka modal. Daftar ringkas (titik warna agent, nama, hitung mundur, label status). Mengganti panel placeholder di `Dashboard.tsx`. Ciut disimpan di `dashboard.cronOpen`.
- `screens/cron/CronModal.tsx` (memakai `Modal`, lebar 1120): header hitungan, `CronFilters`, `CronTimeline`, `CronTable`, `CronDetail`. Esc menutup.
- `CronTimeline`: lajur per agent (warna `agentColor`), titik terisi untuk job aktif dan outline untuk paused, sumbu `now … +24h`, tooltip nama job.
- `CronTable`: kolom sesuai F-CRON-1, baris bisa dipilih dengan klik atau keyboard (`role="listbox"`/`option` atau tabel dengan tombol di nama), kolom Status berupa label berborder dan teks.
- `CronDetail`: id, jadwal, state, model/provider, skills, repeat, deliver, prompt (teks biasa, `pre-wrap`), `Last error` (bila ada), baris "failed N runs in a row" bila `failureStreak ≥ 2`, waktu absolut lokal dengan offset VPS, dan bagian "Last output" yang memuat teks lewat `mc.cron.output` saat job dipilih (loading, kosong, error, dan penanda "truncated").
- Pembaruan: `bootstrap.ts` menangani `ev.type === 'cron'`, dan `onOpenCron` membuka modal pada job itu.

### State (F-STATE-1/2)
Loading: kerangka sampai event `cron` pertama. Empty: "No cron jobs yet. Jobs are created from a chat with an agent or from the terminal." Error: profile dengan `profiles[].error` ditampilkan sebagai catatan di header modal, job profile lain tetap tampil. Offline/reconnect: data lama tetap tampil dengan banner usia (`StaleBanner`). Hitung mundur tetap berjalan tiap detik dari jam lokal.

## 8. Penanganan error dan keamanan

- `jobs.json` rusak atau tidak terbaca: profile itu dicatat, tidak mematikan event dan tidak mematikan collector.
- Nilai tak dikenal (status, state, tipe jadwal) ditampilkan apa adanya.
- Tidak ada penulisan di VPS. Satu-satunya perintah baru adalah `head -c 65536 <path>`, dengan path yang dibuat main dan tervalidasi.
- Teks prompt, error, dan output dirender sebagai teks React (tanpa HTML), batas ukuran diterapkan di collector dan di main.
- Notifikasi tidak memuat prompt maupun output.

## 9. Strategi test

| Lapisan | Cakupan |
|---|---|
| pytest | Fixture `jobs.json` dari struktur nyata: job error dengan `failure_streak`, job belum pernah jalan (`last_status null`), `monitor_state`, `deliver: origin`, `telegram:<id>`; profile tanpa `jobs.json`; JSON rusak; daftar polos; berkas `.txt` lepas di `output/`; folder `output` kosong; ISO dengan `Z` dan offset; pemotongan prompt/error; digest tidak berubah ⇒ event tidak dikirim ulang; batas jumlah job; `.env`/`auth.json` tetap tidak dibuka; Zero-Change |
| pytest (koreksi M1) | Bentuk `gateway_state.json` nyata per profile; `default` aktif lewat `pid`; profile tanpa gateway offline; `gateway_state` berhenti ⇒ offline; `updated_at` basi tidak mematikan status; multiplex tetap jalan |
| Vitest | Skema zod `cron`; `lib/cron.ts` (hitungan, filter, urut, hitung mundur); `lib/cronExpr.ts` (daftar, rentang, step, nama, dow 7, OR dom/dow, offset zona, interval, ekspresi tak dikenal); `CronWatcher` (baseline, satu alert per run gagal, tidak ganda, job baru, reset); validasi `rel` dan `profile` di pembaca output; store cron |
| Integrasi | Server palsu + fixture cron: sesi menerbitkan event `cron`; `cron:output` memberi isi dan `truncated`; menolak job yang tidak ada dan `lastOutput` kosong; **tidak pernah** menerima path dari argumen; perintah yang dijalankan hanya `head`; Zero-Change |
| E2E | Panel Cron menampilkan job; ciut/buka bertahan setelah restart; klik baris membuka modal; filter agent/status/pencarian; detail memuat output; job error berlabel `ERROR` dan "failed N runs in a row"; modal tertutup dengan Esc |
| Visual | Screenshot modal dan panel dibandingkan dengan `mockup/src/_parts/cron.html` |

## 10. Kriteria selesai

1. Untuk fixture berbentuk data nyata, setiap job semua profile muncul di tabel dan sama dengan isi `jobs.json` (F-CRON-1, metrik PRD §9).
2. Status agent benar untuk susunan satu gateway per profile (koreksi M1).
3. Modal menampilkan timeline, filter, detail, dan output run terakhir; tidak ada aksi tulis.
4. Notifikasi terkirim tepat sekali per run gagal baru dan tidak ada notifikasi untuk error lama; hanya saat jendela tidak fokus.
5. Semua suite (vitest, pytest, E2E, typecheck) hijau, termasuk Zero-Change.
6. Daftar periksa manual `docs/manual-vps-checklist.md` diperluas untuk Cron.

## 11. Risiko khusus M2

| Risiko | Mitigasi |
|---|---|
| Format `jobs.json` berubah di versi Hermes lain (VPS pemilik 7.523 commit di belakang versi terbaru) | Normalisasi toleran, nilai tak dikenal ditampilkan apa adanya, profile bermasalah dilaporkan tanpa mematikan yang lain |
| `state`/`last_status` bernilai di luar dugaan (`running`, `completed`, `delivery_failed`) | Pemetaan tertulis dengan fallback `scheduled`, label teks dari nilai mentah |
| Ekspresi cron yang tidak didukung (mis. `@daily`, `L`, `#`) | Hanya `next_run_at` yang digambar; tidak crash |
| Prompt besar membuat IPC berat | Dipotong 4000 karakter dan event dikirim hanya bila berubah |
| Notifikasi ganda saat reconnect | Peta `lastRunTs` bertahan antar-reconnect, hanya direset saat berpindah koneksi |
| Zona waktu VPS berbeda dari komputer | Waktu relatif dan lokal ditampilkan bersama offset VPS di detail |
