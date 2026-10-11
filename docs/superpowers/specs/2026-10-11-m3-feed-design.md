# M3 Live feed: desain

Tanggal: 2026-10-11. Sumber kebutuhan: PRD v1.3 §6.5 (F-FEED-1..6), §6.2 (F-AGENT-3, F-AGENT-4), §6.20 (F-R12-4), §7 (NF-1, NF-5, NF-7), §10 (M3). Referensi visual: `mockup/src/LiveFeed.dc.html` dan `mockup/src/_parts/feed.html`. Melanjutkan spec M1 dan M2.

## 1. Tujuan

Satu feed gabungan dari semua agent, hampir realtime: pesan user, balasan agent, thinking, tool call, dan hasil tool, dibaca dari `state.db` tiap profile (hanya baca). Tampil di layar Live feed, di kartu Activity Dashboard, dan di modalnya. Ditambah statistik harian per agent dan tombol buka-feed di kartu agent.

## 2. Cakupan

| Requirement | Isi |
|---|---|
| F-FEED-1 | Timeline gabungan, diberi warna agent dan sumber sesi |
| F-FEED-2 | Lima jenis item: user, reply, thinking (miring, bisa dilipat), tool (nama + argumen), result (dipotong, bisa dibuka penuh) |
| F-FEED-3 | Item baru ≤ 2 detik setelah ditulis; "Jump to latest" bila pengguna sedang menggulir |
| F-FEED-4 | Filter agent, jenis, sumber, dan pencarian teks |
| F-FEED-5 | Tampilan satu sesi lengkap termasuk relasi parent/subagent |
| F-FEED-6 | 200 item terakhir saat dibuka, riwayat lebih lama dimuat saat menggulir, list tervirtualisasi |
| F-AGENT-3 | Statistik hari ini per agent: sesi, pesan, tool call, token, biaya |
| F-AGENT-4 | Tombol "Open feed" di kartu agent membuka feed terfilter ke agent itu |
| F-R12-4 | Klik kartu Activity membuka modal Live feed |
| NF-7 | Setelah reconnect, feed dilanjutkan dari id pesan terakhir yang diterima |

### Tidak masuk M3
Streaming token (melanggar Zero-Change, Q5). Indikator "is typing". Render markdown (teks biasa dulu). Tombol Chat/Settings di kartu agent (M5, M6). Menyimpan isi pesan ke disk lokal (dilarang NF-5).

### Keputusan desain (asumsi, bisa dikoreksi)
- **Urutan terbaru di atas**, mengikuti mockup ("newest first"). "Auto-scroll" berarti menempel di atas; tombol "Jump to latest" muncul bila pengguna menggulir ke bawah dan ada item baru.
- Isi percakapan hanya ada di memori. Tidak ada yang ditulis ke `app.db`.

## 3. Bentuk data nyata (Hermes v0.21.0)

Kolom teramati: `messages(id, session_id, role, content, tool_call_id, tool_calls, tool_name, effect_disposition, timestamp, token_count, finish_reason, reasoning, reasoning_content, reasoning_details, ..., observed, active, compacted, api_content, _compressed_summary, display_kind, display_metadata)` dan `sessions(id, source, user_id, ..., model, parent_session_id, started_at, ended_at, end_reason, message_count, tool_call_count, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, estimated_cost_usd, actual_cost_usd, ..., profile_name, title, archived, hidden, ...)`. Kolom bisa bertambah atau berkurang antar profile dan versi.

Belum diketahui dan karena itu dibaca toleran: bentuk JSON `tool_calls` (diharapkan gaya OpenAI: `[{"id","type":"function","function":{"name","arguments"}}]`, juga diterima `{"name","arguments"|"input"}`), tipe `timestamp` (epoch detik, epoch milidetik, atau ISO), tipe `content` (string, atau daftar/objek yang di-JSON-kan).

## 4. Collector

### Event `feed`
`{"type":"feed","ts":...,"profile":null,"data":{"items":[FeedItem...],"cursors":{"<profile>":<maxId>},"history":<bool>}}`.

- **Penentuan kolom.** Per profile, `PRAGMA table_info` pada `messages` dan `sessions` menentukan kolom yang dipakai. `messages` tanpa `id`, `session_id`, `role`, atau `timestamp` ⇒ error `unsupported_schema` (dedupe seperti M1) dan profile itu dilewati. Kolom opsional yang hilang dianggap kosong.
- **Pemilihan baris:** `active=1` bila kolom ada, `role IN ('user','assistant','tool')`, `id > cursor`, `ORDER BY id`, `LIMIT 500` per profile per siklus. Digabung `LEFT JOIN sessions` untuk `source`, `parent_session_id`.
- **Awal:** tanpa kursor, ambil `HISTORY_ROWS = 60` baris terakhir tiap profile (dikirim sebagai `history: true`, bagian dari 200 item awal). Dengan argumen `--cursors '<json>'` (diteruskan main setelah reconnect), ambil semua baris dengan `id > cursor` (maksimum 500 per siklus, sisanya siklus berikutnya).
- **Siklus:** mengikuti interval metrik (1 detik). `state.db` dibuka `?mode=ro` per siklus dan ditutup lagi. Profile tanpa baris baru tidak menghasilkan event.
- **Pemetaan baris → item** (satu baris bisa menghasilkan beberapa item, `n` adalah urutan dalam baris):

