# Spike M6: format CLI Hermes asli

> M6 sudah dibangun dengan parser toleran dan fake Hermes. Menjalankan skrip ini tetap dianjurkan: keluarannya dipakai untuk mencocokkan parser (`src/main/agentcfg/parse.ts`) dan fixture dengan format asli, terutama `config get model --json`, `status` dan opsi stdin di `config set`.

Tujuan: mengetahui bentuk asli keluaran dan flag `hermes` yang dipakai bagian **Model** di M6 (F-CFG-1..9), sebelum desainnya ditulis. Semua perintah di bawah hanya **membaca**: tidak ada yang menulis berkas, mengubah konfigurasi, atau menjalankan model. Tidak ada yang membaca `.env` atau `auth.json`.

## Cara menjalankan

Buka terminal SSH ke VPS sebagai user yang menjalankan Hermes. Ganti `PROFILE` dengan nama sebuah profile non-default yang ada (lihat keluaran `hermes profile list`; bila hanya ada `default`, hapus bagian `-p PROFILE`). Tempel **seluruh blok** sekaligus, lalu salin keluarannya.

```bash
P=PROFILE
run() { echo; echo "=== $*"; "$@" 2>&1 | head -n 80; echo "[exit ${PIPESTATUS[0]}]"; }
run hermes --version
run hermes profile list
run hermes -p "$P" config get model --json
run hermes -p "$P" config get model
run hermes -p "$P" config get agent.reasoning_effort --json
run hermes -p "$P" config get providers --json
run hermes -p "$P" config get terminal.backend
run hermes -p "$P" status
run hermes config --help
run hermes config set --help
run hermes config get --help
run hermes auth --help
run hermes auth add --help
run hermes gateway restart --help
run hermes chat --help
```

## Sebelum menempel hasilnya

- **Periksa dan sensor rahasia.** `config get model --json` dan `status` seharusnya menampilkan key dalam bentuk bertopeng (mis. `sk-o…7890`). Bila ada nilai key utuh, token, atau password di keluaran, ganti dengan `REDACTED` sebelum dikirim.
- Alamat IP VPS dan nama profile boleh dibiarkan.
- Bila sebuah perintah gagal, tetap tempel keluarannya (pesan error itu berguna).

## Yang ingin diketahui dari hasilnya

| Pertanyaan | Dilihat dari |
|---|---|
| Apakah `config get ... --json` ada, dan bentuk JSON-nya (objek `model`: `provider`, `default`, `base_url`)? | `config get model --json` |
| Apakah `config set` menerima nilai dari stdin (mis. `-`, `--stdin`, `--value-file`)? Bila tidak, key harus lewat argumen. | `config set --help`, `auth add --help` |
| Apakah daftar provider dan status kredensial bisa dibaca dari `status` (format teks seperti apa)? | `status` |
| Apakah `providers.*` ada di `config get` dan seperti apa isinya? | `config get providers --json` |
| Apakah `gateway restart` menerima `-p` dan apa yang dicetaknya? | `gateway restart --help` |
| Versi Hermes yang dipakai untuk fixture uji. | `--version` |
