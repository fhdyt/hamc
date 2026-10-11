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

## Melaporkan hasil

Catat tiap langkah sebagai lolos atau tidak, beserta teks error dan versi Hermes (`hermes --version`). Hasilnya menjadi masukan untuk memperbaiki tebakan format yang belum terdokumentasi di Hermes: `gateway_state.json`, `schema_version` di `state.db`, dan keluaran `hermes config get model --json`.
