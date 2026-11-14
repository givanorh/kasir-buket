// Isi struk pelanggan (printer kasir) dan tiket produksi (printer ruang perangkai).
import type { Line } from './escpos';
import type { Order, Payment, Settings } from '../types';
import { fmtDate, fmtTime, num } from '../format';

const FULFILL_LABEL = { sekarang: 'AMBIL SEKARANG', ambil: 'DIAMBIL', antar: 'DIANTAR' } as const;

export function buildStruk(order: Order, payments: Payment[], st: Settings | undefined, opts: { copyLabel?: string } = {}): Line[] {
  const L: Line[] = [];
  const pays = payments.filter((p) => !p.void).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const paid = pays.reduce((s, p) => s + p.amount, 0);
  const due = Math.max(0, order.total - paid);

  L.push({ t: 'text', text: st?.store_name || 'Toko Buket', align: 'center', bold: true, size: 2 });
  if (st?.address) L.push({ t: 'text', text: st.address, align: 'center' });
  if (st?.phone) L.push({ t: 'text', text: `Telp/WA ${st.phone}`, align: 'center' });
  if (st?.instagram) L.push({ t: 'text', text: `IG ${st.instagram}`, align: 'center' });
  if (opts.copyLabel) L.push({ t: 'text', text: `*** ${opts.copyLabel} ***`, align: 'center', bold: true });
  if (order.void) L.push({ t: 'text', text: '*** DIBATALKAN ***', align: 'center', bold: true, size: 2 });
  L.push({ t: 'hr' });
  L.push({ t: 'lr', left: 'No', right: order.no, bold: true });
  L.push({ t: 'lr', left: 'Tanggal', right: `${fmtDate(order.created_at)} ${fmtTime(order.created_at)}` });
  L.push({ t: 'lr', left: 'Kasir', right: order.cashier_name || '-' });
  if (order.customer_name || order.customer_phone) L.push({ t: 'lr', left: 'Pelanggan', right: [order.customer_name, order.customer_phone].filter(Boolean).join(' ') });
  L.push({ t: 'hr' });
  for (const it of order.items) {
    L.push({ t: 'text', text: it.name, bold: true });
    L.push({ t: 'lr', left: `  ${it.qty} x ${num(it.price)}`, right: num(it.qty * it.price) });
    if (it.discount) L.push({ t: 'lr', left: '  Potongan', right: '-' + num(it.discount) });
    if (it.note) L.push({ t: 'text', text: `  (${it.note})` });
  }
  L.push({ t: 'hr' });
  L.push({ t: 'lr', left: 'Subtotal', right: num(order.subtotal) });
  if (order.item_discount + order.order_discount) L.push({ t: 'lr', left: 'Diskon', right: '-' + num(order.item_discount + order.order_discount) });
  if (order.extra_fee) L.push({ t: 'lr', left: order.fulfillment === 'antar' ? 'Ongkir' : 'Biaya tambahan', right: num(order.extra_fee) });
  L.push({ t: 'lr', left: 'TOTAL', right: 'Rp ' + num(order.total), bold: true, size: 2 });
  for (const p of pays) L.push({ t: 'lr', left: `${p.kind === 'dp' ? 'DP' : p.kind === 'pelunasan' ? 'Pelunasan' : 'Bayar'} (${p.method})`, right: num(p.amount) });
  if (order.change && order.cash_received) {
    L.push({ t: 'lr', left: 'Uang diterima', right: num(order.cash_received) });
    L.push({ t: 'lr', left: 'Kembali', right: num(order.change) });
  }
  if (due > 0) L.push({ t: 'lr', left: 'SISA TAGIHAN', right: 'Rp ' + num(due), bold: true });
  else L.push({ t: 'text', text: 'LUNAS', align: 'center', bold: true });
  L.push({ t: 'hr' });
  L.push({ t: 'text', text: FULFILL_LABEL[order.fulfillment], bold: true });
  if (order.fulfillment !== 'sekarang' && order.due_at) L.push({ t: 'text', text: `${fmtDate(order.due_at)} pukul ${fmtTime(order.due_at)}`, bold: true });
  if (order.fulfillment === 'antar') {
    if (order.recipient_name) L.push({ t: 'text', text: `Penerima: ${order.recipient_name} ${order.recipient_phone || ''}` });
    if (order.delivery_address) L.push({ t: 'text', text: `Alamat: ${order.delivery_address}` });
  }
  L.push({ t: 'hr' });
  if (st?.receipt_footer) L.push({ t: 'text', text: st.receipt_footer, align: 'center' });
  L.push({ t: 'cut' });
  return L;
}

