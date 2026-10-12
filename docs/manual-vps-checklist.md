# Daftar periksa uji manual M1 di VPS Hermes nyata

Test otomatis memakai server SSH palsu dan fixture `~/.hermes`. Daftar ini mengisi bagian yang tidak bisa diuji otomatis: Hermes dan VPS sungguhan. Anda sendiri yang mengetik password di aplikasi. Aplikasi tidak pernah meminta Anda menaruhnya di berkas.

Jalankan aplikasi dengan `npm run build && npm run preview` (atau `npm run dev`).

## Sebelum mulai (di VPS)

Catat waktu mulai dan jumlah berkas yang berubah, tanpa menyentuh Hermes:

```bash
date -u +%Y-%m-%dT%H:%M:%S > /tmp/mc-start.txt   # catatan lokal Anda, bukan bagian dari aplikasi
find ~ -xdev -type f -newermt "$(cat /tmp/mc-start.txt)" 2>/dev/null | wc -l
```

Berkas `/tmp/mc-start.txt` itu ulah Anda sendiri untuk pengukuran. Hapus setelah selesai.

## Langkah

1. Layar Connect muncul. Isi host, port, user (user yang menjalankan Hermes), password, lalu klik **TEST & CONNECT**.
2. Fingerprint yang tampil sama dengan keluaran `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` di VPS. Klik **TRUST & CONTINUE**.
3. Preflight semuanya hijau: versi Hermes terbaca, jumlah profile benar, `state.db` terbaca, interpreter Python ditemukan. Catat item kuning atau merah beserta petunjuknya.
4. Dashboard: angka "active agents of N" sama dengan profile yang gateway-nya aktif di `hermes profile list`. Nama tampilan mengikuti `display_name` di `profile.yaml`. Pilih satu agent dan cek modelnya sama dengan `hermes -p <profile> config get model`.
5. Kirim satu pesan ke salah satu agent (Telegram atau CLI): status berpindah ke WORKING dalam ≤ 30 detik lalu kembali IDLE.
6. Buat profile baru (`hermes profile create <nama>`): muncul di roster dalam ≤ 10 detik.
7. Layar Server: CPU, memori, disk, jaringan, dan proses bergerak tiap detik. Bandingkan beberapa angka dengan `htop` atau `btop` di VPS. Filter "Hermes only" menyisakan proses Hermes.
8. Tutup aplikasi dan buka lagi: layar Launch tersambung sendiri tanpa form.
9. Putuskan jaringan komputer Anda 20 detik lalu nyalakan lagi: status bar menampilkan Reconnecting, data lama tetap tampil dengan usianya, lalu pulih sendiri.
10. Host key berubah: pakai VPS kedua dengan IP yang sama, atau pasang ulang host key SSH. Aplikasi harus memblokir sampai Anda menyetujui fingerprint baru.
11. Setelah semua langkah, jalankan lagi perintah `find ... -newermt` dengan waktu mulai. Hanya data normal Hermes (log, `state.db`) yang boleh berubah. Tidak boleh ada skrip atau berkas Mission Control di VPS.
12. Selama aplikasi terbuka, jalankan `ps aux | grep "python.* -u -"` di VPS: ada satu proses collector. Setelah aplikasi ditutup, proses itu hilang dalam ≤ 2 detik.

## Tambahan M2: status agent dan Cron

13. **Status agent per gateway.** Untuk setiap profile yang gateway-nya Anda jalankan sendiri, statusnya IDLE atau WORKING. Profile yang gateway-nya mati atau tidak punya gateway tampil OFFLINE. Cocokkan dengan `hermes -p <profile> gateway status` (atau `ps`). Ini koreksi dari M1: profile `default` tidak boleh OFFLINE bila gateway-nya hidup.
14. **Jumlah job.** Header panel Cron di Dashboard ("N jobs") sama dengan jumlah baris `hermes cron list` dijumlahkan untuk semua profile. Bandingkan juga nama dan jadwalnya.
15. **Job gagal.** Job yang `last_status`-nya error berlabel `ERROR`, menampilkan "Failed N runs in a row" sesuai `failure_streak`, dan teks error terakhir. Panel Dashboard menampilkan `k error` berwarna merah.
16. **Output.** Pilih sebuah job di modal Cron: "Last output" sama dengan isi berkas terbaru di `~/.hermes/**/cron/output/<id>/`. Job yang hanya punya berkas lepas `<id>_*.txt` juga tampil. Job yang belum pernah jalan menyatakan belum ada output.
17. **Timeline 24 jam.** Titik di timeline jatuh pada jam yang sama dengan jadwal job (bandingkan dengan `next_run_at`). Jadwal yang tidak dikenal hanya menggambar satu titik.
18. **Zona waktu.** Waktu di detail tampil dalam zona waktu komputer Anda; baris "server time" menunjukkan offset VPS (mis. `UTC+07:00`).
19. **Notifikasi.** Biarkan jendela tidak fokus (atau diminimalkan), lalu biarkan satu job gagal pada jadwalnya (atau buat job uji lewat chat dengan agent yang pasti gagal). Notifikasi OS muncul **sekali**, mengklik notifikasi membuka modal Cron pada job itu. Tidak ada notifikasi untuk job yang sudah gagal sebelum aplikasi dibuka, dan tidak ada saat jendela sedang fokus.
20. **Hanya baca.** Tidak ada tombol Pause, Resume, Run now, atau Edit di modal Cron, dan langkah 11 (tidak ada berkas baru di VPS) tetap berlaku setelah Anda membuka modal dan output job.

