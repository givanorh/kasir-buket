# Panduan Instalasi dan Pemakaian Kasir Buket

Singkatan: VPS (Virtual Private Server), APK (Android Package), HTTPS (HTTP Secure), DNS (Domain Name System), IP (Internet Protocol), LAN (Local Area Network), SSH (Secure Shell), PWA (Progressive Web App), DP (Down Payment).

## 1. Urutan Kerja yang Disarankan
1. Uji di komputer sendiri (bagian 2), 15 menit.
2. Pasang server di VPS dengan domain dan HTTPS (bagian 3).
3. Bangun APK lewat GitHub Actions (bagian 4) dan pasang di HP kasir dan HP/tablet ruang perangkai.
4. Atur printer (bagian 5).
5. Pindahkan data dari Kasir Pintar (bagian 6).
6. Jalankan paralel dengan Kasir Pintar 3–7 hari, cocokkan laporan harian, lalu beralih penuh.

## 2. Uji Coba di Komputer (Windows)
1. Pasang Node.js 22 LTS atau lebih baru dari nodejs.org.
2. Ekstrak `kasir-buket.zip`, buka folder `deploy`, klik dua kali `jalankan-lokal-windows.bat`.
3. Buka `http://localhost:8080`. Isi data toko dan akun owner.
4. Dari HP yang terhubung WiFi sama: buka `http://IP-KOMPUTER:8080` (lihat IP dengan perintah `ipconfig`). Bila tidak terbuka, izinkan Node.js di Windows Firewall.

Data tersimpan di folder `data/` (berkas `kasir.db` dan `backups/`).

## 3. Server di VPS (Ubuntu 22.04/24.04)

### 3.1. Kebutuhan
1 vCPU, RAM 512 MB–1 GB sudah cukup. Domain/subdomain, misalnya `kasir.domainanda.com`, dengan rekaman DNS A mengarah ke IP VPS. VPS yang sama bisa dipakai bersama website lain; Caddy melayani banyak domain.

### 3.2. Pasang Node.js dan Caddy
```bash
# Node.js 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs unzip
node -v   # harus v22.13 atau lebih baru

# Caddy (HTTPS otomatis), sesuai dokumentasi resmi caddyserver.com
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```
Perintah pemasangan dari pihak ketiga dapat berubah. Bila salah satu gagal, ikuti petunjuk terbaru di nodejs.org dan caddyserver.com.

### 3.3. Pasang aplikasi
```bash
sudo useradd --system --home /opt/kasir-buket --shell /usr/sbin/nologin kasir
sudo mkdir -p /opt/kasir-buket && cd /opt/kasir-buket
# unggah kasir-buket.zip ke VPS (mis. lewat scp atau panel penyedia), lalu:
sudo unzip -o ~/kasir-buket.zip -d /opt/kasir-buket
sudo mkdir -p /opt/kasir-buket/data && sudo chown -R kasir:kasir /opt/kasir-buket
sudo cp deploy/kasir-buket.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now kasir-buket
sudo systemctl status kasir-buket   # harus "active (running)"
```
Folder `app/dist` di dalam zip sudah berisi aplikasi web jadi, jadi VPS tidak perlu `npm install`. Server tidak memakai paket npm sama sekali.

### 3.4. HTTPS
```bash
sudo cp /opt/kasir-buket/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # ganti kasir.domainanda.com
sudo systemctl reload caddy
```
Buka `https://kasir.domainanda.com`, lakukan penyiapan toko (sekali saja).

### 3.5. Pembaruan dan cadangan
1. Pembaruan: unggah zip baru, ekstrak ke `/opt/kasir-buket` (folder `data/` tidak tersentuh), lalu `sudo systemctl restart kasir-buket`.
2. Cadangan otomatis harian ada di `/opt/kasir-buket/data/backups/` (14 terakhir). Salin berkala ke luar VPS, misalnya Google Drive, karena kerusakan VPS juga menghapus cadangan di dalamnya.
3. Pemulihan: hentikan layanan, salin satu berkas cadangan menjadi `data/kasir.db`, hapus `kasir.db-wal` dan `kasir.db-shm` bila ada, jalankan lagi.

## 4. APK Android

### 4.1. Lewat GitHub Actions (tanpa memasang apa pun di PC)
1. Buat akun GitHub, lalu repositori **private** baru, misalnya `kasir-buket`.
2. Kirim kode ke repositori itu. Upload lewat web GitHub dibatasi 100 berkas per unggahan, jadi pakai git (atau GitHub Desktop) dari berkas `kasir-buket.bundle`:
   ```bash
   git clone kasir-buket.bundle kasir-buket
   cd kasir-buket
   git remote set-url origin https://github.com/<akun-anda>/kasir-buket.git
   git push -u origin main
   ```
