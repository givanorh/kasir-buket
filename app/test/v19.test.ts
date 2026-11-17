import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pettySummary, shiftSummary } from '../src/lib/calc';
import { DEFAULT_DRAWER_FLOAT, DEFAULT_PETTY_TARGET, storeCfg } from '../src/lib/settings';
import type { CashMove, Payment, Shift } from '../src/lib/types';

const mv = (p: Partial<CashMove>) => ({ id: Math.random().toString(36).slice(2), outlet_id: 'o1', type: 'keluar', category: 'Uang sampah', biaya: true, method: 'Tunai', amount: 0, created_at: '2026-11-17T03:00:00.000Z', ...p }) as CashMove;

test('bawaan dua laci: laci kasir Rp 1.000.000, laci meja kamar Rp 500.000; bisa diubah owner', () => {
  assert.equal(DEFAULT_DRAWER_FLOAT, 1_000_000);
  assert.equal(DEFAULT_PETTY_TARGET, 500_000);
  assert.deepEqual([storeCfg(undefined).drawerFloat, storeCfg(undefined).pettyTarget], [1_000_000, 500_000]);
  assert.deepEqual([storeCfg({ drawer_float: 800_000, petty: { target: 300_000 } } as never).drawerFloat, storeCfg({ petty: { target: 300_000 } } as never).pettyTarget], [800_000, 300_000]);
});

test('laci kasir hanya kembalian: kas keluar laci meja kamar tidak mengubah rekap shift; catatan lama tetap dihitung', () => {
  const sh = { id: 's1', opening_cash: 1_000_000, opened_at: '2026-11-17T01:00:00.000Z' } as Shift;
  const pays = [{ id: 'p1', order_id: 'o', shift_id: 's1', method: 'Tunai', amount: 250_000, kind: 'lunas' }, { id: 'p2', order_id: 'o2', shift_id: 's1', method: 'QRIS', amount: 100_000, kind: 'lunas' }] as Payment[];
  const kamar = mv({ shift_id: 's1', drawer: 'kamar', amount: 20_000 });
  const lama = mv({ shift_id: 's1', amount: 15_000 }); // sebelum v1.9: tanpa drawer
  const a = shiftSummary(sh, pays, [kamar]);
  assert.equal(a.expected, 1_000_000 + 250_000, '1.000.000 + 250.000; kas keluar Rp 20.000 dari laci meja kamar tidak dikurangkan');
  assert.equal(a.cashOut, 0);
  const b = shiftSummary(sh, pays, [kamar, lama]);
  assert.equal(b.expected, 1_000_000 + 250_000 - 15_000, 'catatan lama tanpa laci tetap mengurangi laci kasir');
});

test('kas kecil laci meja kamar: saldo = awal + masuk − keluar sejak hitung terakhir, per cabang', () => {
  const ms = [
    mv({ drawer: 'kamar', amount: 20_000, category: 'Uang sampah', created_at: '2026-11-17T02:00:00.000Z' }),
    mv({ drawer: 'kamar', amount: 50_000, category: 'Sumbangan', created_at: '2026-11-17T03:00:00.000Z' }),
    mv({ drawer: 'kamar', amount: 30_000, category: 'Pembelian darurat', outlet_id: 'o2' }), // cabang lain
    mv({ amount: 99_000 }), // catatan lama laci kasir: bukan kas kecil
    mv({ drawer: 'kamar', amount: 10_000, deleted: true }),
  ];
  const p = pettySummary(ms, 'o1', 500_000);
  assert.deepEqual([p.opening, p.cashOut, p.balance, p.shortfall], [500_000, 70_000, 430_000, 70_000], '500.000 − 20.000 − 50.000 = 430.000; isi ulang 70.000');
  const topped = pettySummary([...ms, mv({ drawer: 'kamar', type: 'masuk', category: 'Isi ulang kas kecil', biaya: false, amount: 70_000, created_at: '2026-11-17T04:00:00.000Z' })], 'o1', 500_000);
  assert.deepEqual([topped.balance, topped.shortfall], [500_000, 0]);
  // owner menghitung ulang: Rp 425.000 pada 03.30 → hanya catatan setelahnya yang dihitung
  const c = pettySummary(ms, 'o1', 500_000, { opening: 425_000, at: '2026-11-17T03:30:00.000Z' });
  assert.deepEqual([c.opening, c.cashOut, c.balance, c.moves.length], [425_000, 0, 425_000, 0]);
  assert.equal(p.moves[0].category, 'Sumbangan', 'riwayat terbaru di atas');
});