## Tambahan M3: Live feed

21. **Riwayat.** Buka layar Live feed: item terbaru ada di atas, tiap item berwarna sesuai agent dan menyebut sumber sesinya (telegram, cli, cron, subagent). Cocokkan beberapa pesan terakhir dengan isi `hermes sessions` atau obrolan Anda sendiri.
22. **Pesan baru ≤ 2 detik.** Kirim satu pesan ke agent. Pesan Anda, lalu thinking, tool call, tool result dan balasan, muncul di atas dalam beberapa detik tanpa menutup atau membuka ulang layar.
23. **Thinking dan teks panjang.** Blok thinking tampil miring dan terpotong dua baris, **Expand thinking** membukanya. Teks panjang punya **Show more**; teks yang dipotong collector (di atas 4.000 karakter) punya **Show full** yang mengambil teks utuh dari VPS.
24. **Filter.** Matikan satu agent, satu jenis item (mis. Tool result) dan satu sumber: daftar menyesuaikan. **Reset filters** mengembalikan semuanya. Pencarian menemukan kata di isi pesan dan nama tool.
25. **Gulir.** Gulir ke bawah beberapa layar: riwayat lebih lama termuat sendiri sampai muncul "Start of history". Saat Anda menggulir menjauh dari atas dan ada pesan baru, tombol **N new · Jump to latest** muncul dan posisi baca tidak melompat.
26. **Sesi lengkap.** Arahkan kursor ke sebuah item lalu klik ikon riwayat: dialog sesi menampilkan seluruh percakapan sesi itu beserta sub-session (subagent) yang bisa dibuka satu per satu.
27. **Dashboard.** Panel Activity memuat item terbaru; klik membuka feed di dialog dengan isi yang sama. Kartu agent menampilkan angka hari ini (sesi, pesan, tool call, token, biaya) dan tombol **Open feed** yang menyaring feed ke agent itu. Bandingkan jumlah sesi dan token dengan tabel `sessions` di `state.db`.
28. **Sambung ulang.** Putuskan jaringan 20 detik lalu nyalakan lagi saat agent sedang bekerja: item yang masuk selama putus muncul setelah pulih, tanpa duplikat dan tanpa celah.
29. **Hanya baca.** Langkah 11 dan 12 tetap berlaku setelah memakai feed, termasuk **Show full** dan dialog sesi: tidak ada berkas baru di VPS, dan `state.db` hanya dibuka `mode=ro`.

## Tambahan M4a: Second brain

