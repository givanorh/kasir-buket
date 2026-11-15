import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, parseXlsx, parseMoney, parseNum, parseDateCell } from '../src/lib/sheet';
import { mapPurchaseRows } from '../src/lib/purchases';
import { memberNo } from '../src/lib/format';
import { buildReport } from '../src/lib/calc';
import { DEFAULT_EVENTS_2026, dailySales, eventStat, spikeDays, baselineAround } from '../src/lib/events';
import type { Order, Purchase } from '../src/lib/types';

test('nomor member = nomor HP ternormalisasi', () => {
  assert.equal(memberNo('0812-3456-7890'), '081234567890');
  assert.equal(memberNo('+62 812 3456 7890'), '081234567890');
  assert.equal(memberNo('6281234567890'), '081234567890');
  assert.equal(memberNo('81234567890'), '081234567890');
  assert.equal(memberNo('12345'), '');
  assert.equal(memberNo(''), '');
});

test('angka & tanggal gaya Indonesia', () => {
  assert.equal(parseMoney('Rp 25.000'), 25000);
  assert.equal(parseMoney('25,000'), 25000);
  assert.equal(parseMoney('1,5jt'), 1500000);
  assert.equal(parseMoney('150rb'), 150000);
  assert.equal(parseMoney('12500.5'), 12501);
  assert.equal(parseNum('1,5'), 1.5);
  assert.equal(parseNum('2.5'), 2.5);
  assert.equal(parseNum('1.000'), 1000);
  assert.equal(parseNum('1.234.567,89'), 1234567.89);
  assert.equal(parseDateCell('2026-11-16'), '2026-11-16');
  assert.equal(parseDateCell('16/11/2026'), '2026-11-16');
  assert.equal(parseDateCell('16-11-26'), '2026-11-16');
  assert.equal(parseDateCell('16 Nov 2026'), '2026-11-16');
  assert.equal(parseDateCell('16 November 2026'), '2026-11-16');
  assert.equal(parseDateCell('46342'), '2026-11-16', 'nomor seri Excel: 46342 hari sejak 30 Des 1899');
  assert.equal(parseDateCell('31/02/2026'), '', 'tanggal mustahil ditolak');
});

test('CSV titik koma (Excel Indonesia) & tanda kutip', () => {
  const rows = parseCsv('﻿Tanggal;Bahan;Jumlah;Harga satuan;Catatan\r\n16/11/2026;"Mawar; merah";10;"4.000";"kata ""spesial"""\r\n\r\n');
  assert.deepEqual(rows, [['Tanggal', 'Bahan', 'Jumlah', 'Harga satuan', 'Catatan'], ['16/11/2026', 'Mawar; merah', '10', '4.000', 'kata "spesial"']]);
  const p = mapPurchaseRows(rows, '2026-11-01');
  assert.equal(p.rows.length, 1);
  assert.deepEqual([p.rows[0].qty, p.rows[0].price, p.rows[0].total], [10, 4000, 40000]);
});

test('Excel .xlsx: judul di atas tabel, tanggal seri, total kosong dihitung, baris TOTAL & salah dilewati', async () => {
  const buf = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/belanja.xlsx'));
  const rows = await parseXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const p = mapPurchaseRows(rows, '2026-11-16', 'outlet-utama');
  assert.equal(p.rows.length, 4);
  const [mawar, kertas, pita, boneka] = p.rows;
  assert.deepEqual([mawar.date, mawar.item, mawar.qty, mawar.price, mawar.total, mawar.supplier], ['2026-11-14', 'Mawar merah', 50, 4000, 200000, 'Pasar Bunga Medan']);
  assert.equal(kertas.total, 70000);
  assert.deepEqual([pita.date, pita.qty, pita.price, pita.total], ['2026-11-15', 1.5, 12000, 18000], '1,5 × 12.000 = 18.000');
  assert.deepEqual([boneka.qty, boneka.price, boneka.total, boneka.note], [1, 150000, 150000, '& bonus']);
  assert.equal(p.errors.length, 1);
  assert.match(p.errors[0].msg, /tgl-salah/);
  // unggah ulang = ID sama (tidak menggandakan)
  const again = mapPurchaseRows(rows, '2026-11-16', 'outlet-utama');
  assert.deepEqual(again.rows.map((r) => r.id), p.rows.map((r) => r.id));
  assert.equal(new Set(p.rows.map((r) => r.id)).size, 4);
  assert.ok(p.rows.every((r) => /^[A-Za-z0-9_-]{4,64}$/.test(r.id)), 'ID memenuhi aturan server');
});

