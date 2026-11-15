# CLAUDE.md — Kasir Buket

Panduan untuk Claude Code saat bekerja di repositori ini. Baca juga `docs/SPEK-ARSITEKTUR.md` (spesifikasi, protokol sinkron) dan `docs/PANDUAN.md` (instalasi, printer, migrasi).

## Gambaran
Aplikasi kasir (POS) khusus usaha buket milik Vano (Stabat, Langkat). Satu kode web dipakai untuk versi web dan Android (Capacitor). Server sinkron Node.js + SQLite di VPS. Fitur kunci: cetak ganda per transaksi (struk pelanggan ke printer kasir + tiket produksi tanpa harga ke printer ruang perangkai), sinkron otomatis tanpa tombol, pesanan dengan DP/jadwal/kartu ucapan, papan produksi, laporan laba rugi dengan rekonsiliasi, impor data Kasir Pintar.

## Perintah
```bash
# server (tanpa dependensi npm; Node >= 22.13 karena node:sqlite)
cd server && npm test                      # 26 uji (integrasi, notifikasi/kalender, rute, geo, persetujuan pembatalan)
node server/src/index.js                   # http://localhost:8080 (env: PORT, HOST, DATA_DIR, STATIC_DIR, TOKEN_DAYS, SECRET, ORS_URL, OSRM_URL, NOTIFY_DELAY_MS, NOTIFY_INTERVAL_MS)

# aplikasi
cd app && npm ci
npm test                                   # 21 uji logika (tsx + node:test; fixture test/fixtures/belanja.xlsx)
npm run build                              # tsc --noEmit && vite build -> app/dist
npm run dev                                # vite, proxy /api ke :8080
npx cap sync android                       # salin dist ke proyek Android

# end-to-end 2 perangkat (Playwright + Chromium, butuh app/dist; ORS & SMTP tiruan lokal)
node e2e/e2e.mjs
```
Selalu jalankan `server: npm test`, `app: npm test && npm run build`, dan `node e2e/e2e.mjs` sebelum menyatakan pekerjaan selesai.

## Struktur
- `server/src/index.js` — HTTP API, sinkron push/pull, SSE `/api/events`, pengguna, lupa kata sandi (`/api/auth/forgot`, `/api/auth/reset`), konfigurasi SMTP (`/api/email-config`, owner), file statis. `db.js` (skema SQLite, migrasi kolom, `instance_id`, backup `VACUUM INTO`), `auth.js` (scrypt, token HMAC, limiter), `smtp.js` (klien SMTP tanpa dependensi: TLS 465 / STARTTLS; `buildMessage` menyusun MIME undangan kalender), `ics.js` (iCalendar REQUEST/CANCEL, lipat baris 75 oktet), `notify.js` (notifikasi perangkai: `reconcile` per pesanan, antrean `notify_jobs`, coba ulang), `geo.js` (link Maps, OpenRouteService, OSRM), `reset-password.js` (CLI pemulihan sandi di komputer server).
- `app/src/lib/` — `types.ts` (model data), `db.ts` (Dexie/IndexedDB), `sync.ts` (mesin sinkron), `store.ts` (operasi domain: checkout, pembayaran, void, nomor transaksi, konfigurasi perangkat), `calc.ts` (rumus murni: total, laporan, shift, kapasitas), `kasirpintar.ts` (impor), `print/` (`escpos.ts` encoder, `receipts.ts` isi struk/tiket, `index.ts` transport + stasiun cetak).
- `app/src/lib/device.ts` (kode perangkat jenis+fungsi), `settings.ts` (bawaan + bank 20 pertanyaan survei, `pickSurvey`, `surveyBank`), `labels.ts`, `events.ts` (33 event bawaan 2026 + analisis omzet: `dailySales`, `baselineAround`, `eventStat`, `spikeDays`), `sheet.ts` (CSV & .xlsx tanpa dependensi, angka/tanggal gaya Indonesia), `purchases.ts` (pemetaan baris belanja, ID deterministik).
- `app/src/components/Alerts.tsx` — peringatan H-1 (`DueAlert`) dan daftar pengajuan pembatalan (`CancelRequests`).
- `app/src/pages/` — Kasir, Pesanan, Produksi, Produk, Belanja (owner), Pelanggan, Shift, Laporan, Kalender (owner), Pengaturan (tab Perangkat, Printer, Toko & cabang, Promo poin & ongkir, Perangkai, Survei, Pengguna, Email, Impor), Setup.
- `app/android/app/src/main/java/id/kasirbuket/app/ThermalPrinterPlugin.java` — plugin native: `listPaired`, `printBluetooth` (SPP), `printTcp` (port 9100).
- `tools/ekspor-kasirpintar.js` — skrip Console untuk ekspor data dari back office Kasir Pintar.
- `.github/workflows/android.yml` — build APK debug (kunci tetap `app/android/app/debug.keystore`).