30. **Pilih vault.** Buka Second brain. Ketik path vault di VPS (atau pakai **Browse**, yang hanya membaca daftar folder). Jumlah catatan yang ditampilkan ("Found N notes") sama dengan `find <vault> -name '*.md' -not -path '*/.*' | wc -l`. Path yang salah menampilkan alasan, dan tombol **Use this vault** mati.
31. **Graph.** Setiap catatan menjadi node, setiap `[[wikilink]]` menjadi garis; node yang banyak terhubung lebih besar. Zoom (roda mouse), geser (seret latar), seret sebuah node. Label memudar saat zoom keluar.
32. **Aturan link.** Cocokkan beberapa catatan dengan Obsidian Anda: `[[a|alias]]`, `[[catatan#heading]]`, `![[embed]]`, link markdown `[x](catatan.md)`, alias di frontmatter, dan tag bertingkat `#a/b`. Link ke catatan yang tidak ada tampil sebagai node abu-abu ("Missing note"). Link dan tag di dalam blok kode tidak dihitung. Folder `.obsidian`, `.git`, `.trash` dan folder berawalan titik diabaikan.
33. **Hover dan klik.** Hover menyorot node dan tetangganya dan meredupkan sisanya. Klik membuka pratinjau markdown dengan Backlinks dan Outgoing links; klik link di dalam teks pindah ke catatan itu. **Local graph** 1, 2 atau 3 membatasi graph ke sekitar catatan itu.
34. **Realtime.** Minta agent (atau Anda sendiri) membuat catatan baru di vault. Node baru muncul dengan denyut hijau dalam ±3 detik tanpa mengacak letak node lain. Mengubah isi atau menghapus catatan juga tercermin.
35. **Kontrol.** Filters (cari, `tag:#x`, `path:folder`, Tags, Attachments, Existing files only, Orphans), Groups (warna per query), Display dan Forces mengubah graph seketika. Tutup lalu buka lagi aplikasi: semua pengaturan masih sama.
36. **Dashboard.** Panel "second brain" memuat graph kecil; klik sebuah node membuka dialog pembaca catatan. Tombol di kanan atas panel membuka layar penuh.
37. **Vault besar.** Bila vault berisi lebih dari 20.000 catatan, header menyebut hanya sebagian yang ditampilkan. Dengan ±5.000 catatan graph tetap lancar (≥ 30 fps).
38. **Hanya baca.** Langkah 11 dan 12 tetap berlaku: tidak ada berkas baru di VPS, dan di `ps aux` ada satu proses collector tambahan (`python -u - ... --vault`) selama vault aktif yang hilang saat aplikasi ditutup.

## Tambahan M5: Chat dan unggah berkas

39. **Spike `hermes chat --help` (sekali, sebelum menguji chat).** Di VPS jalankan `hermes chat --help` dan simpan keluarannya. Aplikasi membaca daftar flag itu sendiri (`--oneshot`, `--query-file`, `--format stream-json`, `--source`, `--resume`, `-Q`). Bila `--format stream-json` atau `--query-file` tidak ada, chat memakai mode terbatas (tanpa chip tool langsung) dan layar menyebutkan alasannya. Kirim keluaran `--help` itu agar parser bisa dicocokkan dengan format asli.
40. **Kirim pesan.** Buka Chat, pilih sebuah agent, kirim "halo". Balasan muncul bertahap sebagai markdown (daftar, tabel, blok kode dengan tombol **Copy**). Setelah selesai tampil durasi dan jumlah token. Cek di VPS: `hermes sessions list` memuat sesi baru dengan sumber `mission-control`.
41. **Tool dan thinking.** Minta agent memakai satu tool (mis. cari di web). Chip tool muncul selagi berjalan (`web_search…` lalu `web_search ✓ 1.2s`). Beberapa detik setelah selesai, blok **Thinking** dan langkah tool (dengan argumen dan hasilnya) muncul dari `state.db` dan bisa dibuka.
42. **Lanjutkan percakapan.** Kirim pesan kedua: agent mengingat yang pertama (sesi yang sama, `--resume`). **Clear chat** mengosongkan percakapan dan memulai sesi baru (yang lama tetap di server dan di History); **History** memuat daftar obrolan lama dan memilih salah satu melanjutkannya. Tutup dan buka lagi aplikasi: agent yang sama tetap melanjutkan sesinya.
43. **Stop.** Kirim tugas yang lama, tekan **Stop**: balasan berhenti dalam beberapa detik dan tertulis "Stopped". Pastikan tidak ada proses `hermes chat` yatim di `ps aux`.
44. **Kebijakan approval.** Minta tindakan yang diblokir kebijakan Hermes (mis. menghapus berkas). Aplikasi menampilkan pesan blokir dari Hermes dan **tidak** pernah menambahkan `--yolo` atau mengubah kebijakan.
45. **Error.** Matikan sementara kunci provider agent (atau pakai agent yang modelnya salah): pesan error dari Hermes tampil di percakapan, bukan spinner yang tak berakhir.
46. **Unggah berkas.** Klik **Attach files** (atau seret berkas ke kotak pesan), pilih satu gambar dan satu PDF, lalu kirim. Bilah progres bergerak, pesan Anda memuat kartu berkas, dan agent bisa membacanya. Di VPS: `ls -la ~/hermes-uploads/<agent>/<tanggal>/` berisi berkas itu dengan izin `0600` (folder `0700`). Nama berkas yang berbahaya (`../x`, spasi, karakter aneh) dibersihkan; berkas bernama sama mendapat akhiran `-1`.
47. **Batas ukuran dan batal.** Berkas di atas batas (50 MB; atur di Settings → Uploads) ditolak dengan alasan. Batalkan unggahan besar di tengah jalan: berkas separuh jadi tidak tertinggal di VPS.
48. **Settings → Uploads.** Daftar berkas yang diunggah cocok dengan isi `~/hermes-uploads`. Menghapus sebuah berkas meminta konfirmasi lalu menghapusnya di VPS; berkas lain (di luar `~/hermes-uploads/<agent>/<tanggal>/`) tidak bisa dihapus dari sini.
49. **Backend terminal.** Pada agent dengan `terminal.backend` selain `local` (docker, ssh, modal), memasang berkas menampilkan peringatan bahwa folder unggahan mungkin tidak terlihat dari sandbox agent.
50. **Dashboard.** Di panel Agents, memilih agent membuka ruang chat yang sama; ikon info membuka kartu detail dan **Open full chat** pindah ke layar Chat.
51. **Zero-Change.** Satu-satunya yang ditulis ke VPS adalah berkas unggahan (lewat SFTP, hanya saat Anda menekan Kirim) dan sesi chat milik Hermes sendiri. Tidak ada skrip, port, atau berkas bantu baru, dan `.env` serta `auth.json` tidak dibaca.