3. Buka tab **Actions**. Workflow “Build APK Android” berjalan otomatis (sekitar 5–8 menit). Bila tidak, pilih workflow itu › Run workflow.
4. Setelah selesai (centang hijau), buka run tersebut › bagian Artifacts › unduh `kasir-buket-apk` (zip berisi `kasir-buket-<nomor>.apk`).
5. Kirim APK ke HP, buka, izinkan “Instal aplikasi tidak dikenal”.
6. Saat pertama dibuka, isi alamat server `https://kasir.domainanda.com`, lalu login.

APK ditandatangani kunci tetap (`app/android/app/debug.keystore`), sehingga APK versi berikutnya bisa dipasang menimpa versi lama tanpa uninstall. Nomor versi naik otomatis tiap build.

### 4.2. Lewat Android Studio di PC
```bash
cd app
npm install
npm run android:sync
npx cap open android      # Android Studio terbuka › Build › Build APK(s)
```

### 4.3. Versi web
Buka alamat server di Chrome komputer/tablet. Menu Chrome › “Instal aplikasi” untuk memasangnya seperti aplikasi (PWA).

## 5. Printer

### 5.1. Dua cetakan per transaksi
| Cetakan | Target | Isi |
|---|---|---|
| Struk pelanggan | Printer kasir | rincian harga, pembayaran, DP/sisa, jadwal ambil |
| Tiket produksi | Printer ruang perangkai | nomor besar, jadwal besar, item, catatan rangkaian, kartu ucapan, tanpa harga |

### 5.2. Pilihan susunan
| Susunan | Printer kasir | Printer ruang perangkai | Butuh internet untuk tiket |
|---|---|---|---|
| A (disarankan) | Bluetooth 58 mm, dicetak HP kasir | WiFi/LAN 80 mm, dicetak HP kasir lewat IP | Tidak (cukup WiFi toko) |
| B | Bluetooth, dicetak HP kasir | Bluetooth, dicetak HP/tablet ruang perangkai sebagai stasiun | Ya |
| C (komputer kasir) | Dialog cetak sistem (printer USB terpasang driver) | relay ke stasiun ruang perangkai | Ya |

### 5.3. Langkah atur
1. **Bluetooth**: pasangkan printer di Pengaturan Bluetooth Android (PIN umumnya 0000 atau 1234). Di aplikasi: Pengaturan › Printer › pilih “Bluetooth (Android)” › pilih printer › Tes cetak. Izinkan “Perangkat sekitar” bila diminta.
2. **WiFi/LAN**: sambungkan printer ke WiFi toko, beri IP tetap (lewat menu printer atau reservasi DHCP di router). Cek IP di cetakan self-test printer. Di aplikasi: pilih “WiFi/LAN IP”, isi IP, port 9100, Tes cetak.
3. **Stasiun cetak (susunan B/C)**: di HP kasir, printer ruang perangkai diatur “Dicetak perangkat lain”. Di HP/tablet ruang perangkai: login akun perangkai › Pengaturan › Printer › printer ruang perangkai = Bluetooth/LAN › centang “Stasiun cetak”. Biarkan aplikasi terbuka di menu Produksi.
4. Lebar kertas 58 mm = 32 karakter per baris, 80 mm = 48 karakter.

Tiket yang gagal tercetak tampil di menu Produksi dengan tombol “Ulangi gagal”. Struk/tiket bisa dicetak ulang dari detail pesanan.

## 6. Pindah dari Kasir Pintar
1. Di Chrome komputer, login back office Kasir Pintar, buka halaman mana pun di `kasirpintar.co.id/account/...`.
2. Tekan F12 › Console › tempel isi `tools/ekspor-kasirpintar.js` › Enter. Isi tanggal awal (misalnya 2025-04-01). Proses mengambil per 30 hari dengan jeda, jadi 1,5 tahun data butuh beberapa menit.
3. Berkas `kasirpintar-ekspor.json` terunduh.
4. Di Kasir Buket (akun owner): Pengaturan › Impor Kasir Pintar › pilih berkas › periksa ringkasan › Impor sekarang.
5. Cocokkan: Laporan › Pilih tanggal yang sama di kedua aplikasi; penjualan bersih dan jumlah transaksi harus sama.

Catatan: Chrome mungkin meminta Anda mengetik “allow pasting” sebelum bisa menempel kode di Console. Itu pengaman bawaan Chrome; jalankan hanya skrip yang Anda kenal.

