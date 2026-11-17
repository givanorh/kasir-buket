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
1. **Buka shift** (menu Shift, atau langsung di halaman Kasir): isi kas awal. Akun Admin dan Perangkai tidak bisa memakai Kasir sebelum shift dibuka; owner tetap bisa.
2. **Transaksi**: pilih produk › Bayar › isi pelanggan, pengambilan, kartu ucapan, catatan › pilih Lunas/DP › Simpan. Dua cetakan keluar otomatis.
3. **Ruang perangkai** (akun perangkai): menu Produksi, ketuk “Mulai rangkai” › “Selesai dirangkai”. Status langsung terlihat di kasir.
4. **Pengambilan & pelunasan DP** (akun kasir/Admin): Produksi › kolom Siap diambil/antar. Pesanan yang masih DP menampilkan **Bayar pelunasan** › pilih metode › Bayar; struk pelunasan tercetak otomatis. Setelah lunas, tombol berganti **Sudah diambil**.
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
   - Saat perangkai ditunjuk (di kasir atau di detail pesanan), server mengirim email berisi Tugas kalender ±15 detik kemudian. Acara muncul di Google Calendar perangkai, berakhir pada jadwal ambil/antar dan dimulai sesuai "durasi rangkai" (bawaan 60 menit).
   - Jadwal, item, catatan, atau kartu ucapan berubah: Tugas diperbarui. Perangkai diganti: Tugas lama dibatalkan dan perangkai baru menerima Tugas. Pesanan dibatalkan: Tugas dibatalkan dan acara hilang dari kalendernya.
   - Syarat: Akun GMAIL Toko sudah diatur (Pengaturan › Reset Password). Sekali per perangkai: simpan alamat Gmail toko di Kontak Google perangkai, atau di Google Calendar › Setelan › Setelan acara › "Tambahkan undangan ke kalender saya" pilih "Dari semua orang". Pastikan dengan tombol **Uji** lalu **Batalkan uji**.
   - Riwayat pengiriman (terkirim, menunggu, gagal) tampil di tab yang sama. Gagal kirim dicoba ulang otomatis sampai 8 kali dengan jeda 30 detik s.d. 1 jam.
5. **Poin loyalitas**: bawaan 1 poin per Rp 10.000 (tanpa ongkir), 1 poin = Rp 100, minimal tukar 50 poin; tingkat Silver ≥ Rp 1 jt dan Gold ≥ Rp 3 jt belanja 12 bulan. Poin muncul di kasir saat nomor HP pelanggan dikenali, dan profil lengkap ada di menu Pelanggan.
6. **Pop-up ulasan & survei**: muncul di kasir setiap N transaksi per perangkat (bawaan 5). Berisi QR ulasan Google Maps, kolom diskon ulasan beserta sisa budget bulan ini (lihat 8b.4), dan 1–2 pertanyaan yang diacak dari bank pertanyaan.
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

    Sejak v1.8 kode diberikan otomatis saat perangkat pertama kali masuk (lihat bagian 8e) dan hanya owner yang mengubahnya di Pengaturan › Perangkat › Perangkat terdaftar. Perangkat sejenis kedua menjadi KK2, ketiga KK3. Kode yang pernah dipakai tidak diberikan ke perangkat lain, sehingga nomor struk tidak pernah kembar. Nomor struk lama (mis. 261115-A001) tidak berubah.
11. **HPP hasil impor**: bila menu Produk menampilkan peringatan "HPP lebih besar dari harga jual", tekan **Perbaiki HPP**. Impor versi lama membaca nilai modal total Kasir Pintar (HPP × stok); perbaikan membagi nilai itu dengan stok awal impor. Contoh: Rp 149.998.950.000 ÷ 999.993 = Rp 150.000.

