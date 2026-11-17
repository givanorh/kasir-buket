import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTiket } from '../src/lib/print/receipts';
import { layout } from '../src/lib/print/escpos';
import type { Order } from '../src/lib/types';

const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

test('impor Kasir Pintar: baris tanpa ID dan tanpa kode tidak lagi menjadi "kp-" (ditolak server)', async () => {
  const { planImport, importId, hashKey } = await import('../src/lib/kasirpintar');
  // sebelum v1.8: safeId('kp-', '') = "kp-" (3 karakter) → server menjawab "ID tidak valid" dan semua baris bertabrakan
  assert.equal(importId('kp-', [34, '', 'bunga'], 'x'), 'kp-34');
  assert.equal(importId('kp-', ['', null, undefined], 'Buket Mawar|150000|Buket'), `kp-h${hashKey('buket mawar|150000|buket')}`);
  assert.match(importId('kp-', ['???', ''], 'Buket Mawar|150000|Buket'), ID_RE);

  const plan = await planImport({
    products: [
      { id_barang: 34, kode_barang: 'bunga', nama_barang: 'buket bunga palsu s', harga_jual: 85000, kategori: 'Buket' },
      { id_barang: '', kode_barang: '', nama_barang: 'Buket Tanpa Kode A', harga_jual: 100000, kategori: 'Buket' },
      { id_barang: null, kode_barang: '', nama_barang: 'Buket Tanpa Kode B', harga_jual: 120000, kategori: 'Buket' },
      { kode_barang: '', nama_barang: 'Buket Tanpa Kode A', harga_jual: 100000, kategori: 'Buket' }, // duplikat persis baris ke-2
      { id_barang: '', kode_barang: '', nama_barang: '' }, // baris kosong
    ],
    customers: [{ nama: 'Rina' }, { nama: 'Sari', no_hp: '' }, {}],
    transactions: [{ jenis: 'pemasukan', kode: '###', timestamp: '2026-11-15 10:00:00', grand_total: 50000, data_transaksi: [] }],
  }, 'outlet-utama', { importStock: false });

  const ids = plan.writes.filter((w) => w.c === 'products').map((w) => w.id);
  assert.equal(ids.length, 4);
  assert.equal(ids[0], 'kp-34', 'ID lama tidak berubah, impor ulang tetap idempoten');
  assert.ok(ids.every((id) => ID_RE.test(id)), `semua ID produk sah: ${ids.join(', ')}`);
  assert.notEqual(ids[1], ids[2], 'dua produk tanpa kode mendapat ID berbeda');
  assert.equal(ids[1], ids[3], 'baris yang persis sama mendapat ID yang sama (tidak menggandakan)');
  assert.equal(plan.skipped, 2, 'baris produk kosong dan pelanggan kosong dilewati');
  assert.ok(plan.writes.every((w) => ID_RE.test(w.id)), 'tidak ada ID yang akan ditolak server');
  const cus = plan.writes.filter((w) => w.c === 'customers').map((w) => w.id);
  assert.equal(new Set(cus).size, 2, 'pelanggan tanpa ID tidak saling menimpa');
  const again = await planImport({ products: [{ kode_barang: '', nama_barang: 'Buket Tanpa Kode A', harga_jual: 100000, kategori: 'Buket' }] }, 'outlet-utama', { importStock: false });
  assert.equal(again.writes.find((w) => w.c === 'products')!.id, ids[1], 'deterministik antarimpor');
});

test('label pengambilan: "Ditunggu" menjadi "Ready" di tiket produksi', () => {
  const order = { id: 'o1', no: '261117-KK001', created_at: '2026-11-17T03:00:00.000Z', items: [{ name: 'Buket Mawar', qty: 1, price: 150000, discount: 0 }], fulfillment: 'sekarang', production_status: 'antri' } as unknown as Order;
  const txt = layout(buildTiket(order, undefined), 58).map((r) => r.text).join('\n');
  assert.match(txt, /^\s*READY\s*$/m);
  assert.doesNotMatch(txt, /DITUNGGU/);
});
