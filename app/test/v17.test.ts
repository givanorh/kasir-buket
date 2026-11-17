import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSetStatus, proxyMessage } from '../src/lib/rules';
import { buildStruk } from '../src/lib/print/receipts';
import { layout } from '../src/lib/print/escpos';
import type { Order, Payment } from '../src/lib/types';

const o = (st: Order['production_status'], extra: Partial<Order> = {}) => ({ void: false, production_status: st, ...extra }) as Order;

test('wewenang status produksi: antri/dirangkai oleh perangkai, "Sudah diambil" oleh kasir setelah lunas', () => {
  // kasir (Admin): tombol Mulai rangkai & Selesai dirangkai abu-abu
  assert.equal(canSetStatus('kasir', o('antri'), 'dirangkai', 0), false);
  assert.equal(canSetStatus('kasir', o('dirangkai'), 'siap', 0), false);
  assert.equal(canSetStatus('kasir', o('siap'), 'selesai', 0), true);
  assert.equal(canSetStatus('kasir', o('siap'), 'selesai', 210_000), false, 'masih DP: bayar pelunasan dulu');
  assert.equal(canSetStatus('kasir', o('dirangkai'), 'selesai', 0), false, 'belum siap tidak bisa langsung diambil');
  // perangkai: Sudah diambil abu-abu
  assert.equal(canSetStatus('perangkai', o('antri'), 'dirangkai', 210_000), true);
  assert.equal(canSetStatus('perangkai', o('dirangkai'), 'siap', 210_000), true);
  assert.equal(canSetStatus('perangkai', o('siap'), 'selesai', 0), false);
  // owner: semua, kecuali diambil saat masih ada sisa tagihan
  assert.equal(canSetStatus('owner', o('antri'), 'dirangkai', 0), true);
  assert.equal(canSetStatus('owner', o('siap'), 'selesai', 1), false);
  assert.equal(canSetStatus('owner', o('siap'), 'selesai', 0), true);
  // pesanan batal: tidak ada yang bisa mengubah
  assert.equal(canSetStatus('owner', o('antri', { void: true }), 'dirangkai', 0), false);
});

test('galat perantara: halaman ngrok/cloudflare non-JSON diterjemahkan, bukan "Galat 404"', () => {
  assert.match(proxyMessage(404, 'ERR_NGROK_3200', ''), /Tunnel ngrok sedang mati \(ERR_NGROK_3200\)/);
  assert.match(proxyMessage(404, null, '<html>... ERR_NGROK_3200 ... is offline</html>'), /ERR_NGROK_3200/);
  assert.match(proxyMessage(502, 'ERR_NGROK_8012', ''), /server Kasir Buket di PC toko mati atau beda port/);
  assert.match(proxyMessage(530, null, 'error code: 1033 cloudflare'), /Cloudflare/);
  assert.match(proxyMessage(404, null, 'Not found'), /status 404/);
});

test('struk pelunasan: label, DP + pelunasan bertanggal, status LUNAS tanpa sisa tagihan', () => {
  const order = {
    id: 'o1', no: '261116-KK001', created_at: '2026-11-16T03:00:00.000Z', cashier_name: 'Vano', items: [{ name: 'Buket Mawar', qty: 1, price: 420_000, discount: 0 }],
    subtotal: 420_000, item_discount: 0, order_discount: 0, extra_fee: 0, total: 420_000, fulfillment: 'ambil', due_at: '2026-11-17T03:00:00.000Z', production_status: 'siap',
  } as unknown as Order;
  const pays = [
    { id: 'p1', order_id: 'o1', method: 'QRIS', amount: 210_000, kind: 'dp', created_at: '2026-11-16T03:00:00.000Z' },
    { id: 'p2', order_id: 'o1', method: 'Tunai', amount: 210_000, kind: 'pelunasan', created_at: '2026-11-17T02:30:00.000Z' },
  ] as Payment[];
  const txt = layout(buildStruk(order, pays, undefined, { copyLabel: 'STRUK PELUNASAN' }), 58).map((r) => r.text).join('\n');
  assert.match(txt, /\*\* STRUK PELUNASAN \*\*/);
  assert.match(txt, /DP QRIS :\s+210\.000/);
  assert.match(txt, /PELUNASAN TUNAI :\s+210\.000/);
  assert.equal((txt.match(/TGL \d{2}\.\d{2}\.26-\d{2}:\d{2}/g) || []).length, 2, 'tanggal DP dan tanggal pelunasan');
  assert.match(txt, /^\s*LUNAS\s*$/m);
  assert.doesNotMatch(txt, /SISA TAGIHAN/);
});