## 8a. Fitur Versi 1.4
1. **Tombol − / + di kartu produk**: setelah produk diketuk, muncul pengatur jumlah di atas fotonya. − mengurangi 1 (bila 0, keluar dari keranjang), + menambah 1, tanpa membuka keranjang.
2. **Member & poin**: hanya member yang mendapat dan menukar poin. Nomor member = nomor HP pelanggan (08…, otomatis dinormalisasi dari +62/62). Daftar lewat centang **Daftarkan member** di Pembayaran, tombol **Daftarkan member** di profil Pelanggan, atau kotak Member di formulir pelanggan. Saldo poin lama dari transaksi sebelum v1.4 aktif setelah pelanggan terdaftar. Struk member memuat baris `MEMBER : 08…` dan saldo poin.
3. **Pembatalan pesanan lunas**: Admin tidak bisa membatalkan pesanan yang sudah lunas. Admin menekan **Ajukan pembatalan ke owner** dan wajib mengisi alasan. Owner menerima email (bila email owner & pengirim sudah diatur) dan melihat daftar **Menunggu persetujuan pembatalan** di menu Pesanan dan Produksi (angka merah di menu Pesanan). **Setujui & batalkan** membatalkan pesanan, pembayaran, dan mengembalikan stok; **Tolak** mencatat alasan penolakan. Aturan ini juga dijaga server, jadi tidak bisa dilewati dari perangkat mana pun. Pesanan DP/belum bayar tetap bisa dibatalkan Admin dengan alasan.
4. **Peringatan H-1**: pesanan ambil/antar untuk besok yang masih Antri/Dirangkai tampil sebagai pita kuning di atas setiap halaman (kecuali Pengaturan), beserta pesanan hari ini yang belum selesai. Kartu di papan Produksi diberi tanda "H-1". Tombol **Lihat** membuka Produksi › Besok.
5. **Kalender** (owner): 32 event 2026 terisi otomatis (libur nasional & cuti bersama sesuai SKB 3 Menteri, puncak penjualan termasuk wisuda, lonjakan dari data toko), lengkap dengan catatan omzet. Setiap event menampilkan omzet hari itu (atau tahun lalu bila belum terjadi) dan rasio terhadap median ±14 hari. Peta panas 12 bulan menandai hari ramai; daftar **Lonjakan omzet tanpa event** membantu menemukan momen baru. Event bisa ditambah, diubah, dihapus, dan **Salin ke 2027** untuk event bertanggal tetap.
6. **Belanja bahan** (owner, sejak v1.6 di Laporan › Perhitungan HPP › Belanja bahan): catat manual (tanggal, bahan, kategori, jumlah, satuan, harga satuan, pemasok) atau **Unggah CSV/Excel** (.xlsx atau .csv; Google Sheets › File › Download). Baris pertama berisi judul kolom; wajib kolom Bahan dan Harga satuan atau Total. Tanggal boleh `2026-11-16`, `16/11/2026`, atau tanggal Excel. Unggah ulang berkas yang sama tidak menggandakan data. Tombol **Template** mengunduh contoh berkas.
7. **Dasar HPP laba rugi** (Laporan atau Belanja bahan): *Gabungan* = Σ modal produk terjual + Σ belanja bahan periode (bawaan); *Belanja bahan* = metode periodik (cocok bila HPP produk belum diisi); *Modal produk* = hanya HPP produk (pilih bila HPP produk sudah dihitung dari bahan yang sama, agar tidak terhitung dua kali). Asumsi metode periodik: bahan yang dibeli habis dipakai pada periode yang sama.