## 7. Pemakaian Harian
1. **Buka shift** (menu Shift): isi kas awal.
2. **Transaksi**: pilih produk › Bayar › isi pelanggan, pengambilan, kartu ucapan, catatan › pilih Lunas/DP › Simpan. Dua cetakan keluar otomatis.
3. **Ruang perangkai**: menu Produksi, ketuk “Mulai rangkai” › “Selesai dirangkai” › “Sudah diambil”. Status langsung terlihat di kasir.
4. **Pelunasan DP**: Pesanan › Belum lunas › pilih › Catat pembayaran.
5. **Kas keluar** (beli plastik, ongkir kurir): menu Shift › Kas masuk/keluar.
6. **Tutup shift**: hitung uang di laci, isi kas aktual, lihat selisih.
7. **Hari ramai** (Valentine, wisuda): isi kapasitas harian di Pengaturan › Toko. Kasir melihat peringatan saat tanggal pesanan sudah penuh; Laporan menampilkan jadwal 14 hari.

Sinkron berjalan sendiri. Lencana di kanan atas: hijau “Tersinkron”, kuning “Menyinkron · n” (n perubahan sedang dikirim), merah “Offline · n menunggu” (tersimpan aman di perangkat, terkirim otomatis saat internet kembali).

## 8. Ongkir, Perangkai, Poin, Ulasan, dan Survei
1. **Lokasi toko** (sekali per cabang, owner): Pengaturan › Toko & cabang › tempel link Google Maps toko atau koordinat › Simpan.
2. **Kunci OpenRouteService** (sekali, owner): daftar gratis di account.heigit.org › buat API key › tempel di Pengaturan › Promo, poin & ongkir › Rute jalan kendaraan › Simpan kunci › Uji rute. Kuota gratis 2.000 rute per hari dan 40 per menit. Kunci hanya tersimpan di server.
3. **Ongkir otomatis**: di Pembayaran pilih *Diantar*, tempel link Google Maps, Plus Code (mis. `VP3+PR Stabat`), atau koordinat dari pelanggan › **Hitung**.
   - Jarak = rute jalan kendaraan (profil mobil) dari OpenRouteService. Bila kunci belum ada atau kuota habis, server memakai OSRM sebagai cadangan.
   - Bila keduanya gagal, aplikasi meminta kasir mengisi km manual (lihat jarak rute di Google Maps). Tidak ada lagi perkiraan garis lurus.
   - Rumus: ongkir = maks(Rp 15.000, km × Rp 3.000), km dibulatkan ke atas 0,1 km, rupiah dibulatkan ke atas Rp 1.000. Contoh 7,38 km → 7,4 km × 3.000 = 22.200 → Rp 23.000.
4. **Perangkai & notifikasi** (owner, Pengaturan › Perangkai): isi nama dan Gmail tiap perangkai › Simpan.
   - Saat perangkai ditunjuk (di kasir atau di detail pesanan), server mengirim email tugas berisi undangan kalender ±15 detik kemudian. Acara muncul di Google Calendar perangkai, berakhir pada jadwal ambil/antar dan dimulai sesuai "durasi rangkai" (bawaan 60 menit).
   - Jadwal, item, catatan, atau kartu ucapan berubah: undangan diperbarui. Perangkai diganti: undangan lama dibatalkan dan perangkai baru menerima undangan. Pesanan dibatalkan: undangan dibatalkan dan acara hilang dari kalendernya.
   - Syarat: email pengirim sudah diatur (Pengaturan › Email). Sekali per perangkai: simpan alamat Gmail toko di Kontak Google perangkai, atau di Google Calendar › Setelan › Setelan acara › "Tambahkan undangan ke kalender saya" pilih "Dari semua orang". Pastikan dengan tombol **Uji** lalu **Batalkan uji**.
   - Riwayat pengiriman (terkirim, menunggu, gagal) tampil di tab yang sama. Gagal kirim dicoba ulang otomatis sampai 8 kali dengan jeda 30 detik s.d. 1 jam.
