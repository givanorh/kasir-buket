/*
 * Ekspor data milik Anda dari back office Kasir Pintar ke satu berkas JSON,
 * untuk diimpor ke Kasir Buket (Pengaturan › Impor Kasir Pintar).
 *
 * Cara pakai:
 * 1. Buka https://kasirpintar.co.id/account/monitoring di Chrome komputer, pastikan sudah login.
 * 2. Tekan F12 › tab Console. Salin seluruh isi berkas ini, tempel, tekan Enter.
 * 3. Isi tanggal awal saat diminta. Tunggu sampai berkas "kasirpintar-ekspor.json" terunduh.
 *
 * Hanya membaca (GET) dengan sesi login Anda sendiri. Tidak mengubah data di Kasir Pintar.
 * Laporan laba rugi Kasir Pintar dibatasi ±32 hari per permintaan, jadi diambil per 30 hari.
 */
(async () => {
  const BASE = '/account/';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  async function getJson(path, tries = 5) {
    for (let i = 0; i < tries; i++) {
      const r = await fetch(BASE + path, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (r.ok) {
        const text = await r.text();
        try { return JSON.parse(text); } catch { throw new Error(`Respons ${path} bukan JSON`); }
      }
      // server kadang membalas 404/429/5xx bila diminta terlalu cepat: tunggu lalu ulangi
      await sleep(1500 * 2 ** i);
    }
    throw new Error(`Gagal mengambil ${path}`);
  }

  const awal = prompt('Ambil transaksi mulai tanggal (YYYY-MM-DD):', '2025-01-01');
  if (!awal || !/^\d{4}-\d{2}-\d{2}$/.test(awal)) return console.warn('Dibatalkan.');

  console.log('Mengambil produk, kategori, pelanggan…');
  const out = { exported_at: new Date().toISOString(), source: location.origin, products: [], categories: [], customers: [], transactions: [] };
  out.products = (await getJson('getJsonLaporanModal')).data || [];
  out.categories = (await getJson('getJsonKategori')).data || [];
  try { out.customers = (await getJson('getJsonPelanggan')).data || []; } catch (e) { console.warn(e.message); }
  console.log(`Produk ${out.products.length}, kategori ${out.categories.length}, pelanggan ${out.customers.length}`);

  const seen = new Set();
  let from = new Date(awal + 'T00:00:00');
  const today = new Date();
  while (from <= today) {
    const to = new Date(Math.min(today.getTime(), from.getTime() + 29 * 86400000));
    const res = await getJson(`laporan_filter_labarugi/${ymd(from)}/${ymd(to)}/false`);
    let n = 0;
    for (const row of res.data || []) {
      const key = `${row.jenis}|${row.kode || row.no_struk}|${row.timestamp}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.transactions.push(row);
      n++;
    }
    console.log(`${ymd(from)} s.d. ${ymd(to)}: ${n} baris (total ${out.transactions.length})`);
    from = new Date(to.getTime() + 86400000);
    await sleep(1200);
  }

  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kasirpintar-ekspor.json';
  a.click();
  console.log(`Selesai. ${out.transactions.length} baris transaksi diekspor ke kasirpintar-ekspor.json`);
})();