## 8b. Fitur Versi 1.5
1. **Pembayaran dimulai dari Nomor HP**: kolom pertama di jendela Pembayaran adalah **Nomor HP** dan langsung aktif. Nomor yang sudah tersimpan mengisi otomatis nama, alamat, dan saldo poin (tanda centang hijau). Nomor boleh dikosongkan atau belum tersimpan: transaksi tetap jalan sebagai pelanggan bukan member, tanpa poin. Centang **Daftarkan member** bila pelanggan setuju.
2. **Wajib buka shift**: Admin dan Perangkai melihat kartu "Buka shift untuk mulai berjualan" di halaman Kasir sampai shift dibuka (isi kas awal). Owner tetap bisa berjualan tanpa shift dan hanya melihat catatan kuning.
3. **Jadikan event rutin** (Kalender, owner): event berjenis *lonjakan data* dan daftar lonjakan omzet punya tombol **Jadikan event rutin**. Nama diusulkan dari tanggal (mis. lonjakan 31 Jul–2 Agu menjadi "National Girlfriend Day (1 Agu)", lonjakan 1–3 Okt menjadi "National Boyfriend Day (3 Okt)"). Event rutin bertanda **Rutin** dan otomatis muncul tiap tahun pada tanggal yang sama (29 Feb menjadi 28 Feb pada tahun bukan kabisat).
4. **Diskon ulasan Google Maps** (owner, Pengaturan › Promo, poin & ongkir):
   - **Budget per bulan** (bawaan Rp 250.000; Rp 0 = tanpa batas). Pemakaian dihitung dari transaksi tidak void pada bulan kalender berjalan di semua perangkat yang sudah tersinkron.
   - **Belanja minimal** (bawaan Rp 50.000): subtotal setelah potongan item. Di bawah nilai ini diskon ulasan tidak ditawarkan.
   - **Kolom diskon**: bawaan Ulasan bintang Rp 5.000, Ulasan + komentar Rp 7.500, Ulasan + foto buket Rp 10.000. **Tambah kolom diskon** untuk kolom baru; tiap kolom bisa nominal (Rp) atau persen dengan batas maksimal, diaktifkan/nonaktifkan, diganti nama, atau dihapus. Persen dibulatkan ke bawah kelipatan Rp 100. Contoh 5% maks Rp 15.000 pada belanja Rp 142.000: 142.000 × 5% = 7.100.
   - **Pop-up kasir** menampilkan sisa budget bulan ini. Kolom yang nominalnya melebihi sisa budget atau belanja di bawah minimal dinonaktifkan beserta alasannya. Nama kolom yang dipilih tercatat di transaksi dan tampil di ringkasan pembayaran.
   - **Saran budget** dihitung dari data 12 bulan kalender penuh terakhir (tanpa void dan rekap ≥ Rp 10 jt): transaksi per bulan ÷ frekuensi pop-up × 40% (asumsi pelanggan mau mengulas) × rata-rata diskon kolom aktif, dibulatkan ke atas kelipatan Rp 50.000. Data toko Nov 2025–Okt 2026: 4.571 ÷ 12 = 380,9 transaksi/bulan; ÷ 5 = 76,2 tawaran; × 40% × Rp 7.500 = Rp 228.550 → Rp 250.000. Angka 40% adalah asumsi awal; sesuaikan setelah 1–2 bulan berjalan dengan melihat jumlah transaksi berdiskon ulasan.
   - Batas budget dihitung di perangkat. Dua perangkat yang sedang offline bisa sama-sama memberi diskon sehingga pemakaian sedikit melebihi budget; selisihnya tetap tercatat di laporan.
   - Kebijakan konten Google Maps melarang memberi imbalan (termasuk diskon) sebagai ganti ulasan. Ulasan yang terdeteksi bisa dihapus Google dan profil toko bisa dibatasi. Pertimbangkan menamai kolom sebagai imbalan mengisi survei atau masukan, bukan imbalan ulasan.
5. **Tampilan & animasi**: penanda menu aktif bergeser halus, perpindahan halaman dan tab berarah, kartu produk muncul berurutan saat pertama dimuat, tombol mengecil saat ditekan, jendela muncul dengan efek membesar, dan latar bermotif garis kelopak tipis. Animasi hanya memakai transform dan opacity, 150–600 ms, dan dimatikan bila perangkat mengaktifkan pengaturan kurangi gerak.

