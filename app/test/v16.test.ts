import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COSTS, allocCosts, hppPerBuket, monthSlices, monthlyOf, monthsWorked, thrOf } from '../src/lib/costs';
import { buildReport } from '../src/lib/calc';
import { DEFAULT_EVENTS_2026, KIND_LIST, migrateMusim, omzetRank, dailySales } from '../src/lib/events';
import type { CalEvent, CostItem, Order } from '../src/lib/types';

const d = (k: string, end = false) => new Date(`${k}T${end ? '23:59:59' : '00:00:00'}`);

test('gaji bawaan: 7 pegawai, jumlah Rp 8.700.000 per bulan', () => {
  const staff = DEFAULT_COSTS.filter((c) => c.kind === 'pegawai');
  assert.equal(staff.length, 7);
  assert.equal(staff.reduce((s, p) => s + (p.salary || 0), 0), 8_700_000); // 1,4 + 1,5 + 1,4 + 1,4 + 1,0 + 1,0 + 1,0 jt
  assert.deepEqual(staff.filter((p) => p.role === 'perangkai').map((p) => p.name), ['Iin', 'Fira', 'Nazra', 'Mirna']);
  const ok = ['THR', 'Bonus tambahan', 'Listrik', 'Servis AC', 'Servis printer', 'Servis komputer', 'Pembelian lampu', 'Uang standby', 'Jajan dadakan'];
  for (const k of ok) assert.ok(DEFAULT_COSTS.some((c) => c.name.startsWith(k)), `ada isian ${k}`);
});

test('pecahan bulan: satu bulan penuh = 1; 16 dari 30 hari = 0,533…; lintas bulan', () => {
  assert.deepEqual(monthSlices('2026-10-01', '2026-10-31').map((x) => x.frac), [1]);
  assert.equal(monthSlices('2026-11-01', '2026-11-16')[0].frac, 16 / 30);
  const s = monthSlices('2026-10-17', '2026-11-15');
  assert.deepEqual(s.map((x) => [x.m, x.days]), [[9, 15], [10, 15]]); // 15 hari Okt (31) + 15 hari Nov (30)
});

test('alokasi gaji, THR, bonus, dan biaya ke periode', () => {
  const costs: CostItem[] = [
    { id: 'p1', kind: 'pegawai', name: 'Iin', role: 'perangkai', salary: 1_400_000, bonus_year: 1_200_000 },
    { id: 'p2', kind: 'pegawai', name: 'Baru', role: 'admin', salary: 1_200_000, start: '2026-05-01' },
    { id: 'thr', kind: 'thr', name: 'THR', mult: 1 },
    { id: 'b1', kind: 'biaya', name: 'Listrik', group: 'utilitas', freq: 'bulan', amount: 600_000 },
    { id: 'b2', kind: 'biaya', name: 'Servis AC', group: 'perawatan', freq: 'n_bulan', every: 3, amount: 150_000 },
    { id: 'b3', kind: 'biaya', name: 'Sewa', group: 'operasional', freq: 'tahun', amount: 12_000_000 },
    { id: 'b4', kind: 'biaya', name: 'Lampu', group: 'perawatan', freq: 'sekali', date: '2026-10-20', amount: 85_000 },
    { id: 'b5', kind: 'biaya', name: 'Admin QRIS', group: 'operasional', freq: 'persen', pct: 0.3 },
    { id: 'b6', kind: 'biaya', name: 'Standby laci', group: 'kas', freq: 'sekali', amount: 500_000, pl: false },
    { id: 'b7', kind: 'biaya', name: 'Nonaktif', group: 'operasional', freq: 'bulan', amount: 999_999, active: false },
  ];
  const a = allocCosts(costs, d('2026-10-01'), d('2026-10-31', true), 60_000_000);
  // THR Baru: masa kerja 1 Mei → 31 Okt = 5 bulan → 5/12 × 1.200.000 = 500.000/tahun → 41.667/bulan
  assert.equal(monthsWorked('2026-05-01', '2026-10-31'), 5);
  assert.equal(thrOf(costs[1], '2026-10-31'), 500_000);
  assert.equal(a.gaji, 2_600_000);
  assert.equal(a.tunjangan, Math.round(1_400_000 / 12) + 100_000 + Math.round(500_000 / 12)); // THR Iin + bonus Iin + THR Baru
  assert.equal(a.operasional, 600_000 + 50_000 + 1_000_000 + 85_000 + 180_000); // listrik + AC/3 + sewa/12 + lampu + 0,3% × 60 jt
  assert.equal(a.kas, 500_000, 'uang standby tercatat sebagai kas, bukan beban');
  assert.equal(a.total, a.gaji + a.tunjangan + a.operasional);
  assert.equal(monthlyOf(costs[4]), 50_000);
  // separuh bulan: gaji proporsional hari (15/31)
  const h = allocCosts(costs, d('2026-10-01'), d('2026-10-15', true), 0);
  assert.equal(h.gaji, Math.round(1_400_000 * 15 / 31) + Math.round(1_200_000 * 15 / 31));
  // pegawai belum mulai kerja: gaji tidak dialokasikan sebelum tanggal mulai
  assert.equal(allocCosts(costs, d('2026-04-01'), d('2026-04-30', true)).lines.find((l) => l.id === 'p2')!.amount, 0);
});

