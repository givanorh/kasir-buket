// Uji end-to-end: 2 perangkat (tablet kasir + HP ruang perangkai) terhadap server sungguhan.
// Jalankan: node e2e/e2e.mjs   (butuh Playwright + Chromium; app/dist sudah dibangun)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = process.env.SHOTS || path.join(ROOT, 'e2e', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 8787;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-e2e-'));
const log = (...a) => console.log('•', ...a);
const assert = (c, m) => { if (!c) throw new Error('GAGAL: ' + m); log('OK', m); };

// layanan rute tiruan: OpenRouteService menjawab 7,38 km; OSRM sengaja mati agar terbukti ORS yang dipakai
const http = await import('node:http');
const routeCalls = [];
const routeSrv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    routeCalls.push({ url: req.url, auth: req.headers.authorization, body });
    if (req.method === 'POST' && req.url === '/v2/directions/driving-car') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ routes: [{ summary: { distance: 7380, duration: 840 } }] })); }
    res.writeHead(503); res.end();
  });
});
await new Promise((r) => routeSrv.listen(0, '127.0.0.1', r));
const ROUTE = `http://127.0.0.1:${routeSrv.address().port}`;

const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/index.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, STATIC_DIR: path.join(ROOT, 'app/dist'), ORS_URL: ROUTE, OSRM_URL: ROUTE, NOTIFY_DELAY_MS: '300', NOTIFY_INTERVAL_MS: '400' }, stdio: 'inherit',
});
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch();
const tomorrow = new Date(Date.now() + 86400000);
const p2 = (n) => String(n).padStart(2, '0');
const dueStr = `${tomorrow.getFullYear()}-${p2(tomorrow.getMonth() + 1)}-${p2(tomorrow.getDate())}T10:00`;