## Invarian yang tidak boleh rusak
1. **Offline-first.** UI hanya membaca/menulis IndexedDB. Semua tulis lewat `save()`/`saveMany()` di `store.ts` (tabel lokal + `outbox`). Jangan memanggil API untuk data bisnis dari halaman.
2. **Sinkron berbasis `seq`.** Server memberi nomor urut global per perubahan; klien menarik `seq > cursor`. Push mengirim *patch* per kolom; server melakukan shallow merge. Saat pull, patch outbox yang belum terkirim diterapkan ulang di atas data server.
3. **Tidak ada hard delete dari klien biasa.** Pakai `deleted: true` / `void: true`. Hanya owner yang boleh `del`.
4. **Izin di server (`RULES` di `server/src/index.js`).** Perangkai hanya boleh mengubah kolom produksi pesanan. Tambah koleksi baru = tambah ke `RULES` server dan `COLLECTIONS` + skema Dexie (naikkan `version()`).
5. **Uang = bilangan bulat Rupiah.** `total = Σ(qty×harga) − Σ potongan − diskon + ongkir`, diskon dibatasi agar total ≥ 0.
6. **Pembayaran append-only** (`payments`), stok sebagai mutasi (`stock_moves`), bukan angka tunggal.
7. **Nomor transaksi** `YYMMDD-<kode perangkat><urut3>`; kode perangkat dari server saat login.
8. **ID server (`instance_id`)** dikirim di health/login/pull. Klien menyimpannya; bila berbeda saat login, data lokal dikosongkan (konfirmasi bila outbox berisi). Bila `head < cursor` (server dipulihkan dari cadangan), klien menarik ulang dari 0.
9. **Reset sandi via email**: kode 6 digit, hash SHA-256, berlaku 15 menit, maks. 5 percobaan, sekali pakai; respons generik untuk akun tak dikenal; kredensial SMTP hanya di tabel `kv` server, tidak pernah dikirim ke klien; email pengguna tidak ikut koleksi `staff`.
10. **ID rekaman** cocok `/^[A-Za-z0-9_-]{4,64}$/`. Impor Kasir Pintar memakai ID deterministik (`kp-`, `kpo-`, `kpp-`) agar impor ulang idempoten.
11. **Teks cetak ASCII saja** (`toAscii`), 58 mm = 32 kolom, 80 mm = 48 kolom. Tiket produksi tidak boleh memuat harga.
12. **Pengaturan bawaan** (perangkai, ongkir, poin, pop-up) ada di `app/src/lib/settings.ts` (`storeCfg`); pengaturan lama tanpa kolom baru tetap jalan. Poin disimpan per transaksi (`points_earned`, `points_redeemed`), saldo = Σ didapat − Σ ditukar, sehingga bebas konflik antarperangkat.
13. **Lokasi & ongkir**: `app/src/lib/geo.ts` (parse link Maps/Plus Code/koordinat, rumus ongkir) dan `server/src/geo.js`. `/api/geo/route` = OpenRouteService (kunci di kv `geo`, owner via `/api/geo-config`, tidak pernah dikirim balik utuh) lalu OSRM; bila keduanya gagal 502 dan kasir mengisi km manual. **Tidak ada perkiraan garis lurus.**
14. Server tetap **tanpa dependensi npm**. Folder `data/` (basis data) wajib tetap di `.gitignore`.
15. **Kode perangkat** = jenis (K/H/T) + fungsi (K/R/O), duplikat diberi angka (KK2). Semua kode yang pernah dipakai tercatat di tabel `device_codes` dan tidak diberikan ke perangkat lain. `nextOrderNo` hanya menghitung nomor milik `device_id` sendiri (awalan KK juga cocok dengan KK2).
16. **Notifikasi perangkai**: hanya server yang mengirim (setelah push `orders`). Keadaan per (pesanan, email) di `cal_events`; email perangkai di kv `notify` (tidak ikut sinkron). Perubahan yang tidak memengaruhi isi undangan (status produksi, pembayaran) tidak mengirim email. Ganti perangkai = CANCEL lama + REQUEST baru; batal = CANCEL; UID tetap, SEQUENCE naik. Undangan tidak memuat harga.
17. **Survei**: jawaban disimpan `order.survey[id pertanyaan]`; data v1.2 memakai teks pertanyaan sebagai kunci (`answerOf` membaca keduanya).
18. **Tata letak**: isi halaman dibatasi `--maxw` (1240 px; Kasir & Produksi 1680 px). Tabel memakai grid dengan `--cols`/`--cols-sm` per tabel; daftar label–nilai memakai `.dl`.
19. **Member**: hanya `customer.member` yang mendapat/menukar poin (`checkout` memaksa 0 untuk bukan member). Nomor member = `memberNo(phone)` (08…).
20. **Pembatalan pesanan lunas** (Σ pembayaran sah ≥ total): selain owner, server menolak `void`/`production_status: 'batal'` pada pesanan dan `void` pada pembayarannya; Admin hanya boleh menulis `cancel_request` berstatus `pending` (server mengisi `by`, `by_name`, `at`) dan server mengirim email ke owner. Owner memutus lewat `decideCancel`.
21. **Belanja bahan & kalender**: koleksi `purchases` dan `events` (tulis: owner). Dasar HPP di `settings.hpp_method` (`gabungan` bawaan). Event bawaan diisi sekali setelah sinkron selesai bila belum ada satu pun ID `ev26-*`. Analisis omzet membuang transaksi ≥ Rp 10 juta (rekap, mis. "Penjualan Cabang 2 Jun–Des").

