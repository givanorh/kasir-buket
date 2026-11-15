# CLAUDE.md — Kasir Buket

Panduan untuk Claude Code saat bekerja di repositori ini. Baca juga `docs/SPEK-ARSITEKTUR.md` (spesifikasi, protokol sinkron) dan `docs/PANDUAN.md` (instalasi, printer, migrasi).

## Gambaran
Aplikasi kasir (POS) khusus usaha buket milik Vano (Stabat, Langkat). Satu kode web dipakai untuk versi web dan Android (Capacitor). Server sinkron Node.js + SQLite di VPS. Fitur kunci: cetak ganda per transaksi (struk pelanggan ke printer kasir + tiket produksi tanpa harga ke printer ruang perangkai), sinkron otomatis tanpa tombol, pesanan dengan DP/jadwal/kartu ucapan, papan produksi, laporan laba rugi dengan rekonsiliasi, impor data Kasir Pintar.

## Perintah
```bash
# server (tanpa dependensi npm; Node >= 22.13 karena node:sqlite)
cd server && npm test                      # 6 uji integrasi
node server/src/index.js                   # http://localhost:8080 (env: PORT, HOST, DATA_DIR, STATIC_DIR, TOKEN_DAYS, SECRET)

# aplikasi
cd app && npm ci
npm test                                   # 9 uji logika (tsx + node:test)
npm run build                              # tsc --noEmit && vite build -> app/dist
npm run dev                                # vite, proxy /api ke :8080
npx cap sync android                       # salin dist ke proyek Android

# end-to-end 2 perangkat (Playwright + Chromium, butuh app/dist)
node e2e/e2e.mjs
```
Selalu jalankan `server: npm test`, `app: npm test && npm run build`, dan `node e2e/e2e.mjs` sebelum menyatakan pekerjaan selesai.

## Struktur
- `server/src/index.js` — HTTP API, sinkron push/pull, SSE `/api/events`, pengguna, file statis. `db.js` (skema SQLite, backup `VACUUM INTO`), `auth.js` (scrypt, token HMAC, limiter).
- `app/src/lib/` — `types.ts` (model data), `db.ts` (Dexie/IndexedDB), `sync.ts` (mesin sinkron), `store.ts` (operasi domain: checkout, pembayaran, void, nomor transaksi, konfigurasi perangkat), `calc.ts` (rumus murni: total, laporan, shift, kapasitas), `kasirpintar.ts` (impor), `print/` (`escpos.ts` encoder, `receipts.ts` isi struk/tiket, `index.ts` transport + stasiun cetak).
- `app/src/pages/` — Kasir, Pesanan, Produksi, Produk, Pelanggan, Shift, Laporan, Pengaturan, Setup.
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
8. **ID rekaman** cocok `/^[A-Za-z0-9_-]{4,64}$/`. Impor Kasir Pintar memakai ID deterministik (`kp-`, `kpo-`, `kpp-`) agar impor ulang idempoten.
9. **Teks cetak ASCII saja** (`toAscii`), 58 mm = 32 kolom, 80 mm = 48 kolom. Tiket produksi tidak boleh memuat harga.
10. Server tetap **tanpa dependensi npm**.

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
Versi 1.0 selesai dan seluruh uji lulus. Kandidat berikutnya (belum dikerjakan):
1. Resep bahan baku (BOM) per buket untuk memotong stok bahan otomatis.
2. Struk digital via WhatsApp.
3. QRIS dinamis via payment gateway.
4. Rilis Play Store (kunci rilis via env `KB_KEYSTORE`, `KB_STORE_PASSWORD`, `KB_KEY_ALIAS`, `KB_KEY_PASSWORD`; sudah didukung di `app/android/app/build.gradle`).
