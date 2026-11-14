# Spesifikasi dan Arsitektur Kasir Buket

Dokumen ini menjelaskan apa yang dibangun dan bagaimana bagian-bagiannya bekerja. Singkatan: POS (Point of Sale, aplikasi kasir), APK (Android Package), PWA (Progressive Web App), VPS (Virtual Private Server), SSE (Server-Sent Events), HPP (Harga Pokok Penjualan), DP (Down Payment, uang muka), ESC/POS (bahasa perintah printer thermal Epson/umum), CSV (Comma-Separated Values), WIB (Waktu Indonesia Barat).

## 1. Ruang Lingkup

### 1.1. Tujuan
Aplikasi kasir khusus usaha buket, setara fungsi inti Kasir Pintar Pro, dengan tiga tambahan utama:
1. Dua cetakan otomatis per transaksi: struk pelanggan (printer kasir) dan tiket produksi (printer ruang perangkai).
2. Sinkron otomatis tanpa tombol sinkronisasi.
3. Alur pesanan buket: jadwal ambil/antar, DP, kartu ucapan, catatan rangkaian, papan produksi, kapasitas harian.

### 1.2. Platform
1. Android (APK, dibungkus Capacitor dari kode web yang sama).
2. Web (dibuka dari browser di komputer/tablet; dapat dipasang sebagai PWA).
3. Server sinkron di VPS (satu proses Node.js + SQLite) yang juga menyajikan versi web.

### 1.3. Peran pengguna
| Peran | Menu |
|---|---|
| owner | semua menu, termasuk Produk, Laporan, Pengguna, Toko, Impor |
| kasir | Kasir, Pesanan, Produksi, Pelanggan, Shift, Pengaturan perangkat/printer |
| perangkai | Produksi (papan kerja), Pengaturan perangkat/printer |

Server menegakkan izin: perangkai hanya boleh mengubah kolom produksi pada pesanan (`production_status`, `production_note`, `assigned_to`, `production_at`, `ready_at`, `done_at`). Kolom lain yang dikirim perangkai dibuang server.

## 2. Fitur

### 2.1. Kasir
1. Grid produk dengan foto, filter kategori, pencarian nama/kode, indikator stok.
2. Item custom (nama, harga, HPP, catatan) untuk pesanan khusus.
3. Ubah per baris: jumlah, harga, potongan, catatan (warna, isi, ukuran).
4. Pembayaran: Lunas, DP, atau Bayar nanti. Metode: Tunai, QRIS, Transfer, Debit, e-wallet (daftar bisa diubah owner).
5. Tunai: tombol nominal cepat (uang pas, pembulatan 50 rb/100 rb) dan hitung kembalian.
6. Pengambilan: Ditunggu, Ambil nanti (tanggal+jam), Diantar (penerima, alamat, ongkir).
7. Kartu ucapan dan catatan rangkaian untuk perangkai.
8. Peringatan kapasitas: jumlah buket terjadwal pada tanggal itu dibandingkan kapasitas harian.

Rumus total transaksi:

$$\text{total} = \sum_i (q_i \cdot h_i) - \sum_i p_i - d + f$$

dengan $q_i$ jumlah, $h_i$ harga, $p_i$ potongan baris, $d$ diskon transaksi (dibatasi agar total tidak negatif), $f$ ongkir.

### 2.2. Cetak ganda
Saat transaksi tersimpan, aplikasi langsung mencetak:

| Target | Isi | Printer |
|---|---|---|
| `kasir` | Struk pelanggan: item, harga, total, DP, sisa tagihan, jadwal ambil, catatan kaki | printer kasir |
| `produksi` | Tiket produksi: nomor besar, jadwal ambil besar, item ukuran ganda, catatan rangkaian, kartu ucapan, pemesan/penerima. **Tanpa harga** | printer ruang perangkai |

Cara cetak per target diatur per perangkat:

| Mode | Platform | Keterangan |
|---|---|---|
| Bluetooth | Android | Bluetooth Classic SPP ke printer yang sudah dipasangkan |
| WiFi/LAN | Android | TCP port 9100 (standar printer jaringan) |
| Dialog cetak sistem | Web/Android | Printer terpasang di sistem operasi; lebar 58/80 mm |
| Dicetak perangkat lain (relay) | Semua | Membuat `print_job`; perangkat “stasiun cetak” di ruang perangkai mencetaknya otomatis |
| Tidak dicetak | Semua | Lewati |

Konfigurasi yang disarankan:
1. Printer kasir Bluetooth 58 mm di meja kasir.
2. Printer ruang perangkai WiFi/LAN 80 mm. HP kasir mencetak langsung ke IP printer, tetap berfungsi walau internet putus (cukup WiFi lokal).
3. Alternatif bila printer ruang perangkai hanya Bluetooth: pasang HP/tablet di ruang perangkai, login sebagai perangkai, aktifkan “Stasiun cetak” untuk target produksi. HP kasir memakai mode relay. Tiket sampai lewat sinkron (butuh internet), lazimnya kurang dari 1 detik.