## Batasan lingkungan
- Android SDK/Gradle tidak tersedia di container (dl.google.com, maven.google.com diblokir). APK dibangun oleh GitHub Actions atau Android Studio di PC pengguna. Perubahan Java cukup dicek dengan `javac` terhadap stub API.
- Printer fisik tidak bisa diuji di container; uji isi cetakan lewat `previewText()`/`layout()` dan `window.__KB_PRINTLOG__` (mode uji `window.__KB_TEST__ = true` melewati dialog cetak).
- Zona waktu operasional WIB (Asia/Jakarta). Laporan memakai zona waktu perangkat.

## Konvensi
- Teks antarmuka, pesan galat, komentar, dan dokumentasi dalam Bahasa Indonesia.
- Komponen React fungsional + `useLiveQuery` (dexie-react-hooks). CSS tunggal `app/src/styles.css` dengan token warna di `:root`; tata letak responsif (≤760 px = navigasi bawah).
- Selector uji memakai `data-testid`.
- Gaya komunikasi dengan Vano: lugas, teknis/matematis, singkatan diberi kepanjangan di awal, istilah dijelaskan di akhir, tampilkan langkah hitung dan rekonsiliasi, hindari penghubung " —".

## Status & backlog
Versi 1.4 selesai dan seluruh uji lulus (v1.3: notifikasi & kalender perangkai, ORS, bank survei, kode perangkat, tata letak; v1.4: tombol −/+ di kartu, member, persetujuan pembatalan, peringatan H-1, kalender event & analisis omzet, belanja bahan + unggah CSV/Excel, dasar HPP). Belum teruji dengan layanan sungguhan dari container: Gmail/Google Calendar, OpenRouteService, link pendek Google Maps. Kandidat berikutnya (belum dikerjakan):
1. Resep bahan baku (BOM) per buket untuk memotong stok bahan otomatis.
2. Struk digital via WhatsApp.
3. QRIS dinamis via payment gateway.
4. Rilis Play Store (kunci rilis via env `KB_KEYSTORE`, `KB_STORE_PASSWORD`, `KB_KEY_ALIAS`, `KB_KEY_PASSWORD`; sudah didukung di `app/android/app/build.gradle`).