## 8c. Fitur Versi 1.6
1. **Laporan › Perhitungan HPP** (owner). Menu Belanja bahan dipindah ke sini. Tiga bagian:
   - **Ringkasan HPP**: HPP penuh per buket = (HPP bahan + tenaga kerja + overhead) ÷ buket terjual, harga rata-rata per buket, margin, dan titik impas. Contoh data toko Okt 2026: bahan Rp 3.915.000 + tenaga kerja Rp 9.425.000 + overhead Rp 0 = Rp 13.340.000 ÷ 404 buket = Rp 33.020 per buket. Bila banyak produk ber-HPP Rp 0 (hasil impor), muncul peringatan karena HPP bahan terlalu rendah.
   - **Belanja bahan**: sama seperti versi 1.4 (catat manual, unggah CSV/Excel).
   - **Gaji & biaya** (semua bisa diubah, tekan **Simpan gaji & biaya**):
     - Gaji pegawai: Iin 1.400.000, Fira 1.500.000, Nazra 1.400.000, Tiara 1.400.000, Mirna 1.000.000, Putri 1.000.000, Ririn 1.000.000; jumlah Rp 8.700.000 per bulan. Kolom bonus tahunan dan tanggal mulai kerja per orang.
     - THR: gaji × pengali (bawaan 1); masa kerja 1–11 bulan proporsional (masa kerja ÷ 12), di bawah 1 bulan Rp 0 (Permenaker 6/2016; dibayar paling lambat H-7 hari raya). Tanpa tanggal mulai kerja dianggap ≥ 12 bulan.
     - Biaya operasional: bonus tambahan, listrik, air, internet & pulsa, servis AC (tiap 3 bulan), servis printer (tiap 6 bulan), servis komputer (per tahun), pembelian lampu (tiap 6 bulan), jajan dadakan, BBM & parkir antar, kebersihan & keamanan, sewa tempat, biaya admin bank/QRIS (% penjualan), perbaikan tak terduga. **Tambah biaya** untuk pos lain. Frekuensi: per bulan, tiap N bulan, per tahun, sekali (tanggal), atau % penjualan.
     - Uang standby di laci: dicatat sebagai modal kerja, tidak mengurangi laba.
2. **Laba rugi** kini memuat − Gaji pegawai, − THR & bonus, − Biaya operasional, dan − Kas keluar berjenis biaya. Alokasi proporsional hari per bulan kalender: satu bulan penuh = nilai bulanan; biaya tahunan (THR, bonus tahunan, sewa) dibagi 12 (akrual). Contoh Okt 2026: gaji Rp 8.700.000 + THR 8.700.000 ÷ 12 = Rp 725.000. Bila biaya yang sama juga dicatat sebagai kas keluar di Shift, nolkan salah satunya. Data gaji hanya dikirim server ke perangkat owner.
3. **Kalender**: kategori **Libur Nasional, Lokal, Puncak Penjualan** (dulu Momen buket), **Lonjakan data, Toko**. Kategori *Musim* dihapus: Ramadan dihapus dari kalender, buket uang menjelang Lebaran dan wisuda menjadi Puncak Penjualan (otomatis saat owner membuka Kalender). Filter kategori menampilkan jumlah event; **Urutkan › Total omzet** memeringkat event (event yang belum terjadi memakai omzet tahun lalu).
4. **Google Calendar owner** (Kalender › tombol Google Calendar): centang aktif, penerima = email akun owner (Pengaturan › Pengguna) + email tambahan (maks. 10), pilih kategori, **Simpan & sinkronkan**. Event masa depan dan event rutin dikirim sebagai acara sepanjang hari (event rutin berulang tiap tahun). Ubah/hapus event di aplikasi, kalender penerima ikut berubah; mematikan sinkron menghapus acara dari kalender penerima. Pengingat H-7 dan H-3 pukul 08.00 WIB dikirim server sebagai email karena Google Calendar tidak memakai alarm dari undangan email. Agar juga muncul notifikasi di HP: Google Calendar › Setelan › pilih kalender › Notifikasi acara sepanjang hari › tambah "1 minggu sebelumnya" dan "3 hari sebelumnya".
5. **Lihat sandi** (Pengaturan › Pengguna › Lihat): menampilkan sandi yang diatur owner (saat membuat pengguna atau lewat tombol Sandi). Disimpan terenkripsi AES-256-GCM dengan kunci server. Sandi yang diganti pengguna sendiri lewat "Lupa kata sandi?" tidak disimpan; sandi lama sebelum v1.6 juga belum tersimpan, jadi atur ulang sekali lewat tombol Sandi.
6. **Reset Password (perbaikan v1.6.1)**: untuk Gmail, Pass Email Toko wajib App Password 16 huruf; spasi dan karakter tak terlihat hasil salin dibuang, sandi Gmail biasa ditolak sebelum disimpan, dan jumlah huruf tampil saat mengetik. **Tes Email** memakai isian yang sedang tampil (belum perlu Simpan). Kolom Kirim ke kosong: dikirim ke email akun owner; bila owner belum punya email, ke Akun GMAIL Toko sendiri. Penolakan Google (535 5.7.8) diterjemahkan menjadi langkah perbaikan.
7. **Perubahan nama**: tab Email menjadi **Reset Password** (Email Reset, Akun GMAIL Toko, Pass Email Toko, Tes Email); "undangan" untuk perangkai menjadi **Tugas**; kolom Nomor HP di Pembayaran tanpa keterangan opsional. Formulir Tambah pengguna tidak lagi diisi otomatis oleh browser dengan username/sandi owner.