### 2.3. Pesanan dan produksi
1. Daftar pesanan: Hari ini, Jadwal, Belum lunas, 30 hari; cari no/nama/HP.
2. Detail pesanan: riwayat pembayaran, pelunasan, ubah status produksi, cetak ulang struk/tiket, batalkan (alasan wajib; pembayaran dibatalkan, stok dikembalikan).
3. Papan produksi: kolom Antri › Dirangkai › Siap, urut jadwal; kartu kuning bila jatuh tempo < 2 jam, merah bila terlambat.

### 2.4. Produk dan stok
1. Tipe produk: Buket, Add-on, Jasa, Bahan baku. Harga jual, HPP, margin otomatis $(h - c)/h$.
2. Lacak stok opsional per produk. Stok dihitung sebagai jumlah semua mutasi: $S_p = \sum_k m_{p,k}$. Mutasi: penjualan (−), batal (+), stok masuk (+), opname (selisih), rusak/layu (−).
3. Model mutasi (bukan angka stok tunggal) mencegah konflik saat dua perangkat menjual barang yang sama secara offline.

### 2.5. Shift dan kas
Kas seharusnya di laci:

$$K_{harus} = K_{awal} + \sum \text{bayar tunai} + \sum \text{kas masuk tunai} - \sum \text{kas keluar tunai}$$

Selisih tutup shift $= K_{aktual} - K_{harus}$.

### 2.6. Laporan
1. Laba rugi: penjualan kotor, diskon, ongkir, penjualan bersih, HPP, laba kotor, beban, laba bersih.
2. Rekonsiliasi silang: $\text{dibayar} + \text{sisa tagihan} = \text{penjualan bersih}$ untuk transaksi periode itu. Ditandai ✓ bila cocok.
3. Kas masuk per metode (basis tanggal uang diterima, termasuk DP dan pelunasan).
4. Per produk (qty, penjualan, HPP, laba), per kasir, per jam, jadwal 14 hari ke depan vs kapasitas.
5. Ekspor CSV per baris item.
6. Kategori kas keluar bertanda “beban” mengurangi laba bersih. “Belanja bahan” default bukan beban bila HPP produk sudah diisi, agar tidak terhitung dua kali.

### 2.7. Pelanggan
Tersimpan otomatis dari kasir (dicocokkan dengan nomor HP). Menampilkan jumlah transaksi, total belanja, sisa tagihan, transaksi terakhir.

### 2.8. Multi-cabang
Koleksi `outlets`. Setiap perangkat memilih cabangnya; transaksi, stok, kas, dan laporan dicatat per cabang. Katalog produk dipakai bersama.

### 2.9. Migrasi dari Kasir Pintar
`tools/ekspor-kasirpintar.js` dijalankan di Console Chrome pada back office Kasir Pintar (sesi login sendiri, hanya GET) lalu menghasilkan `kasirpintar-ekspor.json`. Menu Pengaturan › Impor memetakan produk, kategori, pelanggan, transaksi, pembayaran. ID dibuat deterministik (`kp-<id_barang>`, `kpo-<kode>`), sehingga impor ulang memperbarui, tidak menggandakan.

## 3. Arsitektur

### 3.1. Komponen
```
[Android/Web: React + IndexedDB] ⇄ HTTPS ⇄ [Server Node.js + SQLite di VPS] ⇄ [Android/Web lain]
        │                                         │
        └─ printer BT/LAN/sistem                  └─ backup harian data/backups/*.db
```

### 3.2. Offline-first
Semua baca/tulis aplikasi menuju basis data lokal (IndexedDB via Dexie). Setiap tulis juga masuk tabel `outbox`. Kasir tetap bisa bertransaksi tanpa internet.

### 3.3. Protokol sinkron
1. **Nomor urut global.** Server memberi setiap perubahan nomor `seq` yang naik monoton. Perangkat menyimpan kursor $c$ dan menarik semua perubahan dengan $seq > c$.
2. **Push.** Isi `outbox` dikirim berkelompok (200) sebagai *patch* per kolom. Server menggabungkan: $data' = data \oplus patch$ (kolom yang dikirim menimpa, kolom lain tetap). Dua perangkat yang mengubah kolom berbeda tidak saling menimpa.
3. **Pull.** Data server diterapkan, lalu patch lokal yang belum terkirim diterapkan ulang di atasnya, sehingga edit offline tidak hilang.
4. **Pemicu otomatis.** Saat aplikasi dibuka/login, 0,4 detik setelah setiap tulis lokal, saat server mengirim SSE `seq` baru (realtime), saat kembali online, saat aplikasi kembali ke depan, dan polling cadangan tiap 30 detik.
5. **Galat.** Jaringan putus: coba ulang dengan jeda eksponensial 2–30 detik. Token tidak valid (401): keluar dan minta login. Perubahan yang ditolak server (izin/validasi) dicatat di Pengaturan › Perangkat.
6. **Nomor transaksi offline-unik.** Format `YYMMDD-<kode perangkat><urut>`, contoh `261115-A001`. Kode perangkat (A, B, C, …) diberikan server saat login pertama, sehingga dua perangkat offline tidak menghasilkan nomor sama.