| Baris | Item |
|---|---|
| `role=user` | `user` |
| `role=assistant` | `thinking` (dari `reasoning_content`, lalu `reasoning`, bila tidak kosong), `reply` (bila `content` tidak kosong), lalu satu `tool` per entri `tool_calls` (teks `nama {argumen}`) |
| `role=tool` | `result` (`toolName` dari `tool_name`) |
| lainnya (`system`, dsb.) | dilewati |

- **FeedItem:** `{id: "<profile>:<messageId>:<n>", profile, messageId, sessionId, source, parentSessionId, ts (epoch detik), kind, text, truncated, fullLen, toolName}`.
- **Batas teks:** user, reply, thinking 4000 karakter; tool 1500; result 1200. `truncated` dan `fullLen` memberi tahu UI bahwa ada lebih banyak.
- **Id tertinggi** per profile dilaporkan di `cursors` pada setiap event agar main bisa melanjutkan.

### Statistik harian (F-AGENT-3)
Event `agents` mendapat field `stats` per agent (`null` bila tidak terbaca): `{sessions, messages, toolCalls, inputTokens, outputTokens, reasoningTokens, costUsd}` dari `sessions` dengan `started_at` ≥ tengah malam lokal VPS hari ini. `costUsd` memakai `actual_cost_usd` bila ada, jika tidak `estimated_cost_usd`. Kolom hilang dianggap 0.

## 5. Skrip query sesuai permintaan: `collector/mc_query.py`

Collector tidak menerima perintah (stdin ditutup), jadi bagian yang butuh parameter memakai skrip kedua yang juga dikirim lewat stdin, sekali per permintaan, dengan `python -u - <home> <perintah> <json-argumen>`. Hanya baca (`?mode=ro`), stdlib, ASCII, tidak menulis apa pun, keluar setelah satu jawaban JSON.

| Perintah | Argumen | Hasil |
|---|---|---|
| `message` | `{profile, messageId, field: "content"\|"reasoning"\|"tool_calls", index?}` | teks penuh (≤ 65536 byte) dan `truncated` |
| `history` | `{profile?, beforeTs, limit}` | `items` (format FeedItem) yang lebih lama dari `beforeTs`, urut menurun |
| `session` | `{profile, sessionId}` | info sesi (`source`, `model`, `startedAt`, `endedAt`, `parentSessionId`, id anak) dan `items` sesi itu (≤ 500) |

Semua argumen divalidasi di skrip (profile `^[A-Za-z0-9._-]{1,64}$`, id numerik atau `[A-Za-z0-9._:-]{1,128}`) dan di main (zod) sebelum perintah dibuat.

## 6. Main process

- `FeedCursors`: peta `profile → id terakhir` diperbarui dari event `feed`. Dihapus saat berpindah koneksi atau forget (seperti watcher M2), dipertahankan saat reconnect. `startCollector` meneruskan `--cursors <json>` bila peta tidak kosong.
- `QueryRunner` (`src/main/query.ts`): menjalankan `python -u - <home> <perintah> <json>` dengan skrip `mc_query.py` lewat `ConnectionManager.exec` (stdin = skrip), batas waktu 15 detik, membatasi keluaran 1 MiB, mengurai dan memvalidasi hasil dengan zod. Tidak pernah memakai path dari renderer.
- IPC baru: `feed:message`, `feed:history`, `feed:session`. Preload dan `MissionApi.feed.{message, history, session}`.
- Skema zod bersama: `FeedItem`, `FeedData`, varian `feed` pada `CollectorEvent`, `AgentStats`, `SessionDetail`.

## 7. Renderer

- **Store `feed`:** `items` (peta id → item), diurutkan menurun menurut `ts` lalu `messageId` lalu `n`; dedupe lewat id; batas 5000 item (yang terlama dibuang kecuali sedang dibuka di tampilan sesi); `filter {agents: Set tersembunyi, kinds: Set tersembunyi, source, query}`; `unseen` (jumlah item baru sejak pengguna menggulir); `historyExhausted`; aksi `applyFeed`, `prepend(older)`, `setFilter`, `reset`.
- **Pustaka `lib/feed.ts`:** `filterItems`, `kindLabel`/`kindColor` (USER putih, THINK cyan miring, TOOL oranye, RESULT abu, REPLY hijau), `formatClock(ts)`, `sources(items)`, `matchesQuery`.
- **Komponen:**
  - `FeedView` (dipakai layar dan modal): baris filter (chip agent seperti mockup, chip jenis, pilih sumber, pencarian), daftar tervirtualisasi (`@tanstack/react-virtual`, tinggi dinamis), menempel di atas, tombol "Jump to latest" (`N new`) saat tergulir, pemuatan riwayat saat mendekati dasar daftar (`feed.history`), thinking dilipat dengan toggle, result dipotong dengan tombol "Show full" (`feed.message`), klik waktu/ikon sesi membuka `SessionModal`.
  - `screens/Feed.tsx` (layar Live feed menggantikan `ComingSoon`), `ActivityCard` di Dashboard (daftar 8 item terbaru, klik membuka `FeedModal`), `FeedModal`, `SessionModal` (info sesi + relasi parent/anak yang bisa diklik + percakapan).
  - `AgentDetail`: blok statistik hari ini dan tombol "Open feed" yang menyetel filter agent lalu pindah ke layar Live feed (F-AGENT-4).