## 8d. Fitur Versi 1.7
1. **Menu Riwayat** (dulu Pesanan) dipindah ke bawah Produksi. Riwayat hanya catatan: ketuk transaksi untuk melihat **invoice** (pratinjau struk) dan **status transaksi** (pembayaran, produksi, tanggal siap/diambil, pembatalan). Transaksi DP menampilkan nominal + tanggal DP dan nominal + tanggal pelunasan. Tidak ada form pelunasan, ubah status, atau pembatalan di Riwayat; tersedia Cetak ulang struk. Tautan lama `#/pesanan` otomatis dialihkan ke `#/riwayat`.
2. **Wewenang tombol Produksi** (tombol yang bukan wewenang akun tampil abu-abu):

| Status → tujuan | Perangkai | Kasir/Admin | Owner |
|---|---|---|---|
| Antri → Dirangkai (Mulai rangkai) | ya | abu-abu | ya |
| Dirangkai → Siap (Selesai dirangkai) | ya | abu-abu | ya |
| Siap → Selesai (Sudah diambil) | abu-abu | ya, bila sisa tagihan = 0 | ya, bila sisa tagihan = 0 |
| Siap + masih DP/belum bayar | abu-abu ("Sudah diambil") | **Bayar pelunasan** | **Bayar pelunasan** |

3. **Jendela pelunasan**: riwayat pembayaran bertanggal, sisa tagihan, metode, nominal (bawaan = seluruh sisa; boleh sebagian), uang diterima dan kembalian untuk tunai. Bila sisa menjadi Rp 0, printer kasir mencetak **STRUK PELUNASAN** berisi DP (metode, nominal, tanggal), pelunasan (metode, nominal, tanggal), dan status LUNAS. Pesanan lama yang sudah diambil tetapi belum lunas tampil di bagian **Sudah diambil, belum lunas** di bawah papan Produksi.
4. **Pembatalan & persetujuan owner** pindah ke detail kartu Produksi (ketuk nomor/isi kartu). Daftar pengajuan pembatalan untuk owner ada di atas papan Produksi; angka pengajuan tampil di menu Produksi.
5. **Galat lewat ngrok/tunnel**: bila agen ngrok di PC toko berhenti, alamat ngrok menjawab dengan halaman galat HTML milik ngrok (ERR_NGROK_3200, endpoint offline), bukan jawaban JSON server Kasir Buket. Versi lama menampilkan setiap jawaban non-JSON sebagai "Galat <status>" (contoh: "Galat 404" saat hitung ongkir di HP), sedangkan PC yang membuka `localhost` tetap normal karena tidak lewat ngrok. Sekarang pesan menyebut penyebabnya, misalnya "Tunnel ngrok sedang mati (ERR_NGROK_3200). Jalankan lagi ngrok di PC toko", dan lencana sinkron berubah menjadi Offline. ERR_NGROK_8012 berarti ngrok hidup tetapi server di PC mati atau port berbeda. Aplikasi juga mengirim header `ngrok-skip-browser-warning` agar halaman peringatan ngrok gratis tidak menghalangi permintaan data.

