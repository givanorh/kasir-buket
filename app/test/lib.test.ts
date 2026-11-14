import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, layout, leftRight, toAscii, wrap } from '../src/lib/print/escpos';
import { buildStruk, buildTiket } from '../src/lib/print/receipts';
import { buildReport, cartTotals, shiftSummary, scheduledQtyOn } from '../src/lib/calc';
import { dayKey, parseRp } from '../src/lib/format';
import type { Order, Payment } from '../src/lib/types';

const order = (o: Partial<Order> = {}): Order => ({
  id: 'o1', no: '251115-A001', outlet_id: 'outlet-utama', items: [
    { product_id: 'p1', name: 'Buket Mawar Merah 20 Tangkai Premium', qty: 2, price: 150000, cost: 90000, discount: 10000, type: 'buket' },
    { product_id: 'p2', name: 'Kartu ucapan', qty: 1, price: 5000, cost: 1000, discount: 0, type: 'addon' },
  ],
  subtotal: 305000, item_discount: 10000, order_discount: 5000, extra_fee: 20000, total: 310000, cost_total: 181000,
  fulfillment: 'antar', due_at: '2026-11-16T09:00:00.000Z', production_status: 'antri', created_at: '2026-11-15T03:00:00.000Z',
  customer_name: 'Rina', customer_phone: '0812', card_message: 'Selamat wisuda, Sayang! 🎓', notes: 'dominan pink', cashier_name: 'Vano',
  recipient_name: 'Dewi', delivery_address: 'Jl. Proklamasi 1, Stabat', ...o,
});

test('format: parseRp menerima 150rb, 1,5jt, 150.000', () => {
  assert.equal(parseRp('150rb'), 150000);
  assert.equal(parseRp('150.000'), 150000);
  assert.equal(parseRp('2jt'), 2000000);
});

test('escpos: wrap & dua kolom tidak melebihi lebar kertas', () => {
  for (const l of wrap('Buket Mawar Merah 20 Tangkai Premium dengan pita satin', 32)) assert.ok(l.length <= 32);
  const lr = leftRight('2 x 150.000', '300.000', 32);
  assert.equal(lr[0].length, 32);
  assert.ok(lr[0].endsWith('300.000'));
  assert.equal(toAscii('Café “ok” — 🎓'), 'Cafe "ok" - ');
});

test('escpos: byte perintah benar (init, ukuran ganda, potong)', () => {
  const b = encode([{ t: 'text', text: 'HALO', size: 2 }, { t: 'cut' }], 58);
  assert.deepEqual([...b.slice(0, 2)], [0x1b, 0x40]);
  const hex = Buffer.from(b).toString('hex');
  assert.ok(hex.includes('1d2111'), 'GS ! 0x11');
  assert.ok(hex.includes('1d564200'), 'GS V 66 0');
  assert.ok(hex.includes(Buffer.from('HALO').toString('hex')));
});