52. **Mode ACP tersedia.** Di VPS `hermes acp --check` menampilkan `Hermes ACP check OK`. Di aplikasi, Settings → Chat → **Ask before risky actions** menyala (bawaan). Kirim satu pesan: di VPS `ps aux | grep "hermes.* acp"` menunjukkan satu proses per agent yang dipakai, dan proses itu tetap hidup di antara pesan. Tutup aplikasi: prosesnya hilang.
53. **Persetujuan.** Minta agent melakukan sesuatu yang oleh kebijakan Hermes perlu persetujuan (mis. menghapus berkas di luar allowlist). Kartu **Hermes asks for your approval** muncul di chat dengan perintahnya dan tombol sesuai pilihan Hermes (Allow once, Always allow, Deny). **Deny** membuat agent menjawab bahwa ia tidak diizinkan; **Allow once** menjalankannya. Kartu yang sudah dijawab tetap terlihat ("Allowed: …" / "Denied: …"). Catat nama pilihan yang dikirim Hermes dan apakah "Always allow" menambah `command_allowlist` di config agent (itu perilaku Hermes sendiri, bukan aplikasi).
54. **Stop.** Saat kartu persetujuan terbuka, tekan **Stop**: kartu menjadi "Not answered", giliran berakhir sebagai "Stopped", dan agent bisa dipakai lagi. Hal yang sama bila Anda menutup aplikasi.
55. **Ingatan.** Kirim "1+1", lalu "tambah 3": agent menjawab 5 (satu sesi). **Clear chat** memulai sesi baru. Setelah menutup dan membuka aplikasi, pesan berikutnya memuat sesi lama (`session/load`) atau, bila Hermes tidak mendukungnya, memulai yang baru.
56. **Tanpa ACP.** Matikan saklar di Settings → Chat: chat kembali ke mode satu kali jalan (`hermes chat -Q`), dan tindakan berisiko ditolak menurut kebijakan Hermes. Aplikasi tidak pernah menambahkan `--yolo`, tidak mengubah `approvals.*`, dan tidak menjalankan `hermes config set` untuk chat.
57. **Format nyata.** Bila kartu tidak muncul atau teks tool aneh, catat keluaran `hermes acp` yang sebenarnya (pesan `session/update` dan `session/request_permission`) dan kirim ke pengembang; bentuk pesan ACP Hermes belum diverifikasi.

## Tambahan M6: pengaturan agent

Sebelum menguji Model, jalankan skrip di `docs/spike-m6-hermes-cli.md` di VPS dan kirim keluarannya; parser untuk `config get model --json`, `status` dan opsi stdin dicocokkan dengan format asli.