### 3.4. Model data
| Koleksi | Isi pokok |
|---|---|
| `outlets` | cabang |
| `staff`, `devices` | cermin baca-saja dari tabel pengguna dan perangkat server |
| `settings` (`toko`) | nama toko, footer struk, metode bayar, kategori kas, kapasitas harian, DP default |
| `categories`, `products` | katalog |
| `customers` | pelanggan |
| `orders` | transaksi: item, total, jadwal, kartu ucapan, catatan, status produksi, batal |
| `payments` | pembayaran (append-only): lunas, DP, pelunasan |
| `stock_moves` | mutasi stok |
| `shifts`, `cash_moves` | shift kasir, kas masuk/keluar |
| `print_jobs` | antrean cetak relay: target, status pending/printing/done/error |

Penghapusan memakai penanda `deleted`/`void` agar perangkat lain ikut mengetahui.

### 3.5. Server
1. Node.js ≥ 22.13, tanpa dependensi npm (memakai `node:sqlite`, `node:http`, `node:crypto`).
2. Kata sandi: scrypt (N = 16384). Token: HMAC-SHA256, berlaku 180 hari. Pembatas login: 10 gagal per 10 menit per IP+username.
3. Endpoint: `GET /api/health`, `POST /api/setup`, `POST /api/auth/login`, `GET /api/auth/me`, `GET /api/sync/pull`, `POST /api/sync/push`, `GET /api/events` (SSE), `GET/POST/PATCH /api/users`.
4. Backup: `VACUUM INTO` saat start dan tiap 24 jam, 14 berkas terakhir disimpan.

### 3.6. Android
1. Capacitor 8; kode web dibundel ke APK (aplikasi terbuka walau server mati).
2. Plugin native `ThermalPrinter` (Java): `listPaired`, `printBluetooth`, `printTcp`. Antrean cetak satu per satu. Izin Android 12+: `BLUETOOTH_CONNECT`.
3. Layar dijaga tetap menyala saat aplikasi terbuka.

## 4. Pengujian
| Uji | Cakupan | Hasil |
|---|---|---|
| `server/test` (6 uji) | setup sekali, login, kode perangkat, izin per peran, merge per kolom, urutan seq, SSE, token palsu | lulus |
| `app/test` (9 uji) | ESC/POS (byte init/ukuran/potong, lebar 32/48 kolom), isi struk & tiket, rumus total, laporan, rekonsiliasi, shift, kapasitas, waktu WIB impor | lulus |
| `e2e/e2e.mjs` | 2 perangkat nyata (tablet owner + HP perangkai): setup, produk, pengguna, shift, transaksi DP, cetak ganda, stasiun cetak otomatis, status realtime, transaksi offline lalu sinkron otomatis, pelunasan, laporan, impor Kasir Pintar | lulus |

Yang belum bisa diuji di lingkungan pengembangan: pencetakan fisik ke printer Bluetooth/LAN dan build APK (dilakukan oleh GitHub Actions atau Android Studio). Kode plugin Java sudah dicek kompilasinya terhadap tanda tangan API Capacitor/Android.

## 5. Pengembangan Lanjutan (belum termasuk)
1. Resep bahan baku (BOM) per buket: memotong stok bunga/kertas otomatis saat terjual.
2. Kirim struk digital via WhatsApp.
3. Pembayaran QRIS dinamis terhubung payment gateway.
4. Rilis Play Store (butuh kunci rilis dan akun pengembang).

## Istilah
- **Offline-first**: aplikasi bekerja dari data lokal; internet hanya untuk menyamakan data antarperangkat.
- **Outbox**: antrean perubahan lokal yang belum terkirim ke server.
- **Patch**: sekumpulan kolom yang berubah, bukan seluruh rekaman.
- **SSE (Server-Sent Events)**: koneksi HTTP terbuka tempat server mengirim pemberitahuan ke perangkat.
- **Relay/stasiun cetak**: perangkat yang menerima tugas cetak lewat sinkron dan mencetaknya ke printer di dekatnya.
- **HPP (Harga Pokok Penjualan)**: biaya pokok per unit; dasar laba kotor.
- **Rekonsiliasi silang**: pencocokan dua jalur hitung yang berbeda untuk memastikan angka konsisten.
- **SPP (Serial Port Profile)**: profil Bluetooth Classic yang dipakai printer thermal.
- **Capacitor**: kerangka kerja yang membungkus aplikasi web menjadi aplikasi Android dengan akses fitur native.
