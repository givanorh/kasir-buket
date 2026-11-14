# Kasir Buket

Aplikasi kasir (POS, Point of Sale) khusus usaha buket untuk Android dan web, dengan sinkron otomatis antarperangkat dan cetak ganda: struk pelanggan di printer kasir, tiket produksi di printer ruang perangkai.

## Struktur
| Folder | Isi |
|---|---|
| `server/` | Server sinkron Node.js + SQLite (tanpa dependensi npm). Juga menyajikan versi web. |
| `app/` | Aplikasi React + IndexedDB (offline-first). `app/android/` = proyek Android (Capacitor) + plugin printer Java. |
| `tools/ekspor-kasirpintar.js` | Skrip ekspor data dari back office Kasir Pintar. |
| `deploy/` | Layanan systemd, Caddyfile (HTTPS), skrip jalan lokal Windows. |
| `docs/` | `SPEK-ARSITEKTUR.md` (spesifikasi, model data, protokol sinkron) dan `PANDUAN.md` (instalasi, printer, migrasi, pemakaian). |
| `e2e/` | Uji end-to-end dua perangkat (Playwright). |
| `.github/workflows/android.yml` | Build APK otomatis di GitHub Actions. |

## Mulai cepat
```bash
node server/src/index.js           # http://localhost:8080 (Node.js ≥ 22.13)
```
Pengembangan antarmuka: `cd app && npm install && npm run dev` (server tetap jalan di 8080).

## Uji
```bash
cd server && npm test              # 6 uji server
cd app && npm test                 # 9 uji logika (ESC/POS, struk, laporan, shift)
node e2e/e2e.mjs                   # end-to-end 2 perangkat (butuh app/dist & Playwright)
```

Panduan lengkap: [docs/PANDUAN.md](docs/PANDUAN.md).
