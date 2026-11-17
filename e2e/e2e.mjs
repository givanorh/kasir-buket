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
  assert((await A.getByText('Jenis perangkat ini').count()) === 0 && (await A.getByText('Dipakai untuk').count()) === 0, 'layar penyiapan tanpa pilihan jenis & fungsi perangkat');
  await A.getByRole('button', { name: 'Siapkan toko' }).click();
  await A.getByTestId('sync-badge').waitFor();
  assert(true, 'setup toko & login owner');
  // perangkat dikenali otomatis (komputer + akun owner = KO); owner memberi nama dan mengkategorikannya sebagai Kasir
  await A.goto(BASE + '/#/pengaturan');
  await A.getByTestId('device-row').first().waitFor();
  assert((await A.getByTestId('device-code').textContent()) === 'KO', 'perangkat pertama dikenali otomatis: Komputer + akun owner = kode KO');
  assert((await A.getByText('Perubahan ditolak server').count()) === 0, 'daftar teknis "Perubahan ditolak server" tidak lagi ditampilkan');
  const rowA = A.getByTestId('device-row').first();
  assert(/perangkat ini/.test(await rowA.textContent()) && /Chrome/.test(await rowA.textContent()) && /1× login/.test(await rowA.textContent()), 'daftar perangkat owner: browser, pengguna terakhir, jumlah login');
  await rowA.getByLabel('Nama perangkat KO').fill('Komputer depan');
  await rowA.getByLabel('Fungsi perangkat KO').selectOption('K');
  await rowA.getByTestId('device-save').click();
  await A.getByTestId('device-code').filter({ hasText: /^KK$/ }).waitFor({ timeout: 10000 });
  assert((await A.getByTestId('device-name').textContent()) === 'Komputer depan', 'owner mengganti nama + kategori: kode perangkat ini langsung menjadi KK, nama "Komputer depan"');

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
  // perubahan yang ditolak server (ID tidak sah, mis. "kp-" dari impor lama) tidak boleh tertinggal sebagai data hantu
  const idb = (fn, arg) => A.evaluate(async ([src, a]) => {
    const req = indexedDB.open('kasir-buket');
    const dbx = await new Promise((r) => { req.onsuccess = () => r(req.result); });
    return (0, eval)(`(${src})`)(dbx, a);
  }, [fn.toString(), arg]);
  await idb(async (dbx) => {
    const tx = dbx.transaction(['products', 'outbox'], 'readwrite');
    tx.objectStore('products').put({ id: 'kp-', name: 'Produk hantu', price: 1, active: true });
    tx.objectStore('outbox').add({ c: 'products', id: 'kp-', patch: { name: 'Produk hantu', price: 1, active: true } });
    await new Promise((r) => { tx.oncomplete = r; });
  });
  await A.getByTestId('sync-badge').click();
  let ghost = true;
  for (let i = 0; i < 40 && ghost; i++) {
    await A.waitForTimeout(250);
    ghost = await idb((dbx) => new Promise((r) => { const q = dbx.transaction('products').objectStore('products').get('kp-'); q.onsuccess = () => r(!!q.result); }));
  }
  assert(!ghost && (await A.locator('.trow').count()) === 3, 'perubahan ber-ID tidak sah ditolak server lalu dibuang otomatis dari perangkat (tanpa daftar galat untuk pengguna)');

  // pengguna perangkai
  await A.goto(BASE + '/#/pengaturan');
  await A.getByRole('radio', { name: 'Staff' }).click();
  await A.getByLabel('Nama', { exact: true }).fill('Nazra');
  await A.getByLabel('Username').fill('rangkai1');
  await A.getByLabel('Kata sandi (min. 6)').fill('rangkai1');
  await A.getByRole('group', { name: 'Peran', exact: true }).getByRole('button', { name: 'Admin' }).click();
  await A.getByRole('group', { name: 'Peran', exact: true }).getByRole('button', { name: 'Perangkai' }).click();
  await A.getByRole('button', { name: 'Tambah staff', exact: true }).click();
  await A.getByText('@rangkai1').waitFor();
  await A.getByLabel('Nama', { exact: true }).fill('Tiara');
  await A.getByLabel('Username').fill('tiara');
  await A.getByLabel('Kata sandi (min. 6)').fill('tiara123');
  await A.getByRole('button', { name: 'Tambah staff', exact: true }).click();
  await A.getByText('@tiara').waitFor();
  assert(true, 'akun perangkai & Admin dibuat');
  await A.getByRole('button', { name: 'Lihat sandi Tiara' }).click();
  await A.getByTestId('sandi-terlihat').filter({ hasText: 'tiara123' }).waitFor();
  assert(true, 'owner melihat sandi Tiara (tiara123) lewat tombol Lihat');
  await A.screenshot({ path: path.join(SHOTS, '21-lihat-sandi.png') });
  await A.getByRole('button', { name: 'Sembunyikan sandi Tiara' }).click();
  // tab Staff: pegawai di daftar gaji yang belum punya akun dibuatkan akun (1 pegawai = 1 akun, sandi acak dari server)
  assert(await A.getByRole('radio', { name: 'Staff' }).isChecked(), 'tab Pengguna berganti nama menjadi Staff');
  const calon = await A.getByTestId('calon-akun').allTextContents();
  assert(calon.length === 5 && ['Iin', 'Fira', 'Mirna', 'Putri', 'Ririn'].every((n) => calon.some((t) => t.includes(n))), `pegawai tanpa akun dari daftar gaji: ${calon.map((t) => t.split('·')[0].trim()).join(', ')} (Nazra & Tiara sudah punya)`);
  await A.getByTestId('buat-semua-akun').click();
  await A.getByTestId('pegawai-tanpa-akun').waitFor({ state: 'detached', timeout: 15000 });
  await A.getByTestId('user-row').filter({ hasText: '@ririn' }).waitFor();
  assert((await A.getByTestId('user-row').count()) === 8, 'akun dibuat untuk 5 pegawai: owner + 7 pegawai = 8 akun');
  const iinRow = A.getByTestId('user-row').filter({ hasText: '@iin' });
  assert(await iinRow.getByRole('button', { name: 'Perangkai', pressed: true }).isVisible() && await A.getByTestId('user-row').filter({ hasText: '@putri' }).getByRole('button', { name: 'Admin', pressed: true }).isVisible(), 'peran awal dari daftar gaji: Iin Perangkai, Putri Admin');
  await iinRow.getByRole('button', { name: 'Admin' }).click();
  await iinRow.getByRole('button', { name: 'Admin', pressed: true }).waitFor();
  assert(await iinRow.getByRole('button', { name: 'Perangkai', pressed: true }).isVisible(), 'peran ganda: Iin menjadi Admin + Perangkai');
  await A.getByRole('button', { name: 'Lihat sandi Iin' }).click();
  assert(/^Sandi [A-Za-z0-9]{10}/.test((await A.getByTestId('sandi-terlihat').textContent()).trim()), 'sandi awal acak 10 karakter bisa dibuka owner untuk diberikan ke pegawai');
  await A.getByRole('button', { name: 'Sembunyikan sandi Iin' }).click();
  await A.screenshot({ path: path.join(SHOTS, '29-staff.png'), fullPage: true });

  // shift
  await A.goto(BASE + '/#/shift');
  assert((await A.getByLabel('Kas awal').inputValue()) === '1.000.000', 'kas awal laci kasir terisi modal kembalian bawaan Rp 1.000.000');
  await A.locator('.money input').first().fill('200000');
  await A.getByTestId('btn-buka-shift').click();
  await A.getByTestId('expected').waitFor();
  // dua laci: kas keluar/masuk hanya dari laci meja kamar (kas kecil), laci kasir hanya untuk kembalian
  const exp0 = (await A.getByTestId('expected').textContent()).trim();
  assert(/Rp\s?500\.000/.test(await A.getByTestId('saldo-kas-kecil').textContent()), 'kas kecil laci meja kamar mulai dari jumlah tetap Rp 500.000');
  await A.getByLabel('Kategori kas kecil').selectOption('Uang sampah');
  await A.getByLabel('Nominal kas kecil').fill('20000');
  await A.getByTestId('catat-kas-kecil').click();
  await A.getByTestId('saldo-kas-kecil').filter({ hasText: '480.000' }).waitFor();
  assert((await A.getByTestId('expected').textContent()).trim() === exp0 && (await A.getByText('Kas keluar tunai').count()) === 0, `kas keluar Rp 20.000 (uang sampah): laci meja kamar 500.000 − 20.000 = 480.000; laci kasir tetap ${exp0}`);
  await A.getByLabel('Nominal kas kecil').fill('600000');
  assert(await A.getByTestId('catat-kas-kecil').isDisabled(), 'kas keluar Rp 600.000 melebihi saldo laci meja kamar Rp 480.000: tombol Catat nonaktif');
  await A.getByLabel('Nominal kas kecil').fill('');
  await A.getByTestId('isi-ulang').click();
  await A.getByTestId('saldo-kas-kecil').filter({ hasText: /Rp\s?500\.000/ }).waitFor();
  assert((await A.getByTestId('kas-kecil-row').count()) === 2, 'isi ulang Rp 20.000 dicatat sebagai kas masuk; saldo kembali Rp 500.000');
  await A.getByTestId('kas-kecil').screenshot({ path: path.join(SHOTS, '25-kas-kecil.png') });

  // transaksi 1: pesanan besok, DP, QRIS
  await A.goto(BASE + '/#/kasir');
  const card = (n) => A.getByTestId('product-card').filter({ hasText: n });
  await card('Buket Mawar Merah').click();
  await card('Buket Mawar Merah').click();
  await card('Buket Snack Wisuda').click();
  const snack = card('Buket Snack Wisuda');
  await snack.getByTestId('pstep-plus').click();
  assert((await snack.getByTestId('pstep').textContent()).includes('2'), 'tombol + di kartu produk: Snack menjadi 2');
  await snack.getByTestId('pstep-minus').click();
  await snack.getByTestId('pstep-minus').click();
  assert((await snack.getByTestId('pstep').count()) === 0, 'tombol − di kartu: Snack 0 → hilang dari keranjang');
  await card('Buket Snack Wisuda').click();
  assert((await A.getByTestId('cart-tag').textContent()).includes('Rp 420.000'), 'keranjang 2 × 150.000 + 120.000 = Rp 420.000');
  await A.getByTestId('cart-open').click();
  await A.screenshot({ path: path.join(SHOTS, '1-kasir-tablet.png') });
  await A.getByTestId('btn-bayar').click();
  await A.getByTestId('cust-name').fill('Rina');
  await A.getByLabel('Nomor HP', { exact: true }).fill('081234567890');
  assert((await A.getByTestId('florists').count()) === 0 && (await A.getByTestId('notes').count()) === 0 && await A.getByTestId('ready-info').isVisible(), 'pengambilan Ready: tanpa pilihan perangkai dan catatan perangkai');
  await A.getByRole('radio', { name: 'Ambil nanti' }).click();
  const flBtns = (await A.getByTestId('florists').getByRole('button').allTextContents()).map((t) => t.trim());
  assert(flBtns.join(',') === 'Belum ditunjuk,Fira,Iin,Mirna,Nazra', `pilihan perangkai = akun berperan Perangkai: ${flBtns.slice(1).join(', ')}`);
  await A.getByTestId('due').fill(dueStr);
  await A.getByTestId('card').fill('Happy Graduation, Rina! Bangga sama kamu.');
  await A.getByTestId('notes').fill('Wrapping pink pastel, pita satin putih');
  await A.getByTestId('florists').getByRole('button', { name: 'Nazra' }).click();
  assert(/tidak mendapat poin/.test(await A.getByTestId('non-member').textContent()), 'pelanggan baru bukan member: tidak dapat poin');
  await A.getByTestId('daftar-member').check();
  assert(/nomor member 081234567890/.test(await A.getByTestId('non-member').textContent()), 'daftar member: nomor member = nomor HP');
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
  assert((await B.getByText('Jenis perangkat ini').count()) === 0 && (await B.getByRole('radio').count()) === 0, 'layar masuk hanya username dan kata sandi');
  await B.screenshot({ path: path.join(SHOTS, '24-masuk-tanpa-pilihan.png') });
  await B.getByRole('button', { name: 'Masuk' }).click();
  await B.getByTestId('sync-badge').waitFor();
  await B.goto(BASE + '/#/pengaturan');
  await B.getByTestId('device-code').filter({ hasText: /^HR$/ }).waitFor({ timeout: 10000 });
  assert((await B.getByTestId('device-admin').count()) === 0, 'HP perangkai dikenali otomatis (HP + akun perangkai = HR); daftar perangkat hanya untuk owner');
  // owner melihat perangkat baru di riwayat login, lalu memberinya nama; HP itu menerima namanya tanpa masuk ulang
  await A.goto(BASE + '/#/pengaturan');
  const rowHR = A.getByTestId('device-row').filter({ has: A.locator('.code', { hasText: /^HR$/ }) });
  await rowHR.waitFor({ timeout: 15000 });
  assert(/Android/.test(await rowHR.textContent()) && /Nazra/.test(await rowHR.textContent()), `owner melihat HP baru: ${(await rowHR.locator('.muted').textContent()).replace(/\s+/g, ' ').trim()}`);
  await rowHR.getByLabel('Nama perangkat HR').fill('HP ruang rangkai');
  await rowHR.getByTestId('device-save').click();
  await B.getByTestId('device-name').filter({ hasText: 'HP ruang rangkai' }).waitFor({ timeout: 15000 });
  assert((await B.getByTestId('device-code').textContent()) === 'HR', 'nama dari owner sampai ke HP perangkai lewat sinkron; kode tetap HR');
  await A.getByTestId('login-log-toggle').click();
  const logTxt = await A.getByTestId('login-log').textContent();
  assert(/Nazra/.test(logTxt) && /Vano/.test(logTxt), 'riwayat login mencatat siapa masuk dari perangkat mana');
  await A.getByTestId('device-admin').screenshot({ path: path.join(SHOTS, '23-perangkat-terdaftar.png') });
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
  // akun perangkai: menu hanya Produksi, Riwayat, Pengaturan; Riwayat tanpa nominal uang
  const navB = (await B.locator('nav.side a').allTextContents()).map((t) => t.replace(/\d+$/, '').trim());
  assert(navB.join(',') === 'Produksi,Riwayat,Pengaturan', `menu akun perangkai: ${navB.join(' › ')}`);
  await B.goto(BASE + '/#/riwayat');
  await B.getByTestId('order-row').first().waitFor();
  assert(!/Rp/.test(await B.locator('.table').textContent()) && (await B.getByRole('radio', { name: 'Belum lunas' }).count()) === 0, 'Riwayat perangkai tanpa nominal dan tanpa filter Belum lunas');
  await B.getByTestId('order-row').first().click();
  const tiketRiw = await B.getByTestId('riw-tiket').textContent();
  assert(/TIKET PRODUKSI/.test(tiketRiw) && !/Rp|TOTAL/.test(await B.getByTestId('riwayat-produksi').textContent()), 'detail Riwayat perangkai: tiket produksi + status, tanpa harga');
  await B.keyboard.press('Escape');
  await B.goto(BASE + '/#/produksi');
  await B.getByRole('button', { name: 'Mulai rangkai' }).click();

  // A melihat status produksi & status job cetak berubah tanpa tombol sinkron
  await A.goto(BASE + '/#/pesanan');
  await A.waitForFunction(() => location.hash.startsWith('#/riwayat'));
  const navTxt = (await A.locator('nav.side a').allTextContents()).map((t) => t.replace(/\d+$/, '').trim());
  assert(navTxt.indexOf('Riwayat') === navTxt.indexOf('Produksi') + 1 && !navTxt.includes('Pesanan'), `menu "Pesanan" berganti nama "Riwayat" dan berada di bawah Produksi (${navTxt.join(' › ')}); tautan lama #/pesanan dialihkan`);
  await A.locator('.trow', { hasText: no1 }).getByText('Dirangkai').waitFor({ timeout: 15000 });
  assert(true, 'status "Dirangkai" dari HP perangkai tampil di tablet kasir (realtime)');
  const dueTxt = await A.getByTestId('due-alert').textContent();
  assert(/H-1: \d+ pesanan untuk besok/.test(dueTxt) && dueTxt.includes(no1.split('-').pop()), `peringatan H-1: pesanan besok belum selesai dirangkai (${no1})`);
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
  await A.getByTestId('cust-name').fill('Budi');
  await A.getByRole('radio', { name: 'Ambil nanti' }).click();
  await A.getByTestId('due').fill(dueStr);
  assert(await A.getByTestId('florist-warn').isVisible(), 'checkout tanpa perangkai: peringatan "Perangkai belum ditunjuk"');
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
  // pesanan tanpa perangkai: peringatan di kartu Antri + tombol Tunjuk perangkai (Admin/owner)
  const cardB2 = B.locator('[data-testid=prod-card]', { hasText: no2.split('-').pop() });
  await cardB2.getByTestId('belum-ditunjuk').waitFor();
  assert(await cardB2.getByTestId('act-antri').isDisabled() && (await cardB2.getByTestId('btn-tunjuk').count()) === 0, 'kartu Antri tanpa perangkai: peringatan "Perangkai belum ditunjuk"; perangkai tidak bisa memulai atau menunjuk diri sendiri');
  await A.goto(BASE + '/#/produksi');
  const cardA2 = A.locator('[data-testid=prod-card]', { hasText: no2.split('-').pop() });
  await cardA2.getByTestId('btn-tunjuk').click();
  await A.getByTestId('tunjuk-modal').waitFor();
  await A.screenshot({ path: path.join(SHOTS, '30-tunjuk-perangkai.png') });
  await A.getByTestId('tunjuk-pilihan').getByRole('button', { name: 'Iin', exact: true }).click();
  await cardB2.getByText('Perangkai: Iin').waitFor({ timeout: 15000 });
  assert((await cardB2.getByTestId('belum-ditunjuk').count()) === 0 && await cardB2.getByTestId('act-antri').isDisabled() && (await cardA2.getByTestId('btn-tunjuk').count()) === 0,
    'owner menunjuk Iin lewat tombol Tunjuk perangkai; di HP Nazra tombol Mulai rangkai tetap abu-abu (hanya Iin yang bisa)');

  // peran di papan Produksi: antri/dirangkai dikonfirmasi perangkai, "Sudah diambil" dikonfirmasi kasir
  const cardA = (no) => A.locator('[data-testid=prod-card]', { hasText: no.split('-').pop() });
  const cardB = (no) => B.locator('[data-testid=prod-card]', { hasText: no.split('-').pop() });
  await A.goto(BASE + '/#/produksi');
  await cardA(no1).getByTestId('act-dirangkai').waitFor();
  await cardB(no1).getByTestId('act-dirangkai').click();
  await cardB(no1).getByTestId('act-siap').waitFor({ timeout: 15000 });
  assert(await cardB(no1).getByTestId('act-siap').isDisabled() && (await cardB(no1).getByTestId('btn-bayar-pelunasan').count()) === 0, 'perangkai: status Siap, tombol "Sudah diambil" abu-abu dan tanpa tombol bayar');
  await cardB(no1).scrollIntoViewIfNeeded();
  await B.screenshot({ path: path.join(SHOTS, '21-perangkai-siap-abu.png') });
  // pelunasan: pesanan Siap + DP → tombol "Bayar pelunasan" (bukan "Sudah diambil")
  await cardA(no1).getByTestId('btn-bayar-pelunasan').waitFor({ timeout: 15000 });
  assert((await cardA(no1).getByTestId('act-siap').count()) === 0, 'kasir: pesanan Siap yang masih DP menampilkan "Bayar pelunasan", bukan "Sudah diambil"');
  await cardA(no1).getByTestId('btn-bayar-pelunasan').click();
  await A.getByTestId('pelunasan').waitFor();
  await A.screenshot({ path: path.join(SHOTS, '19-pelunasan.png') });
  const nLog = await A.evaluate(() => window.__KB_PRINTLOG__.length);
  await A.getByTestId('btn-lunasi').click();
  await A.waitForFunction((n) => window.__KB_PRINTLOG__.length > n, nLog, { timeout: 10000 });
  const strukL = await A.evaluate(() => window.__KB_PRINTLOG__[0].lines.join('\n'));
  assert(/\*\* STRUK PELUNASAN \*\*/.test(strukL) && /DP QRIS/.test(strukL) && /PELUNASAN TUNAI/.test(strukL) && /\n\s*LUNAS\s*\n/.test(strukL) && !/SISA TAGIHAN/.test(strukL) && (strukL.match(/TGL \d{2}\.\d{2}\.\d{2}/g) || []).length === 2, 'pelunasan DP mencetak struk pelunasan: DP + pelunasan bertanggal, status LUNAS');
  console.log(strukL);
  await cardA(no1).getByTestId('act-siap').waitFor({ timeout: 10000 });
  assert(!(await cardA(no1).getByTestId('act-siap').isDisabled()), 'setelah lunas, kasir dapat menekan "Sudah diambil"');
  // Riwayat: hanya invoice + status; DP dan pelunasan lengkap dengan nominal & tanggal, tanpa jendela pelunasan
  await A.goto(BASE + '/#/riwayat');
  await A.locator('.trow', { hasText: no1 }).click();
  await A.getByTestId('riwayat-detail').waitFor();
  const riwDp = await A.getByTestId('riw-dp').textContent();
  const riwPl = await A.getByTestId('riw-pelunasan').textContent();
  const riwInv = await A.getByTestId('riw-invoice').textContent();
  assert(/DP · QRIS/.test(riwDp) && /Rp/.test(riwDp) && /\d{2}:\d{2}/.test(riwDp) && /Pelunasan · Tunai/.test(riwPl) && /\d{2}:\d{2}/.test(riwPl) && /Lunas/.test(await A.getByTestId('riw-sisa').textContent()), `riwayat: nominal + tanggal DP (${riwDp.trim()}) dan pelunasan (${riwPl.trim()})`);
  assert(/LUNAS/.test(riwInv) && /PELUNASAN TUNAI/.test(riwInv) && (await A.getByTestId('btn-lunasi').count()) === 0 && (await A.getByTestId('btn-batal').count()) === 0 && (await A.getByTestId('status-chips').count()) === 0, 'riwayat hanya catatan: invoice tampil, tanpa form pelunasan, ubah status, atau pembatalan');
  await A.screenshot({ path: path.join(SHOTS, '20-riwayat-detail.png') });
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
  // diskon ulasan: 3 kolom bawaan, tambah kolom persen, budget bulanan
  assert((await A.getByTestId('tier-row').count()) === 3, 'diskon ulasan: 3 kolom bawaan (Rp 5.000 / 7.500 / 10.000)');
  assert(/Rp\s?250\.000/.test(await A.getByTestId('review-card').textContent()) || (await A.getByLabel('Budget diskon ulasan per bulan').inputValue()).replace(/\D/g, '') === '250000', 'budget bawaan Rp 250.000/bulan');
  await A.getByTestId('tambah-kolom-diskon').click();
  const newTier = A.getByTestId('tier-row').nth(3);
  await newTier.getByLabel('Nama kolom diskon').fill('Ulasan + video');
  await newTier.getByRole('radio', { name: '%' }).click();
  await newTier.getByLabel('Persen Ulasan + video').fill('15');
  await newTier.getByLabel('Maksimal Ulasan + video').fill('25000');
  await A.getByLabel('Budget diskon ulasan per bulan').fill('20000');
  assert((await A.getByTestId('tier-row').count()) === 4, 'kolom diskon ke-4 ditambahkan: 15% maks Rp 25.000');
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
  const rb = await A.getByTestId('review-budget').textContent();
  assert(/Rp\s?20\.000/.test(rb) && /0 transaksi/.test(rb), `pop-up menampilkan sisa budget bulan ini: ${rb.replace(/\s+/g, ' ')}`);
  const video = A.locator('.tiers button', { hasText: 'Ulasan + video' });
  assert(/Rp\s?25\.000/.test(await video.textContent()) && await video.isDisabled(), 'kolom 15% × 650.000 = 97.500 → maks 25.000 melebihi sisa budget 20.000: dinonaktifkan');
  await A.getByTestId('tier-rt-foto').click();
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
  await A.getByLabel('Nomor HP', { exact: true }).fill('0812 3456 7890');
  await A.getByTestId('cust-found').getByText('Rina').waitFor();
  assert(await A.getByTestId('cust-name').inputValue() === 'Rina', 'nomor HP member diisi → nama terisi otomatis dari data member');
  await A.getByTestId('member').getByText('42 poin').waitFor();
  assert(true, 'member dikenali dari nomor HP: 42 poin dari transaksi pertama (⌊420.000 ÷ 10.000⌋)');
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
  await A.goto(BASE + '/#/pengaturan');
  await A.getByRole('radio', { name: 'Promo, poin & ongkir' }).click();
  await A.getByTestId('review-usage').filter({ hasText: 'Rp 10.000' }).waitFor();
  assert(/1 transaksi · sisa Rp\s?10\.000/.test(await A.getByTestId('review-usage').textContent()), 'pemakaian budget bulan ini: Rp 10.000 (1 transaksi), sisa Rp 10.000');
  await A.getByTestId('review-card').screenshot({ path: path.join(SHOTS, '18-diskon-ulasan.png') });
  await A.screenshot({ path: path.join(SHOTS, '10-profil-pelanggan.png') });
  await A.goto(BASE + '/#/riwayat');
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

  // ---------- kalender event & belanja bahan (owner) ----------
  await A.goto(BASE + '/#/kalender');
  await A.getByTestId('event-row').first().waitFor({ timeout: 15000 });
  await A.getByRole('radio', { name: '2026' }).click();
  const nev = await A.getByTestId('event-row').count();
  const rowOf = (t) => A.locator('[data-testid=event-row] .ev-main > div > b').filter({ hasText: t }).count();
  assert(nev >= 30 && await rowOf('Valentine') === 1 && await rowOf('Hari Guru Nasional') === 1, `kalender 2026 terisi otomatis: ${nev} event`);
  const kf = await A.getByTestId('filter-kategori').textContent();
  assert(/Libur Nasional/.test(kf) && /Lokal/.test(kf) && /Puncak Penjualan/.test(kf) && !/Musim|Momen buket/.test(kf) && await rowOf('Ramadan') === 0, 'kategori: Libur Nasional, Lokal, Puncak Penjualan (Momen buket diganti, Musim & Ramadan dihapus)');
  await A.getByTestId('filter-kategori').getByRole('button', { name: /Puncak Penjualan/ }).click();
  const nMomen = Number((await A.getByTestId('filter-kategori').getByRole('button', { name: /Puncak Penjualan/ }).locator('em').textContent()).trim());
  await A.getByRole('radio', { name: 'Total omzet' }).click();
  await A.getByTestId('urut-omzet').waitFor();
  assert((await A.getByTestId('rank-row').count()) === nMomen && nMomen > 5, `filter Puncak Penjualan + urut total omzet: ${nMomen} event berperingkat`);
  await A.screenshot({ path: path.join(SHOTS, '22-kalender-urut-omzet.png'), fullPage: true });
  const rankNos = async () => (await A.locator('[data-testid=rank-row] .rank-no').allTextContents()).map(Number);
  const desc = await rankNos();
  await A.getByRole('radio', { name: /Terkecil dulu/ }).click();
  const asc = await rankNos();
  assert(desc[0] === 1 && asc[0] === nMomen && asc.join() === [...desc].reverse().join(), `omzet: terbesar dulu (peringkat ${desc[0]} di atas) ↔ terkecil dulu (peringkat ${asc[0]} di atas)`);
  await A.getByRole('radio', { name: 'Tanggal' }).click();
  await A.getByTestId('filter-kategori').getByRole('button', { name: /Semua/ }).click();
  const monthOrder = async () => (await A.locator('.card.month h3').allTextContents()).map((t) => t.trim());
  const naik = await monthOrder();
  await A.getByRole('radio', { name: /Des → Jan/ }).click();
  const turun = await monthOrder();
  const dates = await A.locator('[data-testid=event-row] .ev-date').allTextContents();
  assert(naik[0].startsWith('Januari') && turun[0].startsWith('Desember') && turun.join() === [...naik].reverse().join(), `tanggal: Jan → Des (${naik[0]} di atas) ↔ Des → Jan (${turun[0]} di atas, ${dates[0].trim()} pertama)`);
  await A.getByRole('radio', { name: /Jan → Des/ }).click();
  const agu = A.getByTestId('event-row').filter({ hasText: 'Puncak awal Agustus' });
  await agu.getByTestId('jadikan-rutin').click();
  assert((await A.getByTestId('event-nama').inputValue()) === 'National Girlfriend Day (1 Agu)' && await A.getByTestId('event-rutin').isChecked(), 'lonjakan 1 Agustus diusulkan menjadi event rutin "National Girlfriend Day (1 Agu)"');
  await A.getByTestId('simpan-event').click();
  await A.getByTestId('event-row').filter({ hasText: 'National Girlfriend Day' }).locator('.rutin').waitFor();
  const okt = A.getByTestId('event-row').filter({ hasText: 'Lonjakan awal Oktober' });
  await okt.getByTestId('jadikan-rutin').click();
  assert((await A.getByTestId('event-nama').inputValue()) === 'National Boyfriend Day (3 Okt)', 'lonjakan 1–3 Oktober diusulkan menjadi "National Boyfriend Day (3 Okt)"');
  await A.getByTestId('simpan-event').click();
  await A.getByRole('radio', { name: '2027' }).click();
  await A.getByTestId('event-row').filter({ hasText: 'National Girlfriend Day' }).waitFor();
  assert(/Sab, 31 Jul – Sen, 2 Agu/.test(await A.getByTestId('event-row').filter({ hasText: 'National Girlfriend Day' }).textContent()), 'event rutin muncul otomatis di 2027 (31 Jul–2 Agu 2027)');
  await A.getByRole('radio', { name: '2026' }).click();
  await A.screenshot({ path: path.join(SHOTS, '14-kalender.png'), fullPage: true });
  await A.goto(BASE + '/#/laporan');
  assert(await A.locator('nav.side a[href="#/belanja"]').count() === 0, 'menu Belanja bahan tidak lagi di navigasi');
  await A.getByRole('radio', { name: 'Perhitungan HPP' }).click();
  await A.getByRole('radio', { name: 'Belanja bahan' }).click();
  await A.getByTestId('belanja').getByRole('radio', { name: 'Semua' }).click();
  await A.getByTestId('unggah').click();
  await A.getByTestId('berkas-belanja').setInputFiles(path.join(ROOT, 'app/test/fixtures/belanja.xlsx'));
  await A.getByTestId('baris-siap').filter({ hasText: '4' }).waitFor();
  await A.getByTestId('impor-belanja').click();
  await A.getByTestId('total-belanja').filter({ hasText: 'Rp 438.000' }).waitFor();
  assert(true, 'unggah Excel belanja: 4 baris, 200.000 + 70.000 + 18.000 + 150.000 = Rp 438.000');
  await A.getByTestId('belanja-baru').click();
  await A.getByTestId('bahan').fill('Plastik mika');
  await A.getByLabel('Jumlah', { exact: true }).fill('2');
  await A.getByLabel('Harga satuan').fill('6000');
  await A.getByTestId('simpan-belanja').click();
  await A.getByTestId('total-belanja').filter({ hasText: 'Rp 450.000' }).waitFor();
  assert(true, 'belanja manual 2 × 6.000 = 12.000 → total Rp 450.000');
  await A.screenshot({ path: path.join(SHOTS, '15-belanja.png'), fullPage: true });
  await A.getByRole('radio', { name: 'Laba rugi' }).click();
  await A.getByRole('radio', { name: 'Pilih' }).click();
  await A.locator('input[type=date]').first().fill('2026-11-14');
  await A.locator('input[type=date]').nth(1).fill('2026-11-15');
  await A.getByTestId('hpp-belanja').filter({ hasText: 'Rp 438.000' }).waitFor();
  assert(true, 'laba rugi: belanja bahan 14–15 Nov Rp 438.000 masuk HPP (dasar gabungan)');
  // gaji & biaya: dialokasikan ke laba rugi (Okt 2026 = satu bulan penuh)
  await A.locator('input[type=date]').first().fill('2026-10-01');
  await A.locator('input[type=date]').nth(1).fill('2026-10-31');
  await A.getByTestId('beban-gaji').filter({ hasText: 'Rp 8.700.000' }).waitFor({ timeout: 10000 });
  assert((await A.getByTestId('beban-thr').textContent()).includes('Rp 725.000'), 'laba rugi Okt 2026: gaji 7 pegawai Rp 8.700.000, THR 8.700.000 ÷ 12 = Rp 725.000');
  await A.getByRole('radio', { name: 'Perhitungan HPP' }).click();
  await A.getByRole('radio', { name: 'Gaji & biaya' }).click();
  await A.getByTestId('pegawai-row').first().waitFor();
  assert((await A.getByTestId('pegawai-row').count()) === 7 && (await A.getByTestId('jumlah-gaji').textContent()).includes('Rp 8.700.000'), 'Perhitungan HPP › Gaji & biaya: 7 pegawai, jumlah Rp 8.700.000');
  await A.getByLabel('Nilai Listrik').fill('500000');
  await A.getByTestId('simpan-biaya').click();
  await A.getByText('Semua tersimpan').waitFor();
  await A.screenshot({ path: path.join(SHOTS, '19-gaji-biaya.png'), fullPage: true });
  await A.getByRole('radio', { name: 'Ringkasan HPP' }).click();
  await A.getByTestId('biaya-tetap').filter({ hasText: 'Rp 9.925.000' }).waitFor();
  await A.screenshot({ path: path.join(SHOTS, '20-ringkasan-hpp.png'), fullPage: true });
  await A.getByRole('radio', { name: 'Laba rugi' }).click();
  await A.getByTestId('beban-ops').filter({ hasText: 'Rp 500.000' }).waitFor();
  assert(true, 'listrik Rp 500.000/bulan masuk beban operasional; biaya tetap 8.700.000 + 725.000 + 500.000 = Rp 9.925.000');
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

  // ---------- pembatalan pesanan lunas lewat persetujuan owner ----------
  const ctxD = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const D = await ctxD.newPage();
  await D.goto(BASE);
  await D.getByLabel('Username').fill('tiara');
  await D.getByLabel('Kata sandi').fill('tiara123');
  await D.getByRole('button', { name: 'Masuk' }).click();
  await D.getByTestId('sync-badge').filter({ hasText: 'Tersinkron' }).waitFor({ timeout: 15000 });
  await D.getByTestId('shift-gate').waitFor();
  assert(await D.getByTestId('gate-buka-shift').isVisible(), 'Admin tanpa shift: halaman Kasir terkunci sampai shift dibuka');
  await D.screenshot({ path: path.join(SHOTS, '17-gerbang-shift.png') });
  // Admin membuka shift, lalu melayani pelanggan bukan member (nomor HP belum tersimpan)
  await D.getByLabel('Kas awal').fill('100000');
  await D.getByTestId('gate-buka-shift').click();
  await D.getByTestId('product-card').filter({ hasText: 'Buket Snack' }).locator('.pcard').click();
  await D.getByTestId('btn-bayar').click();
  await D.getByTestId('engage').waitFor();
  await D.getByTestId('review-budget').filter({ hasText: /1 transaksi/ }).waitFor({ timeout: 15000 }).catch(() => {}); // angka pemakaian dihitung async
  const rbD = await D.getByTestId('review-budget').textContent();
  assert(/Rp\s?10\.000/.test(rbD) && /1 transaksi/.test(rbD), `budget tersinkron antarperangkat: perangkat Admin melihat sisa Rp 10.000 (${rbD.replace(/\s+/g, ' ').trim()})`);
  await D.getByRole('button', { name: 'Lewati' }).click();
  await D.getByLabel('Nomor HP', { exact: true }).fill('0813 9999 0000');
  assert(await D.getByTestId('cust-found').count() === 0 && /tetap bisa dilanjutkan/.test(await D.locator('.field', { has: D.getByLabel('Nomor HP', { exact: true }) }).textContent()), 'nomor HP belum tersimpan: transaksi tetap bisa dilanjutkan');
  assert(/tidak mendapat poin/.test(await D.getByTestId('non-member').textContent()), 'bukan member: tidak dapat poin');
  await D.getByRole('button', { name: 'Uang pas' }).click();
  await D.getByTestId('btn-simpan').click();
  const noNm = await D.getByTestId('order-no').textContent();
  assert(/tidak dicetak \(Ready/.test(await D.getByTestId('print-produksi').textContent()), 'transaksi Ready: hanya struk pelanggan, tiket produksi tidak dicetak');
  await D.getByTestId('btn-baru').click();
  const nm = await D.evaluate(async (no) => {
    const req = indexedDB.open('kasir-buket');
    const dbx = await new Promise((r) => { req.onsuccess = () => r(req.result); });
    const all = await new Promise((r) => { const q = dbx.transaction('orders').objectStore('orders').getAll(); q.onsuccess = () => r(q.result); });
    const o = all.find((x) => x.no === no);
    return { earned: o.points_earned, phone: o.customer_phone, st: o.production_status, florist: o.florist };
  }, noNm);
  assert(nm.earned === 0 && nm.phone === '081399990000', `pelanggan bukan member bertransaksi (${noNm}): poin 0, HP 081399990000 tercatat`);
  assert(nm.st === 'selesai' && !nm.florist, `transaksi Ready lunas (${noNm}): langsung Selesai, tanpa perangkai, tidak masuk antrean produksi`);
  await D.goto(BASE + '/#/produksi');
  const cardD = D.locator('[data-testid=prod-card]', { hasText: no2.split('-').pop() });
  await cardD.getByTestId('act-antri').waitFor({ timeout: 15000 });
  assert(await cardD.getByTestId('act-antri').isDisabled(), 'akun kasir (Admin): tombol "Mulai rangkai" abu-abu');
  await D.screenshot({ path: path.join(SHOTS, '22-kasir-antri-abu.png') });
  await cardD.locator('.bc-top').click();
  const chipsD = D.getByTestId('status-chips');
  assert(await chipsD.getByRole('button', { name: 'Dirangkai' }).isDisabled() && await chipsD.getByRole('button', { name: 'Siap' }).isDisabled(), 'akun kasir: status Dirangkai/Siap di detail juga terkunci');
  assert((await D.getByTestId('btn-batal').count()) === 0, `Admin tidak bisa langsung membatalkan pesanan lunas ${no2}`);
  await D.getByTestId('btn-ajukan-batal').click();
  await D.getByTestId('alasan-batal').fill('Pelanggan salah pilih produk');
  await D.getByTestId('kirim-batal').click();
  await D.getByTestId('cancel-pending').waitFor();
  assert(true, 'Admin mengajukan pembatalan beserta alasan');
  await A.goto(BASE + '/#/produksi');
  await A.getByTestId('cancel-requests').getByText('Pelanggan salah pilih produk').waitFor({ timeout: 15000 });
  await A.screenshot({ path: path.join(SHOTS, '16-persetujuan-batal.png') });
  await A.getByTestId('cancel-requests').getByTestId('setujui-batal').click();
  await D.getByTestId('cancel-pending').waitFor({ state: 'detached', timeout: 15000 });
  await D.getByText(/Dibatalkan: Pelanggan salah pilih produk \(diajukan Tiara, disetujui Vano\)/).waitFor({ timeout: 15000 });
  assert(true, 'owner menyetujui → pesanan batal, alasan & nama penyetuju tercatat, tampil di perangkat Admin');

  // ---------- reset sandi mandiri Admin (email pribadi + No HP + tanggal lahir) ----------
  await A.goto(BASE + '/#/pengaturan');
  await A.getByRole('radio', { name: 'Staff' }).click();
  await A.getByRole('button', { name: 'Data pribadi Tiara' }).click();
  const dlg = A.getByRole('dialog', { name: 'Data pribadi Tiara' });
  await dlg.getByLabel('Email pribadi').fill('tiara@example.com');
  await dlg.getByLabel('No HP').fill('0812 7777 8888');
  await dlg.getByLabel('Tanggal lahir').fill('2002-05-14');
  await dlg.getByTestId('simpan-data-pribadi').click();
  await A.getByTestId('user-row').filter({ hasText: '@tiara' }).filter({ hasText: 'HP 081277778888' }).waitFor();
  assert(true, 'owner mencatat email pribadi, No HP (dinormalkan 081277778888), dan tanggal lahir Tiara');
  await A.goto(BASE + '/#/produksi');
  await D.goto(BASE + '/#/pengaturan');
  await D.getByRole('radio', { name: 'Reset Password' }).click();
  const rs = D.getByTestId('reset-mandiri');
  await rs.getByLabel('Email pribadi').fill('tiara@example.com');
  await rs.getByLabel('No HP').fill('+62 812-7777-8888');
  await rs.getByLabel('Tanggal lahir').fill('2002-05-15');
  const nMail = mails.length;
  await rs.getByTestId('kirim-reset-mandiri').click();
  await D.getByText(/Data tidak cocok/).waitFor();
  assert(mails.length === nMail, 'tanggal lahir salah: ditolak, tidak ada email terkirim');
  await rs.getByLabel('Tanggal lahir').fill('2002-05-14');
  await rs.getByTestId('kirim-reset-mandiri').click();
  await D.getByTestId('reset-terkirim').waitFor();
  const mailT = mails.at(-1);
  const pwT = Buffer.from(mailT.split('\n\n').slice(1).join('').replace(/\s/g, ''), 'base64').toString().match(/\n {4}([A-Za-z0-9]{10})\n/)[1];
  assert(mails.length === nMail + 1 && mailT.includes('To: <tiara@example.com>'), `data cocok: sandi baru 10 karakter dikirim ke email pribadi Tiara (${(await D.getByTestId('reset-terkirim').textContent()).trim()})`);
  await D.getByTestId('reset-mandiri').screenshot({ path: path.join(SHOTS, '26-reset-mandiri.png') });

  // ---------- keluar saat shift terbuka: pengingat, lalu tutup shift dengan konfirmasi ----------
  await D.getByTestId('user-menu').click();
  await D.getByRole('menuitem', { name: 'Keluar' }).click();
  await D.getByTestId('pengingat-shift').waitFor();
  assert(await D.getByTestId('keluar-tanpa-tutup').isVisible(), 'Admin keluar saat shift masih terbuka: muncul pengingat, pilihan "Tutup shift dulu" atau "Tetap keluar"');
  await D.screenshot({ path: path.join(SHOTS, '27-pengingat-shift.png') });
  await D.getByTestId('ke-tutup-shift').click();
  await D.getByTestId('btn-tutup-shift').waitFor();
  const expD = (await D.getByTestId('expected').textContent()).replace(/\D/g, '');
  await D.getByLabel('Kas aktual').fill(expD);
  await D.getByTestId('btn-tutup-shift').click();
  await D.getByTestId('ringkasan-tutup-shift').waitFor();
  await D.getByRole('button', { name: 'Batal' }).click();
  assert(await D.getByTestId('shift-aktif').isVisible(), 'tombol Tutup shift tidak langsung menutup: konfirmasi dibatalkan, shift tetap aktif');
  await D.getByTestId('btn-tutup-shift').click();
  assert(/Selisih\s*Rp\s?0/.test(await D.getByTestId('ringkasan-tutup-shift').textContent()), 'konfirmasi menampilkan kas seharusnya, kas aktual, selisih Rp 0');
  await D.screenshot({ path: path.join(SHOTS, '28-konfirmasi-tutup-shift.png') });
  await D.getByTestId('konfirmasi-tutup-shift').click();
  await D.getByTestId('btn-buka-shift').waitFor();
  assert(true, 'shift ditutup setelah konfirmasi');
  await D.getByTestId('user-menu').click();
  await D.getByRole('menuitem', { name: 'Keluar' }).click();
  await D.getByRole('button', { name: 'Masuk' }).waitFor();
  await D.getByLabel('Username').fill('tiara');
  await D.getByLabel('Kata sandi').fill(pwT);
  await D.getByRole('button', { name: 'Masuk' }).click();
  await D.getByTestId('sync-badge').waitFor({ timeout: 10000 });
  assert(true, 'tanpa shift terbuka, keluar langsung; masuk lagi dengan sandi baru dari email berhasil');
  await ctxD.close();

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
  await A.goto(BASE + '/#/produksi');
  await cardA(no1).locator('.bc-top').click();
  await A.getByTestId('btn-batal').click();
  await A.getByRole('button', { name: 'Pelanggan membatalkan' }).click();
  await A.getByTestId('kirim-batal').click();
  for (let i = 0; i < 40 && !mailTo('nazra@example.com', 'CANCEL'); i++) await A.waitForTimeout(250);
  assert(mailTo('nazra@example.com', 'CANCEL'), 'pesanan dibatalkan → undangan dibatalkan (METHOD:CANCEL), acara hilang dari kalender perangkai');
  await A.keyboard.press('Escape');

  // ---------- kalender event toko → Google Calendar owner + email tambahan ----------
  await A.goto(BASE + '/#/kalender');
  await A.getByTestId('gcal-buka').click();
  await A.getByTestId('gcal').waitFor();
  await A.getByTestId('gcal-aktif').check();
  await A.getByTestId('gcal-email').first().fill('istri.owner@example.com');
  await A.screenshot({ path: path.join(SHOTS, '23-google-calendar.png') });
  await A.getByTestId('gcal-simpan').click();
  for (let i = 0; i < 80 && !mailTo('istri.owner@example.com', 'REQUEST'); i++) await A.waitForTimeout(250);
  const evMails = mails.filter((m) => m.includes('To: <istri.owner@example.com>') && m.includes('method=REQUEST'));
  assert(evMails.length > 0 && evMails.every((m) => m.includes('filename="kalender-toko.ics"')), `kalender event dikirim ke email tambahan sebagai acara Google Calendar (${evMails.length} event)`);
  const icsOf = (m) => Buffer.from(m.split('method=REQUEST')[1].split('\n\n')[1].split('--')[0].replace(/\s/g, ''), 'base64').toString();
  for (let i = 0; i < 40 && !evMails.some((m) => /RRULE:FREQ=YEARLY/.test(icsOf(m))); i++) { await A.waitForTimeout(250); evMails.splice(0, evMails.length, ...mails.filter((m) => m.includes('To: <istri.owner@example.com>') && m.includes('method=REQUEST'))); }
  const evIcs = icsOf(evMails[0]);
  assert(/DTSTART;VALUE=DATE:\d{8}/.test(evIcs) && /TRIGGER:-P6DT16H/.test(evIcs) && /TRIGGER:-P2DT16H/.test(evIcs), 'acara sepanjang hari dengan alarm H-7 dan H-3 pukul 08.00');
  assert(evMails.some((m) => /RRULE:FREQ=YEARLY/.test(icsOf(m)) && /National Girlfriend Day/.test(icsOf(m))), 'event rutin (National Girlfriend Day) memakai RRULE tahunan');
  await A.getByTestId('gcal-buka').filter({ hasText: 'aktif' }).waitFor();
  assert(true, 'tombol Google Calendar menampilkan status aktif');
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