- **State:** loading (kerangka), empty ("No activity yet..."), error per profile (catatan di header), basi/offline (banner usia), unsupported schema (catatan).
- Teks dirender sebagai teks (tanpa HTML). Tombol dan chip punya `aria-pressed`/label; hitungan dan label jenis berupa teks.

## 8. Penanganan error dan keamanan

- Skema `state.db` tak dikenal atau tidak terbaca: error terdedupe, profile dilewati, profile lain tetap jalan.
- Query sesuai permintaan gagal atau habis waktu: UI menampilkan pesan dan tombol coba lagi; tidak mematikan feed.
- Tidak ada penulisan di VPS. Perintah baru hanya `python -u - ...` (baca). Skrip dan argumen tidak pernah digabung sebagai string shell.
- Isi percakapan tidak disimpan ke disk lokal dan tidak dicatat di log aplikasi.

## 9. Strategi test

| Lapisan | Cakupan |
|---|---|
| pytest | Pemetaan baris → item (user, reply, thinking dari kedua kolom, tool call dua bentuk JSON, result, role lain dilewati), potong dan `fullLen`, `content` non-string, timestamp (detik, milidetik, ISO), kolom opsional hilang, `active=0` diabaikan, `session` join (`source`, parent), kursor `--cursors`, riwayat awal 60 baris, batas 500, baris baru muncul dalam siklus berikutnya, skema tak dikenal terdedupe, WAL saat penulis terbuka, tidak membuka `.env`/`auth.json`, Zero-Change, ASCII; statistik harian (batas tengah malam lokal, biaya aktual vs estimasi) |
| pytest (`mc_query`) | `message` (tiap field, `truncated` 64 KiB, id tak ada), `history` (urut, batas, `beforeTs`), `session` (info + anak + batas 500), argumen tak valid ditolak, hanya baca, ASCII |
| Vitest | Skema zod baru; `lib/feed.ts`; store (dedupe, urutan, batas 5000, filter, `unseen`); `FeedCursors`; `QueryRunner` (argv, batas keluaran, validasi hasil, waktu habis) |
| Integrasi | Sesi dengan fixture berisi percakapan: item muncul, pesan baru yang ditulis ke fixture muncul < 3 detik, reconnect melanjutkan dari kursor tanpa duplikat dan tanpa celah, `feed.message`/`history`/`session` lewat server palsu, hanya perintah baca |
| E2E | Layar Live feed memuat 200 item terbaru, jenis berbeda tampil, filter dan pencarian, thinking terlipat, Show full pada result, pesan baru muncul, Jump to latest, klik sesi membuka modal, Open feed dari kartu agent memfilter, modal Activity dari Dashboard |
| Visual | Bandingkan dengan `mockup/LiveFeed.html` |

## 10. Kriteria selesai

1. Item dari semua profile fixture tampil terurut, dengan lima jenis yang berbeda secara visual.
2. Pesan baru yang ditulis ke `state.db` fixture muncul di UI ≤ 2 detik (NF-1, diuji dengan batas longgar 3 detik di E2E).
3. Reconnect tidak menggandakan maupun menghilangkan item.
4. Riwayat lama dimuat saat menggulir; "Show full" dan tampilan sesi bekerja.
5. Statistik harian dan "Open feed" muncul di kartu agent.
6. Semua suite hijau, termasuk Zero-Change; checklist manual diperluas.

## 11. Risiko khusus M3

| Risiko | Mitigasi |
|---|---|
| Bentuk `tool_calls` atau `timestamp` berbeda dari dugaan | Pengurai toleran dengan beberapa bentuk; nilai tak dikenal ditampilkan apa adanya |
| `state.db` besar atau banyak profile | Kueri berindeks (`id > cursor`), batas 500 per siklus, buka-tutup per siklus, riwayat hanya sesuai permintaan |
| Isi pesan besar | Dipotong di collector, penuh hanya sesuai permintaan dengan batas 64 KiB |
| Isi percakapan sensitif | Hanya di memori, tidak masuk log maupun disk |
| Banyak item membuat UI lambat | Virtualisasi, batas 5000 item, render per-baris ringan |