5. **Poin loyalitas**: bawaan 1 poin per Rp 10.000 (tanpa ongkir), 1 poin = Rp 100, minimal tukar 50 poin; tingkat Silver ≥ Rp 1 jt dan Gold ≥ Rp 3 jt belanja 12 bulan. Poin muncul di kasir saat nomor HP pelanggan dikenali, dan profil lengkap ada di menu Pelanggan.
6. **Pop-up ulasan & survei**: muncul di kasir setiap N transaksi per perangkat (bawaan 5). Berisi QR ulasan Google Maps, pilihan diskon Rp 5.000–10.000, dan 1–2 pertanyaan yang diacak dari bank pertanyaan.
7. **Bank survei** (owner, Pengaturan › Survei): 20 pertanyaan bawaan (sumber info, acara, penerima, budget, frekuensi, alasan memilih, minat produk, kanal pesan, pesaing, waktu pesan, waktu tunggu, antar, media sosial, cara bayar, kepuasan, rekomendasi, domisili, usia, produk tambahan, promo). Bisa diubah, ditambah, dihapus, atau dinonaktifkan. Jumlah jawaban per pertanyaan tampil di tab itu; rinciannya di Laporan › Analisis penjualan.
8. **Admin & cabang**: buat akun Admin (Tiara, Ririn di Toko Utama; Putri di Cabang 1) di Pengaturan › Pengguna dan pilih cabangnya. Perangkat otomatis mengikuti cabang akun yang masuk. Tambah cabang di Pengaturan › Toko & cabang.
9. **Ganti akun / keluar**: ketuk nama di kanan atas.
10. **Kode perangkat** (awalan nomor struk): huruf jenis + huruf fungsi.

    | Kode | Arti | Contoh nomor struk |
    |---|---|---|
    | KK | Komputer Kasir | 261115-KK001 |
    | HK | HP Kasir | 261115-HK001 |
    | TK | Tablet Kasir | 261115-TK001 |
    | KR / HR / TR | Komputer / HP / Tablet Ruang Rangkai | 261115-HR001 |
    | KO / HO / TO | Komputer / HP / Tablet Owner | 261115-HO001 |

    Dipilih di layar masuk, atau diubah di Pengaturan › Perangkat. Perangkat sejenis kedua menjadi KK2, ketiga KK3. Kode yang pernah dipakai tidak diberikan ke perangkat lain, sehingga nomor struk tidak pernah kembar. Nomor struk lama (mis. 261115-A001) tidak berubah.
11. **HPP hasil impor**: bila menu Produk menampilkan peringatan "HPP lebih besar dari harga jual", tekan **Perbaiki HPP**. Impor versi lama membaca nilai modal total Kasir Pintar (HPP × stok); perbaikan membagi nilai itu dengan stok awal impor. Contoh: Rp 149.998.950.000 ÷ 999.993 = Rp 150.000.

## 8a. Fitur Versi 1.4
1. **Tombol − / + di kartu produk**: setelah produk diketuk, muncul pengatur jumlah di atas fotonya. − mengurangi 1 (bila 0, keluar dari keranjang), + menambah 1, tanpa membuka keranjang.
2. **Member & poin**: hanya member yang mendapat dan menukar poin. Nomor member = nomor HP pelanggan (08…, otomatis dinormalisasi dari +62/62). Daftar lewat centang **Daftarkan member** di Pembayaran, tombol **Daftarkan member** di profil Pelanggan, atau kotak Member di formulir pelanggan. Saldo poin lama dari transaksi sebelum v1.4 aktif setelah pelanggan terdaftar. Struk member memuat baris `MEMBER : 08…` dan saldo poin.
3. **Pembatalan pesanan lunas**: Admin tidak bisa membatalkan pesanan yang sudah lunas. Admin menekan **Ajukan pembatalan ke owner** dan wajib mengisi alasan. Owner menerima email (bila email owner & pengirim sudah diatur) dan melihat daftar **Menunggu persetujuan pembatalan** di menu Pesanan dan Produksi (angka merah di menu Pesanan). **Setujui & batalkan** membatalkan pesanan, pembayaran, dan mengembalikan stok; **Tolak** mencatat alasan penolakan. Aturan ini juga dijaga server, jadi tidak bisa dilewati dari perangkat mana pun. Pesanan DP/belum bayar tetap bisa dibatalkan Admin dengan alasan.
4. **Peringatan H-1**: pesanan ambil/antar untuk besok yang masih Antri/Dirangkai tampil sebagai pita kuning di atas setiap halaman (kecuali Pengaturan), beserta pesanan hari ini yang belum selesai. Kartu di papan Produksi diberi tanda "H-1". Tombol **Lihat** membuka Produksi › Besok.
5. **Kalender** (owner): 33 event 2026 terisi otomatis (libur nasional & cuti bersama sesuai SKB 3 Menteri, momen buket, musim wisuda, lonjakan dari data toko), lengkap dengan catatan omzet. Setiap event menampilkan omzet hari itu (atau tahun lalu bila belum terjadi) dan rasio terhadap median ±14 hari. Peta panas 12 bulan menandai hari ramai; daftar **Lonjakan omzet tanpa event** membantu menemukan momen baru. Event bisa ditambah, diubah, dihapus, dan **Salin ke 2027** untuk event bertanggal tetap.
6. **Belanja bahan** (owner): catat manual (tanggal, bahan, kategori, jumlah, satuan, harga satuan, pemasok) atau **Unggah CSV/Excel** (.xlsx atau .csv; Google Sheets › File › Download). Baris pertama berisi judul kolom; wajib kolom Bahan dan Harga satuan atau Total. Tanggal boleh `2026-11-16`, `16/11/2026`, atau tanggal Excel. Unggah ulang berkas yang sama tidak menggandakan data. Tombol **Template** mengunduh contoh berkas.
7. **Dasar HPP laba rugi** (Laporan atau Belanja bahan): *Gabungan* = Σ modal produk terjual + Σ belanja bahan periode (bawaan); *Belanja bahan* = metode periodik (cocok bila HPP produk belum diisi); *Modal produk* = hanya HPP produk (pilih bila HPP produk sudah dihitung dari bahan yang sama, agar tidak terhitung dua kali). Asumsi metode periodik: bahan yang dibeli habis dipakai pada periode yang sama.