test('laba rugi: dasar HPP produk / belanja / gabungan', () => {
  const o = { id: 'o1', no: 'A', outlet_id: 'outlet-utama', items: [{ name: 'Buket', qty: 2, price: 150000, cost: 50000, discount: 0 }], subtotal: 300000, item_discount: 0, order_discount: 0, extra_fee: 0, total: 300000, cost_total: 100000, fulfillment: 'sekarang', production_status: 'selesai', created_at: '2026-11-15T05:00:00Z' } as Order;
  const pu: Purchase[] = [
    { id: 'b1', date: '2026-11-15', item: 'Mawar', qty: 50, price: 4000, total: 200000 },
    { id: 'b2', date: '2026-11-15', item: 'Kertas', qty: 1, price: 35000, total: 35000, deleted: true },
    { id: 'b3', date: '2026-11-16', item: 'Pita', qty: 1, price: 12000, total: 12000 },
  ];
  const base = { orders: [o], payments: [], cashMoves: [], from: new Date('2026-11-15T00:00:00'), to: new Date('2026-11-15T23:59:59'), purchases: pu };
  const g = buildReport({ ...base });
  assert.deepEqual([g.hppMethod, g.cogsProduct, g.purchases, g.cogs, g.grossProfit], ['gabungan', 100000, 200000, 300000, 0], '300.000 − (100.000 + 200.000) = 0');
  assert.equal(buildReport({ ...base, hppMethod: 'belanja' }).grossProfit, 100000, '300.000 − 200.000');
  assert.equal(buildReport({ ...base, hppMethod: 'produk' }).grossProfit, 200000, '300.000 − 100.000');
});

test('kalender: event bawaan 2026 valid & analisis lonjakan', () => {
  assert.ok(DEFAULT_EVENTS_2026.length >= 30);
  assert.equal(new Set(DEFAULT_EVENTS_2026.map((e) => e.id)).size, DEFAULT_EVENTS_2026.length);
  for (const e of DEFAULT_EVENTS_2026) {
    assert.match(e.date, /^2026-\d\d-\d\d$/);
    if (e.end) assert.ok(e.end >= e.date, e.name);
    assert.match(e.id, /^[A-Za-z0-9_-]{4,64}$/);
  }
  const fixed = Object.fromEntries(DEFAULT_EVENTS_2026.map((e) => [e.id, e.date]));
  assert.equal(fixed['ev26-imlek'], '2026-02-16');
  assert.equal(fixed['ev26-idulfitri'], '2026-03-20');
  assert.equal(fixed['ev26-iduladha'], '2026-05-27');
  assert.equal(fixed['ev26-waisak'], '2026-05-31');
  assert.equal(fixed['ev26-maulid'], '2026-08-25');
  // data sintetis: 60 hari @ Rp 1 jt, satu hari Rp 9 jt, satu rekap Rp 40 jt (diabaikan)
  const orders: Order[] = [];
  for (let i = 0; i < 60; i++) {
    const d = new Date(2026, 0, 1 + i, 10);
    orders.push({ id: `o${i}`, total: i === 30 ? 9_000_000 : 1_000_000, created_at: d.toISOString() } as Order);
  }
  orders.push({ id: 'rekap', total: 40_000_000, created_at: new Date(2026, 0, 20, 10).toISOString() } as Order);
  const dl = dailySales(orders);
  assert.equal(dl.days.get('2026-01-20')!.sales, 1_000_000, 'transaksi rekap ≥ Rp 10 jt dibuang');
  assert.equal(baselineAround(dl, '2026-01-31'), 1_000_000);
  const sp = spikeDays(dl, 2026);
  assert.deepEqual(sp.map((x) => [x.day, x.ratio]), [['2026-01-31', 9]]);
  const st = eventStat({ date: '2026-01-30', end: '2026-02-01' }, dl);
  assert.deepEqual([st.sales, st.count, st.peak?.day, st.peak?.ratio], [11_000_000, 3, '2026-01-31', 9], '1 + 9 + 1 jt');
});
