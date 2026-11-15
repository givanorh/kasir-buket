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

## 8. Keamanan
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