export function buildTiket(order: Order, st: Settings | undefined): Line[] {
  const L: Line[] = [];
  L.push({ t: 'text', text: 'TIKET PRODUKSI', align: 'center', bold: true });
  if (order.void) L.push({ t: 'text', text: 'BATAL - JANGAN DIBUAT', align: 'center', bold: true, size: 2 });
  const shortNo = order.no.split('-').pop() || order.no;
  L.push({ t: 'text', text: `#${shortNo}`, align: 'center', bold: true, size: 2 });
  L.push({ t: 'text', text: order.no, align: 'center' });
  L.push({ t: 'hr', char: '=' });
  if (order.fulfillment === 'sekarang') {
    L.push({ t: 'text', text: 'DITUNGGU SEKARANG', align: 'center', bold: true, size: 2 });
  } else {
    L.push({ t: 'text', text: FULFILL_LABEL[order.fulfillment], align: 'center', bold: true });
    L.push({ t: 'text', text: `${fmtDate(order.due_at)}`, align: 'center', bold: true, size: 2 });
    L.push({ t: 'text', text: `PUKUL ${fmtTime(order.due_at)}`, align: 'center', bold: true, size: 2 });
  }
  L.push({ t: 'hr', char: '=' });
  for (const it of order.items) {
    L.push({ t: 'text', text: `${it.qty}x ${it.name}`, bold: true, size: 2 });
    if (it.note) L.push({ t: 'text', text: `   > ${it.note}`, bold: true });
  }
  if (order.notes) {
    L.push({ t: 'hr' });
    L.push({ t: 'text', text: 'CATATAN RANGKAIAN:', bold: true });
    L.push({ t: 'text', text: order.notes });
  }
  if (order.card_message) {
    L.push({ t: 'hr' });
    L.push({ t: 'text', text: 'KARTU UCAPAN:', bold: true });
    L.push({ t: 'text', text: `"${order.card_message}"` });
  }
  L.push({ t: 'hr' });
  if (order.customer_name || order.customer_phone) L.push({ t: 'text', text: `Pemesan: ${[order.customer_name, order.customer_phone].filter(Boolean).join(' / ')}` });
  if (order.fulfillment === 'antar') {
    L.push({ t: 'text', text: `Penerima: ${[order.recipient_name, order.recipient_phone].filter(Boolean).join(' / ') || '-'}` });
    if (order.delivery_address) L.push({ t: 'text', text: `Alamat: ${order.delivery_address}` });
  }
  L.push({ t: 'text', text: `Kasir: ${order.cashier_name || '-'}  |  Masuk ${fmtTime(order.created_at)}` });
  L.push({ t: 'text', text: st?.store_name || '', align: 'center' });
  L.push({ t: 'cut' });
  return L;
}

export function buildTest(target: string, width: 58 | 80, st?: Settings): Line[] {
  return [
    { t: 'text', text: 'TES PRINTER', align: 'center', bold: true, size: 2 },
    { t: 'text', text: `Printer ${target.toUpperCase()} - ${width} mm`, align: 'center' },
    { t: 'hr' },
    { t: 'lr', left: 'Kiri', right: 'Kanan' },
    { t: 'text', text: '1234567890'.repeat(5) },
    { t: 'text', text: st?.store_name || 'Kasir Buket', align: 'center' },
    { t: 'cut' },
  ];
}
