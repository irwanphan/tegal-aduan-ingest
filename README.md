# Tegal – Ingest Aduan Medsos (n8n + Postgres di Railway)

Menerima komentar, post, dan DM dari akun **resmi** Pemkab Tegal (Facebook Page, Instagram
Business, WhatsApp Business Cloud API) lewat webhook Meta, lalu menyimpannya ke satu tabel
Postgres (`reports`) untuk dibaca dashboard.

```
Meta webhook ──► n8n (/webhook/meta) ──► Postgres (reports) ◄── dashboard (read-only)
```

Hanya API resmi Meta; tidak ada scraping. WhatsApp pribadi tidak bisa diambil, hanya pesan yang
masuk ke nomor WhatsApp Business yang didaftarkan ke Cloud API.

## Isi repo

| File | Fungsi |
|---|---|
| `db/schema.sql` | Tabel `reports` + indeks + contoh role read-only untuk dashboard |
| `n8n/lib.js` | Normalisasi payload Meta, verifikasi tanda tangan, pseudonimisasi |
| `n8n/build-workflow.mjs` | Membuat `n8n/meta-ingest.workflow.json` (menyisipkan `lib.js`) |
| `n8n/test.mjs` | Test logika (`node n8n/test.mjs`) |
| `.env.example` | Variabel lingkungan |

## Deploy di Railway

1. **Project baru** → *New* → *Database* → **PostgreSQL**.
2. *New* → *Template* → cari **n8n** (atau *Docker Image* `n8nio/n8n`). Pasang volume di
   `/home/node/.n8n` bila memakai image mentah.
3. Di service n8n, isi variabel dari `.env.example`. Untuk koneksi database n8n sendiri boleh
   memakai Postgres yang sama (`DB_TYPE=postgresdb` + referensi `${{Postgres.*}}`), tetapi lebih baik
   schema/DB terpisah dari `reports`.
4. Generate domain publik untuk n8n, isi `WEBHOOK_URL` dengan domain itu (akhiri `/`).
5. Buat tabel: 
   ```bash
   psql "<DATABASE_PUBLIC_URL dari Railway>" -f db/schema.sql
   ```
6. Di n8n: *Credentials* → **Postgres** bernama `Postgres Tegal` (host/port/user/password dari
   Railway). Lalu *Import from File* → `n8n/meta-ingest.workflow.json`, pilih credential di node
   "Simpan ke Postgres", **Publish/Activate**.
   Regenerasi file bila `lib.js` berubah: `node n8n/build-workflow.mjs`.

## Setup Meta (dikerjakan admin akun)

1. developers.facebook.com → buat App (tipe Business). Catat **App Secret** → `META_APP_SECRET`.
2. Tambah produk **Webhooks**; Callback URL `https://<domain-n8n>/webhook/meta`, Verify token =
   `META_VERIFY_TOKEN`.
   - Objek **Page**: subscribe field `feed` dan `messages`.
   - Objek **Instagram**: subscribe `comments` dan `messages`.
   - Objek **WhatsApp Business Account**: subscribe `messages`.
3. Hubungkan Page, akun IG Business (terhubung ke Page), dan nomor WhatsApp Business ke app.
   Nomor Lapor Bupati yang sekarang dipakai di aplikasi WhatsApp harus dimigrasikan/ditambahkan ke
   Cloud API; cek opsi *coexistence* di dokumentasi WhatsApp agar admin tetap bisa memakai aplikasi.
4. Izin (permission) untuk membaca komentar dan pesan di akun yang bukan milik developer app
   memerlukan **App Review / Business Verification** oleh Meta. Selama mode development, hanya
   admin/tester app yang datanya mengalir. Mulailah proses ini lebih awal, karena butuh waktu.

## Keamanan & UU PDP

- Setiap request POST diverifikasi `X-Hub-Signature-256` dengan `META_APP_SECRET`; yang tidak valid ditolak.
- `author_hash`: HMAC stabil (pengelompokan pelapor tanpa identitas). `author_name` hanya diisi untuk
  komentar/post publik. Untuk DM/WA, identitas asli hanya ada di `author_ref_enc` (AES-256-GCM).
- Dashboard memakai role Postgres read-only **tanpa** kolom `author_ref_enc` (lihat `db/schema.sql`).
  Jangan menaruh kredensial Postgres di front end; panggil lewat backend/edge function.
- Aktifkan backup Postgres Railway dan simpan `ENCRYPTION_KEY`/`N8N_ENCRYPTION_KEY` di tempat terpisah:
  kehilangan kunci berarti `author_ref_enc` tidak bisa dibuka.
- Railway adalah cloud publik; KAK mengizinkan cloud publik "sesuai kebijakan pemda". Pastikan
  hosting dan lokasi data disetujui Diskominfo.

## Status verifikasi

- ✅ `node n8n/test.mjs`: normalisasi FB/IG/WA, penolakan tanda tangan salah, hash stabil, enkripsi bolak-balik.
- ✅ Isi Code node dijalankan dengan simulasi input n8n (tanda tangan valid lolos, salah ditolak).
- ⚠️ Belum diuji di n8n sungguhan: import workflow, `queryReplacement` pada node Postgres, mode raw body.
- ⚠️ `db/schema.sql` dan query insert belum dijalankan di Postgres (tidak ada Postgres/Docker aktif saat dibuat).
- ⚠️ Belum ada pengambilan riwayat (backfill) lama; webhook hanya menangkap kejadian baru sejak aktif.

## Tidak tercakup (KAK menyebut)

TikTok, SP4N-LAPOR, dan Call Center 112 punya jalur integrasi berbeda; belum dikerjakan.