## 9. Lupa Kata Sandi
1. **Lewat email (disarankan).** Owner mengatur sekali: Pengaturan › Email › isi Gmail toko dan *app password* (Akun Google › Keamanan › Verifikasi 2 Langkah aktif › myaccount.google.com/apppasswords) › Simpan › Kirim email uji. Lalu isi email tiap pengguna di Pengaturan › Pengguna. Di halaman masuk, ketuk **Lupa kata sandi?**, masukkan username atau email, masukkan kode 6 digit dari email (berlaku 15 menit), lalu buat sandi baru.
2. **Staf lupa sandi**: owner cukup menekan tombol **Sandi** di Pengaturan › Pengguna.
3. **Darurat (owner lupa, email belum diatur)**: di komputer server, dalam folder proyek:
   ```bash
   node server/src/reset-password.js                      # daftar pengguna & jumlah transaksi
   node server/src/reset-password.js <username> '<sandi-baru>'
   ```

## 10. Pindah Server atau Basis Data
Setiap basis data punya ID unik. Bila perangkat masuk ke server dengan ID berbeda (misalnya pindah dari PC ke VPS dengan basis data baru), data lokal di perangkat dikosongkan lalu ditarik ulang dari server baru, supaya data dua server tidak tercampur. Bila ada perubahan yang belum terkirim, aplikasi meminta konfirmasi dulu. Untuk memindahkan data lama ke server baru, salin berkas `data/kasir.db` dan `data/kasir.db-wal` saat server **mati**.

## 11. Keamanan
1. Gunakan HTTPS untuk server publik. HTTP hanya untuk uji di jaringan lokal.
2. Satu akun per orang; nonaktifkan akun karyawan yang keluar (Pengaturan › Pengguna).
3. Token login berlaku 180 hari per perangkat. Kehilangan HP: nonaktifkan akun, lalu aktifkan lagi dengan kata sandi baru.
4. Simpan salinan cadangan di luar VPS.

## Istilah
- **Caddy**: server web yang otomatis memasang sertifikat HTTPS.
- **systemd**: pengelola layanan Linux; menjalankan server otomatis saat VPS menyala dan memulai ulang bila berhenti.
- **Artifact (GitHub Actions)**: berkas hasil build yang bisa diunduh dari halaman run.
- **Stasiun cetak**: perangkat yang otomatis mencetak tugas cetak kiriman perangkat lain.
- **Port 9100**: port standar pencetakan mentah (raw) pada printer jaringan.
- **DHCP reservation**: pengaturan router agar perangkat tertentu selalu mendapat IP yang sama.
- **OpenRouteService (ORS)**: layanan rute gratis berbasis OpenStreetMap dari HeiGIT (Universitas Heidelberg); dipakai untuk jarak rute jalan kendaraan.
- **OSRM (Open Source Routing Machine)**: mesin rute OpenStreetMap; server demonya dipakai sebagai cadangan.
- **Undangan kalender (iCalendar/ICS)**: format standar acara kalender. Email berisi undangan REQUEST membuat atau memperbarui acara; CANCEL dengan ID acara yang sama menghapusnya.
- **HPP (harga pokok penjualan)**: modal per unit produk.
- **Median ±14 hari**: nilai tengah omzet harian 14 hari sebelum dan sesudah suatu tanggal; dipakai sebagai pembanding agar hari ramai terlihat sebagai rasio (mis. 21,4× = 21,4 kali hari biasa).
- **Metode periodik**: HPP dihitung dari total pembelian bahan pada periode, bukan dari modal per produk.
- **H-1**: satu hari sebelum jadwal ambil/antar.