test('laba rugi memasukkan gaji & biaya; HPP penuh per buket dan titik impas', () => {
  const o = (id: string, items: Order['items'], total: number, cost: number): Order => ({ id, no: id, outlet_id: 'o', items, subtotal: total, item_discount: 0, order_discount: 0, extra_fee: 0, total, cost_total: cost, qty: 1, fulfillment: 'sekarang', production_status: 'selesai', created_at: '2026-10-10T05:00:00Z' } as unknown as Order);
  const orders = [
    o('a', [{ name: 'Buket', qty: 2, price: 150_000, cost: 60_000, discount: 0, type: 'buket' }, { name: 'Kartu', qty: 1, price: 10_000, cost: 2_000, discount: 0, type: 'addon' }], 310_000, 122_000),
    o('b', [{ name: 'Buket', qty: 2, price: 150_000, cost: 60_000, discount: 0 }], 300_000, 120_000),
  ];
  const costs: CostItem[] = [{ id: 'p', kind: 'pegawai', name: 'Iin', salary: 1_000_000 }, { id: 'l', kind: 'biaya', name: 'Listrik', group: 'utilitas', freq: 'bulan', amount: 310_000 }];
  const r = buildReport({ orders, payments: [], cashMoves: [], from: d('2026-10-01'), to: d('2026-10-31', true), hppMethod: 'produk', costs });
  assert.equal(r.buketQty, 4);
  assert.equal(r.buketSales, 600_000);
  assert.equal(r.labor, 1_000_000);
  assert.equal(r.opex, 310_000);
  assert.equal(r.netProfit, 610_000 - 242_000 - 1_310_000);
  const h = hppPerBuket({ buketQty: 4, buketSales: 600_000, cogs: 240_000, labor: 1_000_000, overhead: 310_000, monthlyFixed: 1_310_000 });
  assert.equal(h.full, (240_000 + 1_000_000 + 310_000) / 4); // 387.500
  assert.equal(h.price, 150_000);
  assert.equal(h.bep, Math.ceil(1_310_000 / (150_000 - 60_000))); // 15 buket per bulan
});

test('kalender v1.6: kategori tanpa Musim, migrasi Ramadan & event musim, urut omzet', () => {
  assert.deepEqual(KIND_LIST, ['libur', 'lokal', 'momen', 'data', 'toko']);
  assert.ok(!DEFAULT_EVENTS_2026.some((e) => e.kind === 'musim' || e.id === 'ev26-ramadan'));
  const old: CalEvent[] = [
    { id: 'ev26-ramadan', date: '2026-02-19', end: '2026-03-20', name: 'Ramadan 1447 H (perkiraan)', kind: 'musim' },
    { id: 'ev26-wisuda-mei', date: '2026-05-04', end: '2026-05-31', name: 'Musim kelulusan & wisuda sekolah', kind: 'musim' },
    { id: 'ev26-guru', date: '2026-11-23', name: 'Hari Guru', kind: 'momen' },
  ];
  const m = migrateMusim(old);
  assert.deepEqual(m, [{ id: 'ev26-ramadan', patch: { deleted: true } }, { id: 'ev26-wisuda-mei', patch: { kind: 'momen', name: 'Kelulusan & wisuda sekolah' } }]);
  assert.deepEqual(migrateMusim([...old.slice(2)]), [], 'idempoten');
  const mk = (day: string, total: number): Order => ({ id: day, total, created_at: `${day}T05:00:00Z` } as Order);
  const dl = dailySales([mk('2026-02-14', 9_500_000), mk('2026-05-05', 6_000_000), mk('2025-11-24', 6_200_000)]);
  const evs = [{ date: '2026-05-04', end: '2026-05-31', name: 'Wisuda' }, { date: '2026-02-12', end: '2026-02-15', name: 'Valentine' }, { date: '2026-11-23', end: '2026-11-25', name: 'Guru' }];
  const r = omzetRank(evs, dl);
  assert.deepEqual(r.map((x) => [x.e.name, x.sales, x.lastYear]), [['Valentine', 9_500_000, false], ['Guru', 6_200_000, true], ['Wisuda', 6_000_000, false]]);
});