58. **Buka.** Klik ikon gear di panel Agents (Dashboard): Settings terbuka di **Agents** dengan agent yang dipilih. Tab: Model, SOUL.md, Memory, User profile.
59. **Soul.** Buka SOUL.md: isi sama dengan `cat ~/.hermes/SOUL.md` (atau `profiles/<nama>/SOUL.md`). Ubah satu baris, tekan **Save**: dialog menampilkan diff. Simpan; di VPS `ls -la` menunjukkan izin berkas tetap sama dan tidak ada berkas `.SOUL.md.mc-*` tersisa. Untuk agent tanpa SOUL.md muncul **Create SOUL.md**.
60. **Memory dan User.** Entri `§` tampil sebagai kartu (ubah, tambah, hapus, geser) dan ada mode Raw. Penghitung merah di atas 2.200 (Memory) atau 1.375 (User) karakter dan Save mati. Setelah simpan, `hermes` di sesi baru membaca isi yang baru.
61. **Konflik.** Buka MEMORY.md, ubah teks di aplikasi, lalu di VPS tambahkan satu entri dengan `echo` ke berkas yang sama. Dalam ±5 detik muncul pita "changed on the server". Tekan Save: dialog konflik muncul dan tidak ada yang tertimpa. **Take theirs**, **Merge** dan **Keep mine** (dengan konfirmasi kedua) bekerja; Merge dengan edit yang bertabrakan memberi penanda `<<<<<<<` dan Save mati sampai diperbaiki.
62. **Revert dan unsaved.** Setelah simpan, **Revert last save** mengembalikan teks lama ke editor (menyimpannya tetap lewat diff). Pindah agent atau tutup Settings dengan perubahan belum disimpan: muncul "You have unsaved changes". Menutup jendela aplikasi juga bertanya. Putuskan koneksi: editor tetap berisi, Save mati.
63. **Model: baca.** Tab Model menampilkan provider, model dan reasoning yang sama dengan `hermes -p <p> config get model` dan `hermes status`. Catat jika provider yang punya key tidak bertanda "key saved ✓" (format `status` perlu dicocokkan).
64. **Model: daftar dan simpan.** Pilih Custom atau OpenRouter, isi Base URL dan key, **Fetch models** (daftar tampil dengan ctx), pilih model, lihat pratinjau perintah (key tampil `••••`), Save. Di VPS: `hermes config get model --json` menunjukkan nilai baru, dan `ps aux` selama Save tidak memuat key (jika Hermes tidak punya `--stdin`, banner peringatan muncul dan key lewat argumen). Kolom key kosong setelah Save, dan key tidak pernah tampil lagi.
65. **Test dan restart.** **Test saved model** menjawab ✓ dengan latensi. **Restart this agent's gateway** meminta konfirmasi lalu menjalankan `hermes -p <p> gateway restart` hanya untuk agent itu.
66. **Zero-Change.** Yang berubah di VPS hanyalah berkas yang Anda simpan, hasil `hermes config set`, dan gateway yang Anda restart. `.env` dan `auth.json` tidak dibaca (tidak ada `cat` atau SFTP ke keduanya), tidak ada skrip atau berkas bantu baru.

## Tambahan M4b: graph agent

Semua format di bagian ini adalah tebakan dari PRD dan belum diverifikasi di Hermes asli; catat yang berbeda.

67. **Skema kanban.** Di VPS jalankan `sqlite3 ~/.hermes/kanban.db .schema` (dan untuk `kanban/boards/*/kanban.db`). Collector mencari tabel `tasks` dengan kolom id, assignee, pembuat (`created_by`/`creator`/...) dan `task_events(task_id, ts)`. Buat satu tugas dari agent A untuk agent B: di tab **agents** muncul garis oranye A -> B berlabel `#<id>`. Bila tidak muncul, kirim keluaran `.schema` ke pengembang; status sumber kanban di keadaan kosong menunjukkan `unreadable` bila skemanya tidak dikenal.
68. **message_agent.** Kirim pesan antar agent (Bot Mode). Di `state.db` agent tujuan harus ada sesi berjudul `Bot Chat` dengan pesan `Message from <nama> (@handle):`. Garis pink berlabel `msg` muncul dari pengirim ke tujuan, dan kartu detail menampilkan teks pesan terakhir. Pesan dari nama atau handle yang bukan profile dihitung "unresolved" dan tidak digambar.
69. **Room.** Untuk group chat, sesi anggota harus berjudul `Group: <room> · <thread>`. Muncul node kotak room dengan garis ungu ke tiap anggota; kartu menunjukkan anggota dan baris terakhir.
70. **delegate_task.** Jalankan tugas yang memakai subagent. Muncul lingkaran putus-putus cyan di dekat agent induk, terisi saat berjalan (kurang dari 5 menit tanpa `ended_at`). Catat nilai `source` dan `parent_session_id` yang sebenarnya.
71. **Realtime dan Zero-Change.** Garis aktif (kejadian dalam 60 detik) bertitik bergerak, dan data baru tampil dalam sekitar 2 detik. **Open session** di kartu membuka sesi di Live feed. Selama ini tidak ada berkas baru di VPS dan collector tidak menjalankan `hermes`; `kanban.db` dan `state.db` dibuka `mode=ro`.

## Melaporkan hasil

Catat tiap langkah sebagai lolos atau tidak, beserta teks error dan versi Hermes (`hermes --version`). Hasilnya menjadi masukan untuk memperbaiki tebakan format yang belum terdokumentasi di Hermes: `gateway_state.json`, `schema_version` di `state.db`, dan keluaran `hermes config get model --json`.