## 8e. Fitur Versi 1.8
1. **Pengambilan "Ready"**: pilihan *Ditunggu* berganti nama menjadi **Ready** (barang siap, langsung dibawa). Berlaku di Kasir, detail pesanan, Riwayat, kartu Produksi, tiket produksi, dan email tugas perangkai. Struk tetap mencetak `AMBIL : SEKARANG`.
2. **Riwayat**: filter *Jadwal* menjadi **Deadline**; urutan filter: Hari ini, 30 hari, Deadline, Belum lunas.
3. **Layar masuk hanya username dan kata sandi.** Pilihan "Jenis perangkat ini" dan "Dipakai untuk" dihapus. Perangkat dikenali otomatis:
   - Identitas: ID acak yang tersimpan di perangkat sejak pertama kali dibuka (tetap sama selama data browser/aplikasi tidak dihapus).
   - Jenis: layar sentuh dengan sisi pendek < 600 px = HP, layar sentuh ≥ 600 px = Tablet, selain itu Komputer.
   - Fungsi awal: mengikuti peran akun yang pertama masuk (Admin = Kasir, Perangkai = Ruang Rangkai, Owner = Owner).
   - Perangkat yang sudah terdaftar tidak berubah kode saat masuk lagi, siapa pun yang masuk.
4. **Pengaturan › Perangkat › Perangkat terdaftar** (owner): daftar semua perangkat yang pernah masuk, berisi kode, nama, browser dan sistem (mis. "Chrome · Android SM-A546E"), pengguna terakhir, waktu masuk terakhir, dan jumlah login. Owner mengisi **nama** (mis. "Tablet depan") dan memilih **jenis** serta **fungsi**, lalu Simpan. Bila kategori berubah, perangkat itu langsung memakai kode baru tanpa masuk ulang; kode lama tetap dicadangkan dan nomor struk yang sudah terbit tidak berubah. **Lihat riwayat login** menampilkan 30 login terakhir (waktu, pengguna, perangkat). Perangkat berkode versi lama (mis. "B") diberi kode baru setelah owner memilih jenis dan fungsinya.
5. **"Perubahan ditolak server" dihapus dari layar.** Daftar itu berisi perubahan yang tidak diterima server. Sekarang ditangani otomatis: rekaman ber-ID tidak sah dibuang dari perangkat, penolakan lain membuat perangkat menarik ulang versi server. Penyebab baris `products/kp-` (impor Kasir Pintar 15 Nov 2026): baris produk tanpa ID dan tanpa kode barang menghasilkan ID "kp-" (3 karakter, di bawah syarat 4–64 karakter), sehingga ditolak dan tidak pernah sampai ke server. Sejak v1.8 baris seperti itu mendapat ID dari nama + harga + kategori; baris yang benar-benar kosong dilewati dan jumlahnya tampil di ringkasan impor. **Impor ulang berkas Kasir Pintar yang sama** (Pengaturan › Impor Kasir Pintar) untuk memasukkan produk yang dulu tertolak; data lain tidak menjadi ganda.
6. **Sinkron lebih hemat**: server mengirim denyut lewat saluran realtime (SSE) tiap 25 detik. Selama denyut diterima, polling cadangan cukup 5 menit sekali (sebelumnya 30 detik sekali). Hitungan per perangkat untuk 12 jam buka: 12 × 3600 ÷ 30 = 1.440 permintaan menjadi 12 × 60 ÷ 5 = 144 permintaan. Bila saluran realtime terputus, polling kembali 30 detik sekali.
7. **Peran ngrok dan rencana setelah VPS**:
   - ngrok bukan bagian aplikasi. Fungsinya hanya meneruskan alamat publik HTTPS ke server di PC toko, untuk perangkat di luar WiFi toko. Perangkat di WiFi yang sama cukup membuka `http://IP-KOMPUTER:8080` tanpa ngrok.
   - Batas ngrok gratis: 20.000 permintaan HTTP dan 1 GB data keluar per bulan, 1 domain. Dengan polling lama, 20.000 ÷ 1.440 ≈ 13,9 hari-perangkat (3 perangkat ≈ 4,6 hari). Dengan v1.8: 20.000 ÷ 144 ≈ 138 hari-perangkat (3 perangkat × 30 hari = 90 hari-perangkat, kira-kira 65% kuota, belum termasuk transaksi dan buka halaman).
   - Cloudflare Quick Tunnel (alamat `trycloudflare.com`) tidak cocok: tidak mendukung SSE, alamat acak tiap dijalankan, tanpa jaminan layanan.
   - Setelah server pindah ke VPS (bagian 3): ngrok tidak diperlukan lagi. Hapus agen ngrok dari PC, lalu di tiap perangkat buka alamat VPS dan masuk. Header `ngrok-skip-browser-warning` hanya dikirim bila alamat server mengandung "ngrok", jadi otomatis berhenti; pesan galat untuk jawaban non-JSON tetap berguna (mis. saat layanan di VPS sedang dimulai ulang).
