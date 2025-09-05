# Discord Auto Message Bot — Web (Deno Deploy)

Antarmuka web "native" untuk menyiapkan dan menjalankan bot pengirim pesan Discord berkala (sesuai *main.py* dan *config.json* milikmu), dibangun untuk **Deno Deploy**.

> ⚠️ Catatan penting: Deno Deploy bersifat tanpa server yang dapat *scale to zero*. Interval yang berjalan berbasis memori proses dan dapat berhenti saat instance diganti/didongkrentikan. Untuk beban produksi, pertimbangkan scheduler/cron bawaan Deno Deploy atau infra worker terdedikasi. Proyek ini cocok untuk *demo*, *small utility*, atau manual run.

## Fitur
- Form input:
  - Nama bot
  - Token pengguna Discord (otomatis menambahkan `"Bot "` jika belum ada)
  - Target Channel ID
  - Unggah file `.txt` berisi daftar pesan (satu baris = satu pesan)
  - Interval kirim (detik)
- Tombol **Jalankan Bot** dan **Hentikan**
- Panel log aktivitas (real‑time via Server‑Sent Events / SSE) menampilkan sukses/gagal

## Struktur Berkas
```
deno-deploy/
├─ main.ts                # Server Deno (API + SSE + static)
├─ deno.json             # Task dev lokal
├─ static/
│  ├─ index.html         # UI utama
│  └─ client.js          # Logika sisi-klien
└─ README.md
```

## Menjalankan Secara Lokal
1. Instal [Deno](https://deno.land).
2. Jalankan:
   ```bash
   deno task dev
   ```
3. Buka `http://localhost:8000`

## Deploy ke Deno Deploy
1. Push folder ini ke GitHub (mis. repo `discord-auto-message-deno`).
2. Di [Deno Deploy](https://dash.deno.com/), buat proyek baru dan hubungkan ke repo tersebut.
3. Set `Entry file` ke `main.ts` (default Deno akan otomatis). Deploy.

## Cara Pakai
1. Buka aplikasi web yang sudah dideploy.
2. Isi **Token** (format `Bot YOUR_DISCORD_BOT_TOKEN`) dan **Channel ID**.
3. Unggah file `.txt` berisi daftar pesan, contoh:
   ```txt
   Halo semua!
   Sekarang jam {now}
   Jaga kesehatan ya
   ```
   Placeholder `{now}` akan otomatis diganti timestamp saat pengiriman.
4. Atur interval detik, klik **Jalankan Bot**.
5. Lihat log di panel kanan; gunakan tombol **Hentikan** untuk berhenti.

## Perbedaan dengan main.py
- *main.py* berjalan terus menerus di satu proses (VPS). Versi Deno ini berjalan selama instance aktif.
- Logging ditampilkan ke UI via SSE dan ke console server.
- Pengiriman pesan memakai `fetch()` langsung ke `https://discord.com/api/v10/...`

## Keamanan
- **Jangan** commit token bot ke repository publik.
- Token hanya dikirim dari browser ke server kamu saat menekan **Jalankan Bot**.
- Pertimbangkan menambahkan proteksi (basic auth atau rute admin) jika dibutuhkan.