try {
  // ---------- Perangkat A: tablet kasir (owner) ----------
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await ctxA.addInitScript(() => { window.__KB_TEST__ = true; });
  const A = await ctxA.newPage();
  A.on('pageerror', (e) => console.error('pageerror A', e));
  await A.goto(BASE);
  await A.getByLabel('Nama toko').fill('Buket Stabat');
  await A.getByLabel('Alamat toko').fill('Jl. Proklamasi No. 1, Stabat, Langkat');
  await A.getByLabel('No. telepon/WA toko').fill('0812-0000-1111');
  await A.getByLabel('Nama pemilik').fill('Vano');
  await A.getByLabel('Username').fill('vano');
  await A.getByLabel('Kata sandi (min. 6)').fill('rahasia1');
  assert(/Kode nomor struk: KK/.test(await A.getByTestId('kode-preview').textContent()), 'komputer terdeteksi: kode KK (Komputer Kasir)');
  await A.getByRole('button', { name: 'Siapkan toko' }).click();
  await A.getByTestId('sync-badge').waitFor();
  assert(true, 'setup toko & login owner');

  // produk
  await A.goto(BASE + '/#/produk');
  for (const [nama, harga, hpp] of [['Buket Mawar Merah', '150000', '90000'], ['Buket Snack Wisuda', '120000', '70000'], ['Buket Uang 50rb x10', '650000', '560000']]) {
    await A.getByTestId('btn-produk-baru').click();
    await A.getByTestId('produk-nama').fill(nama);
    await A.getByLabel('Harga jual').fill(harga);
    await A.getByLabel('HPP').fill(hpp);
    await A.getByTestId('btn-simpan-produk').click();
  }
  await A.waitForFunction(() => document.querySelectorAll('.trow').length === 3, null, { timeout: 5000 }).catch(async () => { await A.screenshot({ path: path.join(SHOTS, 'debug-produk.png') }); });
  assert((await A.locator('.trow').count()) === 3, '3 produk tersimpan');

  // pengguna perangkai
  await A.goto(BASE + '/#/pengaturan');
  await A.getByRole('radio', { name: 'Pengguna' }).click();
  await A.getByLabel('Nama', { exact: true }).fill('Sari (perangkai)');
  await A.getByLabel('Username').fill('rangkai1');
  await A.getByLabel('Kata sandi (min. 6)').fill('rangkai1');
  await A.getByRole('group', { name: 'Peran' }).getByRole('radio', { name: 'Perangkai' }).click();
  await A.getByRole('button', { name: 'Tambah pengguna', exact: true }).click();
  await A.getByText('@rangkai1').waitFor();
  assert(true, 'akun perangkai dibuat');

  // shift
  await A.goto(BASE + '/#/shift');
  await A.locator('.money input').first().fill('200000');
  await A.getByTestId('btn-buka-shift').click();
  await A.getByTestId('expected').waitFor();

  // transaksi 1: pesanan besok, DP, QRIS
  await A.goto(BASE + '/#/kasir');
  const card = (n) => A.getByTestId('product-card').filter({ hasText: n });
  await card('Buket Mawar Merah').click();
  await card('Buket Mawar Merah').click();
  await card('Buket Snack Wisuda').click();
  await A.getByTestId('cart-open').click();
  await A.screenshot({ path: path.join(SHOTS, '1-kasir-tablet.png') });
  await A.getByTestId('btn-bayar').click();
  await A.getByTestId('cust-name').fill('Rina');
  await A.getByLabel('Nomor HP/WA').fill('081234567890');
  await A.getByRole('radio', { name: 'Ambil nanti' }).click();
  await A.getByTestId('due').fill(dueStr);
  await A.getByTestId('card').fill('Happy Graduation, Rina! Bangga sama kamu.');
  await A.getByTestId('notes').fill('Wrapping pink pastel, pita satin putih');
  await A.getByTestId('florists').getByRole('button', { name: 'Nazra' }).click();
  await A.getByRole('radio', { name: 'DP' }).click();
  await A.getByRole('button', { name: 'QRIS' }).click();
  await A.screenshot({ path: path.join(SHOTS, '2-pembayaran-dp.png') });
  await A.getByTestId('btn-simpan').click();
  const no1 = await A.getByTestId('order-no').textContent();
  assert(/^\d{6}-KK001$/.test(no1), `nomor transaksi berawalan kode perangkat bermakna ${no1}`);
  const pk = await A.getByTestId('print-kasir').textContent();
  const pp = await A.getByTestId('print-produksi').textContent();
  assert(/dialog cetak dibuka/.test(pk), 'struk pelanggan → printer kasir');
  assert(/dikirim ke perangkat ruang perangkai/.test(pp), 'tiket produksi → antre ke stasiun ruang perangkai');
  const prev = await A.getByTestId('preview').textContent();
  assert(/SISA TAGIHAN/.test(prev) && /DP QRIS/.test(prev), 'struk memuat DP & sisa tagihan');
  await A.screenshot({ path: path.join(SHOTS, '3-berhasil-struk.png') });
  await A.getByTestId('btn-baru').click();

  // ---------- Perangkat B: HP ruang perangkai ----------
  const ctxB = await browser.newContext({ ...devices['Pixel 7'] });
  await ctxB.addInitScript(() => { window.__KB_TEST__ = true; });
  const B = await ctxB.newPage();
  B.on('pageerror', (e) => console.error('pageerror B', e));
  await B.goto(BASE);
  await B.getByLabel('Username').fill('rangkai1');
  await B.getByLabel('Kata sandi').fill('rangkai1');
  await B.getByRole('radio', { name: 'Ruang Rangkai' }).click();
  assert(/Kode nomor struk: HR/.test(await B.getByTestId('kode-preview').textContent()), 'HP terdeteksi otomatis, fungsi ruang rangkai: kode HR');
  await B.getByRole('button', { name: 'Masuk' }).click();
  await B.getByTestId('sync-badge').waitFor();
  await B.goto(BASE + '/#/pengaturan');
  await B.getByRole('radio', { name: 'Printer' }).click();
  await B.getByTestId('printer-produksi').locator('select').selectOption('system');
  await B.getByTestId('station-produksi').check();
  await B.goto(BASE + '/#/produksi');
  await B.getByTestId('prod-card').first().waitFor({ timeout: 15000 });
  assert((await B.getByTestId('prod-card').count()) === 1, 'pesanan muncul otomatis di papan produksi HP perangkai');
  await B.waitForFunction(() => (window.__KB_PRINTLOG__ || []).some((x) => x.target === 'produksi'), null, { timeout: 15000 });
  const tiket = await B.evaluate(() => window.__KB_PRINTLOG__.find((x) => x.target === 'produksi').lines.join('\n'));
  assert(/TIKET PRODUKSI/.test(tiket) && /KARTU UCAPAN/.test(tiket) && !/Rp/.test(tiket), 'stasiun HP perangkai mencetak tiket otomatis (tanpa harga)');
  assert(/PERANGKAI : NAZRA/.test(tiket), 'tiket mencantumkan perangkai yang ditunjuk (Nazra)');
  console.log(tiket);
  await B.screenshot({ path: path.join(SHOTS, '4-produksi-hp.png') });
  await B.getByRole('button', { name: 'Mulai rangkai' }).click();

  // A melihat status produksi & status job cetak berubah tanpa tombol sinkron
  await A.goto(BASE + '/#/pesanan');
  await A.locator('.trow', { hasText: no1 }).getByText('Dirangkai').waitFor({ timeout: 15000 });
  assert(true, 'status "Dirangkai" dari HP perangkai tampil di tablet kasir (realtime)');
  const jobStatus = await A.evaluate(async () => {
    const req = indexedDB.open('kasir-buket');
    const db = await new Promise((r) => { req.onsuccess = () => r(req.result); });
    const all = await new Promise((r) => { const q = db.transaction('print_jobs').objectStore('print_jobs').getAll(); q.onsuccess = () => r(q.result); });
    return all.map((j) => j.status);
  });
  assert(jobStatus.includes('done'), `status job cetak tersinkron kembali: ${jobStatus.join(',')}`);

  // ---------- Offline lalu sinkron otomatis ----------
  await ctxA.setOffline(true);
  await A.goto(BASE + '/#/kasir').catch(() => {});
  await A.evaluate(() => { location.hash = '#/kasir'; });
  await card('Buket Snack Wisuda').click();
  await A.getByTestId('btn-bayar').click();
  await A.getByTestId('btn-simpan').click();
  const no2 = await A.getByTestId('order-no').textContent();
  await A.getByTestId('btn-baru').click();
  await A.waitForTimeout(1500);
  const badge = await A.getByTestId('sync-badge').textContent();
  assert(/Offline|menunggu/.test(badge), `transaksi offline tersimpan lokal (${badge.trim()})`);
  const t0 = Date.now();
  await ctxA.setOffline(false);
  await B.locator('[data-testid=prod-card]', { hasText: no2.split('-').pop() }).waitFor({ timeout: 40000 });
  assert(true, `setelah online, transaksi ${no2} sampai di HP perangkai otomatis dalam ${((Date.now() - t0) / 1000).toFixed(1)} dtk`);

  // pelunasan
  await A.goto(BASE + '/#/pesanan');
  await A.locator('.trow', { hasText: no1 }).click();
  await A.getByTestId('btn-lunasi').click();
  await A.getByTestId('sisa').filter({ hasText: 'Rp 0' }).waitFor();
  assert(true, 'pelunasan DP: sisa tagihan Rp 0');
  await A.keyboard.press('Escape');

  // laporan
  await A.goto(BASE + '/#/laporan');
  await A.getByTestId('kpis').getByText('Rp 540.000').waitFor({ timeout: 10000 });
  const kpis = await A.getByTestId('kpis').textContent();
  assert(/^Transaksi2\d/.test(kpis.replace(/\s/g, '')), 'laporan: 2 transaksi');
  assert(kpis.includes('Rp 540.000'), 'laporan: penjualan bersih Rp 540.000 (420.000 + 120.000)');
  assert(await A.getByText('✓ cocok').isVisible(), 'rekonsiliasi dibayar + sisa = penjualan bersih');
  await A.screenshot({ path: path.join(SHOTS, '5-laporan.png'), fullPage: true });
  // ---------- ongkir otomatis, pop-up ulasan & survei, poin loyalitas ----------
  await A.goto(BASE + '/#/pengaturan');
  await A.getByRole('radio', { name: 'Toko & cabang' }).click();
  const outletBox = A.locator('.box').filter({ has: A.getByPlaceholder('Link Google Maps toko atau 3.7536, 98.4497') });
  await outletBox.getByPlaceholder('Link Google Maps toko atau 3.7536, 98.4497').fill('3.7536, 98.4497');
  await outletBox.getByRole('button', { name: 'Simpan' }).click();
  await A.getByText('Tersimpan: 3.75360, 98.44970').waitFor();
  await A.getByRole('radio', { name: 'Promo, poin & ongkir' }).click();
  await A.getByLabel('Frekuensi pop-up').fill('1');
  await A.getByPlaceholder('https://g.page/r/…/review').fill('https://g.page/r/buketstabat/review');
  await A.getByTestId('simpan-promo').click();
  await A.getByTestId('ors-key').fill('eyJvcmciOiJ1amkta3VuY2ktb3JzLTEyMzQ1Njc4OTAifQ==');
  await A.getByRole('button', { name: 'Simpan kunci' }).click();
  await A.getByText('kunci …fQ==').waitFor();
  assert(true, 'kunci OpenRouteService tersimpan di server (hanya 4 karakter terakhir ditampilkan)');
  await A.screenshot({ path: path.join(SHOTS, '7-pengaturan-promo.png'), fullPage: true });
  // bank survei: ≥ 15 pertanyaan bawaan, bisa ditambah
  await A.getByRole('radio', { name: 'Survei' }).click();
  await A.getByTestId('survey-row').first().waitFor();
  const nq = await A.getByTestId('survey-row').count();
  assert(nq >= 15, `tab Survei: ${nq} pertanyaan bawaan`);
  await A.getByTestId('tanya-baru').click();
  await A.getByTestId('tanya-teks').fill('Warna buket favorit?');
  await A.getByTestId('tanya-opsi').fill('Pink\nPutih\nMerah');
  await A.getByTestId('simpan-tanya').click();
  await A.waitForFunction((n) => document.querySelectorAll('[data-testid=survey-row]').length === n + 1, nq);
  assert(true, 'pertanyaan survei baru ditambahkan');
  await A.screenshot({ path: path.join(SHOTS, '12-survei.png'), fullPage: true });
  await A.goto(BASE + '/#/kasir');
  await card('Buket Uang 50rb x10').click();
  await A.getByTestId('btn-bayar').click();
  await A.getByTestId('engage').waitFor();
  await A.getByRole('button', { name: 'Diskon Rp 10.000' }).click();
  const qBlocks = A.getByTestId('survey-q');
  await qBlocks.first().waitFor();
  const surveyAns = [];
  for (let i = 0; i < await qBlocks.count(); i++) {
    const blk = qBlocks.nth(i);
    surveyAns.push([await blk.locator('h3').textContent(), await blk.locator('button').first().textContent()]);
    await blk.locator('button').first().click();
  }
  assert(surveyAns.length === 2, `pop-up menampilkan 2 pertanyaan acak: ${surveyAns.map((x) => x.join(' → ')).join('; ')}`);
  await A.screenshot({ path: path.join(SHOTS, '8-popup-ulasan-survei.png') });
  await A.getByTestId('engage-next').click();
  assert(true, 'pop-up ulasan Google Maps (QR) & survei muncul sesuai frekuensi');
  await A.getByTestId('cust-name').fill('Rina');
  await A.getByLabel('Nomor HP/WA').fill('081234567890');
  await A.locator('.loyal').getByText('42 poin').waitFor();
  assert(true, 'poin pelanggan lama tampil di kasir (42 poin dari transaksi pertama)');
  await A.getByRole('radio', { name: 'Diantar' }).click();
  await A.getByTestId('maps-input').fill('3.80, 98.50');
  await A.getByTestId('btn-ongkir').click();
  await A.getByTestId('ongkir-calc').waitFor({ timeout: 20000 });
  const calcText = await A.getByTestId('ongkir-calc').textContent();
  const fee = Number((await A.getByLabel('Ongkir').inputValue()).replace(/\D/g, ''));
  console.log('   ', calcText);
  assert(fee === 23000 && /7,4 km × Rp 3\.000 = Rp 22\.200 → dibulatkan Rp 23\.000/.test(calcText) && /OpenRouteService/.test(calcText), `ongkir rute jalan ORS: 7,38 km → 7,4 km × 3.000 = 22.200 → Rp ${fee.toLocaleString('id-ID')}`);
  const orsCall = routeCalls.find((c) => c.url === '/v2/directions/driving-car');
  assert(orsCall && orsCall.auth === 'eyJvcmciOiJ1amkta3VuY2ktb3JzLTEyMzQ1Njc4OTAifQ==' && JSON.parse(orsCall.body).coordinates[1][0] === 98.5, 'server memanggil OpenRouteService dengan kunci & koordinat [lng, lat]');
  await A.getByLabel('Nama penerima').fill('Dewi');
  await A.getByLabel('Alamat lengkap').fill('Jl. Sudirman 5, Stabat');
  await A.getByRole('button', { name: 'QRIS' }).click();
  const tot = Number((await A.getByTestId('total').textContent()).replace(/\D/g, ''));
  assert(tot === 650000 - 10000 + fee, `total = 650.000 − diskon ulasan 10.000 + ongkir ${fee.toLocaleString('id-ID')} = ${tot.toLocaleString('id-ID')}`);
  await A.screenshot({ path: path.join(SHOTS, '9-checkout-antar.png') });
  await A.getByTestId('btn-simpan').click();
  const prevStruk = await A.getByTestId('preview').textContent();
  assert(/DISKON ULASAN/.test(prevStruk) && /ONGKIR/.test(prevStruk) && /TOTAL BELANJA/.test(prevStruk), 'struk gaya minimarket memuat diskon ulasan, ongkir, total');
  await A.screenshot({ path: path.join(SHOTS, '3b-struk-baru.png') });
  await A.getByTestId('btn-baru').click();
  await A.goto(BASE + '/#/pelanggan');
  await A.locator('.trow', { hasText: 'Rina' }).click();
  await A.getByTestId('poin').filter({ hasText: '106' }).waitFor();
  assert(true, 'profil pelanggan: saldo poin 42 + 64 = 106');
  await A.screenshot({ path: path.join(SHOTS, '10-profil-pelanggan.png') });
  await A.goto(BASE + '/#/pesanan');
  await A.getByTestId('reprint').first().click();
  await A.getByText(/dikirim ke printer/).first().waitFor();
  assert(true, 'cetak ulang struk langsung dari baris pesanan');
  await A.goto(BASE + '/#/laporan');
  await A.getByRole('radio', { name: 'Analisis penjualan' }).click();
  for (const [qText] of surveyAns) await A.getByTestId('analisis').getByText(qText, { exact: false }).first().waitFor();
  assert(true, 'jawaban 2 pertanyaan acak masuk ke analisis penjualan');
  await A.screenshot({ path: path.join(SHOTS, '11-analisis.png'), fullPage: true });

  // impor data Kasir Pintar (format sesuai respons getJsonLaporanModal & laporan_filter_labarugi)
  const y = new Date(Date.now() - 86400000);
  const yStr = `${y.getFullYear()}-${p2(y.getMonth() + 1)}-${p2(y.getDate())}`;
  const kp = {
    products: [
      { id: 901, id_barang: 'B901', kode_barang: 'BWJ', nama_barang: 'Buket Wisuda Jumbo', kategori: 'Wisuda', harga_jual: 350000, harga_beli: 200000, harga_modal: 0, stok: 0, soft_delete: 0, barang_jasa: 'barang' },
      { id: 902, id_barang: 'B902', kode_barang: 'BBM', nama_barang: 'Buket Bunga Mini', kategori: 'Bunga', harga_jual: 75000, harga_beli: 40000, harga_modal: 0, stok: 5, soft_delete: 0, barang_jasa: 'barang' },
    ],
    categories: [{ nama: 'Wisuda' }, { nama: 'Bunga' }],
    customers: [],
    transactions: [
      { jenis: 'pemasukan', kode: 'TRX1', no_struk: 'KP-0001', timestamp: `${yStr} 10:15:00`, total: 425000, grand_total: 425000, bayar: 500000, kembali: 75000, metode_pembayaran: '0', kasir: 'Kasir Lama', hpp: 240000,
        data_transaksi: [{ nama_barang: 'Buket Wisuda Jumbo', kode_barang: 'BWJ', banyak_barang: 1, harga_jual: 350000, harga_beli: 200000, nilai_diskon: 0, catatan: '' }, { nama_barang: 'Buket Bunga Mini', kode_barang: 'BBM', banyak_barang: 1, harga_jual: 75000, harga_beli: 40000, nilai_diskon: 0, catatan: 'pink' }] },
      { jenis: 'pemasukan', kode: 'TRX2', no_struk: 'KP-0002', timestamp: `${yStr} 14:00:00`, total: 75000, grand_total: 75000, bayar: 75000, kembali: 0, metode_pembayaran: '105', kasir: 'Kasir Lama', hpp: 40000,
        data_transaksi: [{ nama_barang: 'Buket Bunga Mini', kode_barang: 'BBM', banyak_barang: 1, harga_jual: 75000, harga_beli: 40000, nilai_diskon: 0, catatan: '' }] },
      { jenis: 'pengeluaran', kode: 'X1', timestamp: `${yStr} 15:00:00`, total: 10000 },
    ],
  };
  const kpFile = path.join(dataDir, 'kasirpintar-ekspor.json');
  fs.writeFileSync(kpFile, JSON.stringify(kp));
  await A.goto(BASE + '/#/pengaturan');
  await A.getByRole('radio', { name: 'Impor Kasir Pintar' }).click();
  await A.locator('input[type=file]').setInputFiles(kpFile);
  await A.getByRole('button', { name: 'Impor sekarang' }).click();
  await A.getByText('Impor selesai').waitFor({ timeout: 10000 });
  await A.goto(BASE + '/#/laporan');
  await A.getByRole('radio', { name: 'Kemarin' }).click();
  await A.getByTestId('kpis').getByText('Rp 500.000').waitFor({ timeout: 10000 });
  const kpk = (await A.getByTestId('kpis').textContent()).replace(/\s/g, '');
  assert(/^Transaksi2\d/.test(kpk) && kpk.includes('Rp220.000'), 'impor Kasir Pintar: 2 transaksi kemarin, penjualan Rp 500.000, laba kotor Rp 220.000');
  await A.getByTestId('sync-badge').filter({ hasText: 'Tersinkron' }).waitFor({ timeout: 10000 });
  await B.getByTestId('sync-badge').filter({ hasText: 'Tersinkron' }).waitFor({ timeout: 10000 });
  assert(true, 'kedua perangkat kembali berstatus "Tersinkron" (antrean 0)');
  // ---------- lupa kata sandi lewat email (SMTP palsu di localhost) ----------
  const net = await import('node:net');
  const mails = [];
  const smtp = net.createServer((sock) => {
    let data = false, buf = '', msg = '', auth = -1;
    const w = (x) => sock.write(x + '\r\n');
    w('220 fake');
    sock.on('data', (d) => {
      buf += d.toString(); let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (line === '.') { data = false; mails.push(msg); w('250 ok'); } else msg += line + '\n'; continue; }
        if (/^EHLO/.test(line)) sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (line === 'AUTH LOGIN') { auth = 0; w('334 u'); }
        else if (auth >= 0 && auth < 2) { auth++; w(auth === 1 ? '334 p' : '235 ok'); }
        else if (/^MAIL|^RCPT/.test(line)) w('250 ok');
        else if (line === 'DATA') { data = true; msg = ''; w('354 go'); }
        else if (line === 'QUIT') { w('221 bye'); sock.end(); }
        else w('500 ?');
      }
    });
  });
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  const ownerToken = await A.evaluate(async () => {
    const req = indexedDB.open('kasir-buket');
    const db = await new Promise((r) => { req.onsuccess = () => r(req.result); });
    return await new Promise((r) => { const q = db.transaction('meta').objectStore('meta').get('token'); q.onsuccess = () => r(q.result.v); });
  });
  const call = (m, p, body) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` }, body: body && JSON.stringify(body) }).then((r) => r.json());
  await call('POST', '/api/email-config', { host: '127.0.0.1', port: smtp.address().port, user: 'tokobuket@gmail.com', pass: 'abcd efgh ijkl mnop', fromName: 'Buket Stabat', from: 'tokobuket@gmail.com' });
  const me = (await call('GET', '/api/users')).users.find((u) => u.username === 'vano');
  await call('PATCH', `/api/users/${me.id}`, { email: 'vano@example.com' });
  const ctxC = await browser.newContext({ ...devices['Pixel 7'] });
  const C = await ctxC.newPage();
  await C.goto(BASE);
  await C.getByTestId('lupa-sandi').click();
  await C.getByLabel('Username atau email').fill('vano');
  await C.getByRole('button', { name: 'Kirim kode' }).click();
  await C.getByLabel('Kode 6 digit').waitFor();
  const body = Buffer.from(mails.at(-1).split('\n\n').slice(1).join('').replace(/\s/g, ''), 'base64').toString();
  const code = body.match(/\b(\d{6})\b/)[1];
  await C.getByLabel('Kode 6 digit').fill(code);
  await C.getByLabel('Kata sandi baru (min. 6)').fill('sandiBaru9');
  await C.getByLabel('Ulangi kata sandi baru').fill('sandiBaru9');
  await C.getByRole('button', { name: 'Ganti kata sandi' }).click();
  await C.getByLabel('Kata sandi', { exact: true }).fill('sandiBaru9');
  await C.getByRole('button', { name: 'Masuk' }).click();
  await C.getByTestId('sync-badge').waitFor({ timeout: 10000 });
  await C.screenshot({ path: path.join(SHOTS, '6-login-setelah-reset.png') });
  await C.getByTestId('user-menu').click();
  await C.getByRole('menuitem', { name: 'Keluar' }).click();
  await C.getByRole('button', { name: 'Masuk' }).waitFor();
  assert(true, 'keluar akun lewat menu nama di kanan atas');
  assert(true, `lupa kata sandi: kode ${code} dikirim via email, sandi diganti, login dengan sandi baru berhasil`);

  // ---------- notifikasi perangkai + undangan Google Calendar ----------
  await A.goto(BASE + '/#/pengaturan');
  await A.getByRole('radio', { name: 'Perangkai', exact: true }).click();
  await A.getByLabel('Email Nazra').fill('nazra@example.com');
  await A.getByTestId('simpan-perangkai').click();
  const mailTo = (to, method) => mails.some((m) => m.includes(`To: <${to}>`) && m.includes(`method=${method}`));
  for (let i = 0; i < 40 && !mailTo('nazra@example.com', 'REQUEST'); i++) await A.waitForTimeout(250);
  assert(mailTo('nazra@example.com', 'REQUEST'), `email Nazra disimpan → undangan kalender pesanan ${no1} terkirim otomatis`);
  const inv = mails.find((m) => m.includes('To: <nazra@example.com>') && m.includes('method=REQUEST'));
  const icsB64 = inv.split('method=REQUEST')[1].split('\n\n')[1].split('--')[0].replace(/\s/g, '');
  const icsTxt = Buffer.from(icsB64, 'base64').toString();
  assert(/BEGIN:VEVENT/.test(icsTxt) && /SUMMARY:Rangkai #KK001/.test(icsTxt) && !/Rp/.test(icsTxt), 'isi undangan: VEVENT "Rangkai #KK001", tanpa harga');
  await A.getByTestId('notif-row').filter({ hasText: 'Terkirim' }).first().waitFor({ timeout: 15000 });
  await A.screenshot({ path: path.join(SHOTS, '13-perangkai-notifikasi.png'), fullPage: true });
  A.once('dialog', (d) => d.accept('Pelanggan membatalkan'));
  await A.goto(BASE + '/#/pesanan');
  await A.getByRole('radio', { name: '30 hari' }).click();
  await A.locator('.trow', { hasText: no1 }).click();
  await A.getByRole('button', { name: 'Batalkan transaksi' }).click();
  for (let i = 0; i < 40 && !mailTo('nazra@example.com', 'CANCEL'); i++) await A.waitForTimeout(250);
  assert(mailTo('nazra@example.com', 'CANCEL'), 'pesanan dibatalkan → undangan dibatalkan (METHOD:CANCEL), acara hilang dari kalender perangkai');
  await A.keyboard.press('Escape');
  smtp.close();
  console.log('\nSEMUA UJI E2E LULUS');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  srv.kill();
  routeSrv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode || 0), 500);
}