8. **Pembaruan sekali klik di PC toko**: klik dua kali `deploy\perbarui.bat`. Urutannya: (1) build aplikasi; (2) hentikan server lama, salin basis data ke `data\backups\sebelum-pembaruan-<waktu>-kasir.db` (5 set terakhir disimpan), jalankan server baru; (3) commit; (4) push ke GitHub. Bila build gagal, server tidak diubah. Hasil tiap langkah tercatat di `deploy\perbarui.log`. Karena repositori bersifat publik, berkas baru yang bukan berkas sumber (basis data, ekspor JSON, Excel/CSV, arsip, kunci) tidak pernah ikut commit otomatis dan hanya disebut di catatan.

## 9. Lupa Kata Sandi
1. **Lewat email (disarankan).** Owner mengatur sekali: Pengaturan › Reset Password › Email Reset › isi **Akun GMAIL Toko** dan **Pass Email Toko** (*app password*: Akun Google › Keamanan › Verifikasi 2 Langkah aktif › myaccount.google.com/apppasswords) › Simpan › **Tes Email**. Lalu isi email tiap pengguna di Pengaturan › Pengguna. Di halaman masuk, ketuk **Lupa kata sandi?**, masukkan username atau email, masukkan kode 6 digit dari email (berlaku 15 menit), lalu buat sandi baru.
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
- **Event rutin**: event yang diproyeksikan ke setiap tahun pada tanggal dan bulan yang sama tanpa perlu disalin manual.
- **Budget diskon ulasan**: batas total nominal diskon ulasan dalam satu bulan kalender; sisa = budget − Σ diskon ulasan transaksi tidak void bulan itu.
- **Kolom diskon**: satu pilihan diskon di pop-up kasir, berupa nominal tetap atau persen dari belanja dengan batas maksimal.
- **Shift**: periode kerja satu kasir dari buka sampai tutup laci, dipakai untuk merekap uang tunai.
- **Kurangi gerak (prefers-reduced-motion)**: pengaturan aksesibilitas perangkat; bila aktif, animasi aplikasi dimatikan.
- **Port 9100**: port standar pencetakan mentah (raw) pada printer jaringan.
- **DHCP reservation**: pengaturan router agar perangkat tertentu selalu mendapat IP yang sama.
- **OpenRouteService (ORS)**: layanan rute gratis berbasis OpenStreetMap dari HeiGIT (Universitas Heidelberg); dipakai untuk jarak rute jalan kendaraan.
- **OSRM (Open Source Routing Machine)**: mesin rute OpenStreetMap; server demonya dipakai sebagai cadangan.
- **Tugas kalender / undangan iCalendar (ICS)**: format standar acara kalender. Email berisi REQUEST membuat atau memperbarui acara; CANCEL dengan ID acara yang sama menghapusnya.
- **RRULE:FREQ=YEARLY**: aturan pengulangan iCalendar; acara muncul setiap tahun pada tanggal yang sama.
- **VALARM**: alarm di dalam acara iCalendar; dipakai Apple Calendar/Outlook, diabaikan Google Calendar untuk undangan email.
- **HPP penuh per buket**: (HPP bahan + tenaga kerja + overhead) ÷ buket terjual; harga minimal agar tidak rugi.
- **Overhead**: biaya tidak langsung (listrik, servis, lampu, jajan, dll) yang ditanggung semua buket.
- **Titik impas (BEP)**: ⌈biaya tetap per bulan ÷ (harga rata-rata − bahan per buket)⌉; jumlah buket per bulan agar laba = 0.
- **Akrual**: biaya tahunan dibagi rata per bulan sejak terjadi, bukan dicatat penuh di bulan bayar.
- **THR (Tunjangan Hari Raya)**: pendapatan non-upah wajib menjelang hari raya keagamaan (Permenaker 6/2016).
- **Modal kerja**: uang yang berputar untuk operasi harian (mis. uang kembalian di laci); bukan beban.
- **HPP (harga pokok penjualan)**: modal per unit produk.
- **Median ±14 hari**: nilai tengah omzet harian 14 hari sebelum dan sesudah suatu tanggal; dipakai sebagai pembanding agar hari ramai terlihat sebagai rasio (mis. 21,4× = 21,4 kali hari biasa).
- **Metode periodik**: HPP dihitung dari total pembelian bahan pada periode, bukan dari modal per produk.
- **H-1**: satu hari sebelum jadwal ambil/antar.
- **DP (down payment)**: uang muka; sisa tagihan = total − Σ pembayaran tidak void.
- **Pelunasan**: pembayaran yang menutup sisa tagihan DP; tercatat sebagai pembayaran jenis `pelunasan` dengan tanggalnya sendiri.
- **Tunnel (ngrok)**: perantara yang meneruskan alamat publik HTTPS ke server di PC toko. Bila agen ngrok di PC berhenti, alamat publik menjawab halaman galat ngrok.
- **ERR_NGROK_3200**: kode ngrok untuk endpoint offline (agen ngrok tidak berjalan, berhenti, atau alamat salah).
- **ERR_NGROK_8012**: kode ngrok saat agen berjalan tetapi gagal menyambung ke aplikasi lokal (server mati atau port salah).
- **SSE (Server-Sent Events)**: saluran satu arah dari server ke perangkat yang tetap terbuka; dipakai untuk memberi tahu ada data baru tanpa menunggu polling.
- **Polling**: perangkat bertanya ke server secara berkala apakah ada data baru.
- **Denyut (heartbeat)**: pesan kecil berkala lewat SSE sebagai tanda saluran masih hidup.
- **Hari-perangkat**: satuan pemakaian = 1 perangkat aktif selama 1 hari; 3 perangkat selama 30 hari = 90 hari-perangkat.
- **User-Agent**: keterangan browser dan sistem yang dikirim perangkat pada setiap permintaan; dipakai untuk mengisi kolom info di daftar perangkat.
- **Build**: mengubah kode sumber aplikasi menjadi berkas siap pakai di `app/dist` yang disajikan server.
- **Commit / push**: commit menyimpan perubahan ke riwayat Git di PC; push mengirim riwayat itu ke GitHub.
- **ID deterministik**: ID yang dihitung dari isi data, sehingga impor ulang berkas yang sama menghasilkan ID yang sama dan tidak menggandakan data.