test('struk: total, DP, sisa tagihan; tiket: tanpa harga, ada kartu ucapan', () => {
  const pays: Payment[] = [{ id: 'p', order_id: 'o1', outlet_id: 'x', method: 'QRIS', amount: 155000, kind: 'dp', created_at: '2026-11-15T03:00:00Z' }];
  const s = layout(buildStruk(order(), pays, { id: 'toko', store_name: 'Buket Stabat', payment_methods: [], expense_categories: [] }), 58).map((r) => r.text).join('\n');
  assert.match(s, /TOTAL/);
  assert.match(s, /SISA TAGIHAN\s+Rp 155\.000/);
  assert.match(s, /DP \(QRIS\)\s+155\.000/);
  for (const r of layout(buildStruk(order(), pays, undefined), 58)) assert.ok(r.text.length <= (r.size === 2 ? 16 : 32));
  const t = layout(buildTiket(order(), undefined), 80).map((r) => r.text).join('\n');
  assert.doesNotMatch(t, /150\.000|Rp/);
  assert.match(t, /KARTU UCAPAN/);
  assert.match(t, /Selamat wisuda, Sayang!/);
  assert.match(t, /#A001/);
  assert.match(t, /2x Buket Mawar/);
});

test('cartTotals: total = subtotal − potongan − diskon + ongkir', () => {
  const t = cartTotals(order().items, 5000, 20000);
  assert.deepEqual([t.subtotal, t.item_discount, t.order_discount, t.extra_fee, t.total, t.cost_total], [305000, 10000, 5000, 20000, 310000, 181000]);
  assert.equal(cartTotals(order().items, 999999).total, 0, 'diskon tidak boleh membuat total negatif');
});

test('laporan: laba & rekonsiliasi dibayar + sisa = penjualan bersih', () => {
  const o1 = order();
  const o2 = order({ id: 'o2', no: 'B', void: true });
  const o3 = order({ id: 'o3', no: 'C', items: [{ name: 'Buket Uang', qty: 1, price: 500000, cost: 450000, discount: 0 }], subtotal: 500000, item_discount: 0, order_discount: 0, extra_fee: 0, total: 500000, cost_total: 450000, cashier_name: 'Sari' });
  const pays: Payment[] = [
    { id: 'a', order_id: 'o1', outlet_id: 'outlet-utama', method: 'QRIS', amount: 155000, kind: 'dp', created_at: '2026-11-15T03:00:00Z' },
    { id: 'b', order_id: 'o3', outlet_id: 'outlet-utama', method: 'Tunai', amount: 500000, kind: 'lunas', created_at: '2026-11-15T04:00:00Z' },
  ];
  const r = buildReport({
    orders: [o1, o2, o3], payments: pays,
    cashMoves: [{ id: 'k', outlet_id: 'outlet-utama', type: 'keluar', category: 'Gaji', biaya: true, method: 'Tunai', amount: 50000, created_at: '2026-11-15T05:00:00Z' },
      { id: 'k2', outlet_id: 'outlet-utama', type: 'keluar', category: 'Belanja bahan', biaya: false, method: 'Tunai', amount: 99999, created_at: '2026-11-15T05:00:00Z' }],
    from: new Date('2026-11-15T00:00:00Z'), to: new Date('2026-11-15T23:59:59Z'),
  });
  assert.equal(r.count, 2);
  assert.equal(r.voided, 1);
  assert.equal(r.netSales, 810000);
  assert.equal(r.cogs, 631000);
  assert.equal(r.grossProfit, 179000);
  assert.equal(r.expenses, 50000);
  assert.equal(r.netProfit, 129000);
  assert.equal(r.paidForPeriodOrders + r.outstandingForPeriodOrders, r.netSales);
  assert.equal(r.outstandingForPeriodOrders, 155000);
  assert.equal(r.cashInTotal, 655000);
});

test('shift: kas seharusnya = awal + tunai + masuk − keluar', () => {
  const sh = { id: 's1', outlet_id: 'x', device_id: 'd', user_id: 'u', opened_at: '2026-11-15T00:00:00Z', opening_cash: 200000 };
  const pays: Payment[] = [
    { id: '1', order_id: 'o', outlet_id: 'x', method: 'Tunai', amount: 150000, kind: 'lunas', shift_id: 's1' },
    { id: '2', order_id: 'o', outlet_id: 'x', method: 'QRIS', amount: 90000, kind: 'lunas', shift_id: 's1' },
    { id: '3', order_id: 'o', outlet_id: 'x', method: 'Tunai', amount: 70000, kind: 'lunas', shift_id: 'lain' },
  ];
  const s = shiftSummary(sh, pays, [{ id: 'k', outlet_id: 'x', shift_id: 's1', type: 'keluar', category: 'x', biaya: true, method: 'Tunai', amount: 25000 }]);
  assert.equal(s.expected, 325000);
  assert.deepEqual(s.nonCash, [{ method: 'QRIS', amount: 90000 }]);
});

test('kapasitas: hanya item bertipe buket pada tanggal jadwal', () => {
  const o = order({ due_at: new Date(2026, 10, 16, 9).toISOString() });
  assert.equal(scheduledQtyOn([o], '2026-11-16', dayKey), 2);
});

test('impor Kasir Pintar: waktu WIB & kode metode', async () => {
  const { kpTime, kpMethod } = await import('../src/lib/kasirpintar');
  assert.equal(kpTime('2026-11-15 10:00:00'), '2026-11-15T03:00:00.000Z');
  assert.equal(kpMethod('105'), 'QRIS');
  assert.equal(kpMethod(0), 'Tunai');
});
