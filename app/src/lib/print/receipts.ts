// Isi struk pelanggan (printer kasir, gaya struk minimarket) dan tiket produksi (printer ruang perangkai).
import type { Line } from './escpos';
import type { Order, Payment, Settings } from '../types';
import { fmtDate, fmtTime, num } from '../format';

const p2 = (n: number) => String(n).padStart(2, '0');
/** 15.11.26-21:52 */
const stamp = (iso?: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}-${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
const neg = (n: number) => `(${num(n)})`;
const kmText = (km?: number) => (km ? `${(Math.ceil(km * 10 - 1e-9) / 10).toLocaleString('id-ID', { maximumFractionDigits: 1 })} KM` : '');

export interface StrukExtra { copyLabel?: string; pointsBalance?: number; memberNo?: string }

export function buildStruk(order: Order, payments: Payment[], st: Settings | undefined, opts: StrukExtra = {}): Line[] {
  const L: Line[] = [];
  const pays = payments.filter((p) => !p.void).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const paid = pays.reduce((s, p) => s + p.amount, 0);
  const due = Math.max(0, order.total - paid);
  const qty = order.items.reduce((s, i) => s + i.qty, 0);
  const otherDisc = Math.max(0, order.order_discount - (order.points_discount || 0) - (order.review_discount || 0));

  // kepala struk
  L.push({ t: 'text', text: (st?.store_name || 'Toko Buket').toUpperCase(), align: 'center', bold: true });
  if (st?.address) L.push({ t: 'text', text: st.address, align: 'center' });
  if (st?.phone) L.push({ t: 'text', text: `TELP/WA ${st.phone}`, align: 'center' });
  if (st?.instagram) L.push({ t: 'text', text: `IG ${st.instagram}`, align: 'center' });
  L.push({ t: 'hr' });
  L.push({ t: 'text', text: `${stamp(order.created_at)}/${order.no}/${(order.cashier_name || '-').split(' ')[0].toUpperCase()}`, align: 'center' });
  if (opts.copyLabel) L.push({ t: 'text', text: `** ${opts.copyLabel} **`, align: 'center', bold: true });
  if (order.void) L.push({ t: 'text', text: `** DIBATALKAN: ${order.void_reason || ''} **`, align: 'center', bold: true });
  L.push({ t: 'hr' });

  // barang
  for (const it of order.items) {
    L.push({ t: 'item', name: it.name, qty: it.qty, price: num(it.price), total: num(it.qty * it.price) });
    if (it.discount) L.push({ t: 'kv', label: 'POTONGAN', value: neg(it.discount) });
    if (it.note) L.push({ t: 'text', text: `  * ${it.note}` });
  }
  L.push({ t: 'hr' });

  // ringkasan
  L.push({ t: 'kv', label: 'TOTAL ITEM', value: String(qty) });
  L.push({ t: 'kv', label: 'HARGA JUAL', value: num(order.subtotal - order.item_discount) });
  if (otherDisc) L.push({ t: 'kv', label: 'DISKON', value: neg(otherDisc) });
  if (order.review_discount) L.push({ t: 'kv', label: 'DISKON ULASAN', value: neg(order.review_discount) });
  if (order.points_discount) L.push({ t: 'kv', label: `TUKAR ${order.points_redeemed} POIN`, value: neg(order.points_discount) });
  if (order.extra_fee) L.push({ t: 'kv', label: order.fulfillment === 'antar' ? `ONGKIR ${kmText(order.delivery?.km)}`.trim() : 'BIAYA LAIN', value: num(order.extra_fee) });
  L.push({ t: 'kv', label: 'TOTAL BELANJA', value: num(order.total), bold: true });
  L.push({ t: 'hr' });

  // pembayaran
  for (const p of pays) L.push({ t: 'kv', label: `${p.kind === 'dp' ? 'DP ' : p.kind === 'pelunasan' ? 'PELUNASAN ' : ''}${p.method.toUpperCase()}`, value: num(p.amount) });
  if (order.cash_received && order.cash_received > paid && order.change) {
    L.push({ t: 'kv', label: 'UANG DITERIMA', value: num(order.cash_received) });
    L.push({ t: 'kv', label: 'KEMBALI', value: num(order.change) });
  }
  if (due > 0) L.push({ t: 'kv', label: 'SISA TAGIHAN', value: num(due), bold: true });
  else L.push({ t: 'text', text: 'LUNAS', align: 'center', bold: true });
  L.push({ t: 'hr' });

  // pelanggan & pengambilan
  if (order.customer_name) L.push({ t: 'text', text: `PELANGGAN : ${order.customer_name.toUpperCase()}` });
  if (opts.memberNo) L.push({ t: 'text', text: `MEMBER : ${opts.memberNo}` });
  if (opts.memberNo && (order.points_earned || opts.pointsBalance !== undefined)) {
    const parts = [order.points_earned ? `+${order.points_earned} POIN` : '', opts.pointsBalance !== undefined ? `SALDO ${num(opts.pointsBalance)} POIN` : ''].filter(Boolean);
    L.push({ t: 'text', text: parts.join(' | ') });
  }
  if (order.fulfillment === 'sekarang') L.push({ t: 'text', text: 'AMBIL : SEKARANG' });
  else {
    L.push({ t: 'text', text: `${order.fulfillment === 'antar' ? 'ANTAR' : 'AMBIL'} : ${stamp(order.due_at).replace('-', ' ')}`, bold: true });
    if (order.fulfillment === 'antar') {
      if (order.recipient_name) L.push({ t: 'text', text: `PENERIMA : ${order.recipient_name.toUpperCase()} ${order.recipient_phone || ''}` });
      if (order.delivery_address) L.push({ t: 'text', text: `ALAMAT : ${order.delivery_address}` });
    }
  }
  L.push({ t: 'hr' });
  if (st?.receipt_footer) L.push({ t: 'text', text: st.receipt_footer, align: 'center' });
  L.push({ t: 'cut' });
  return L;
}

const FULFILL_LABEL = { sekarang: 'DITUNGGU', ambil: 'DIAMBIL', antar: 'DIANTAR' } as const;

export function buildTiket(order: Order, st: Settings | undefined): Line[] {
  const L: Line[] = [];
  const shortNo = order.no.split('-').pop() || order.no;
  L.push({ t: 'text', text: 'TIKET PRODUKSI', align: 'center', bold: true });
  if (order.void) L.push({ t: 'text', text: 'BATAL - JANGAN DIBUAT', align: 'center', bold: true, size: 2 });
  L.push({ t: 'text', text: `#${shortNo}`, align: 'center', bold: true, size: 2 });
  L.push({ t: 'text', text: `${order.no} / ${stamp(order.created_at)}`, align: 'center' });
  L.push({ t: 'hr', char: '=' });
  if (order.fulfillment === 'sekarang') L.push({ t: 'text', text: 'DITUNGGU', align: 'center', bold: true, size: 2 });
  else {
    L.push({ t: 'text', text: FULFILL_LABEL[order.fulfillment], align: 'center', bold: true });
    L.push({ t: 'text', text: `${fmtDate(order.due_at)}`, align: 'center', bold: true });
    L.push({ t: 'text', text: `${fmtTime(order.due_at)}`, align: 'center', bold: true, size: 2 });
  }
  if (order.florist) L.push({ t: 'text', text: `PERANGKAI : ${order.florist.toUpperCase()}`, align: 'center', bold: true });
  L.push({ t: 'hr', char: '=' });
  for (const it of order.items) {
    L.push({ t: 'text', text: `${it.qty}x ${it.name}`, bold: true, size: 2 });
    if (it.note) L.push({ t: 'text', text: `   > ${it.note}`, bold: true });
  }
  if (order.notes) {
    L.push({ t: 'hr' });
    L.push({ t: 'text', text: 'CATATAN RANGKAIAN', bold: true });
    L.push({ t: 'text', text: order.notes });
  }
  if (order.card_message) {
    L.push({ t: 'hr' });
    L.push({ t: 'text', text: 'KARTU UCAPAN', bold: true });
    L.push({ t: 'text', text: `"${order.card_message}"` });
  }
  L.push({ t: 'hr' });
  if (order.customer_name || order.customer_phone) L.push({ t: 'text', text: `PEMESAN : ${[order.customer_name, order.customer_phone].filter(Boolean).join(' / ')}` });
  if (order.fulfillment === 'antar') {
    L.push({ t: 'text', text: `PENERIMA : ${[order.recipient_name, order.recipient_phone].filter(Boolean).join(' / ') || '-'}` });
    if (order.delivery_address) L.push({ t: 'text', text: `ALAMAT : ${order.delivery_address}` });
    if (order.delivery?.km) L.push({ t: 'text', text: `JARAK : ${kmText(order.delivery.km)}` });
  }
  L.push({ t: 'text', text: `KASIR : ${order.cashier_name || '-'}` });
  L.push({ t: 'text', text: st?.store_name || '', align: 'center' });
  L.push({ t: 'cut' });
  return L;
}

export function buildTest(target: string, width: 58 | 80, st?: Settings): Line[] {
  return [
    { t: 'text', text: 'TES PRINTER', align: 'center', bold: true, size: 2 },
    { t: 'text', text: `PRINTER ${target.toUpperCase()} - ${width} MM`, align: 'center' },
    { t: 'hr' },
    { t: 'item', name: 'Buket Mawar Merah 20 Tangkai', qty: 2, price: num(150000), total: num(300000) },
    { t: 'kv', label: 'TOTAL BELANJA', value: num(300000), bold: true },
    { t: 'text', text: '1234567890'.repeat(5) },
    { t: 'text', text: st?.store_name || 'Kasir Buket', align: 'center' },
    { t: 'cut' },
  ];
}
