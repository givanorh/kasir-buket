// Impor data hasil ekspor Kasir Pintar (berkas JSON dari tools/ekspor-kasirpintar.js).
// ID dibuat deterministik dari ID Kasir Pintar, sehingga impor ulang tidak menggandakan data.
import { db } from './db';
import { saveMany } from './store';
import type { Collection, OrderItem } from './types';

export interface KPExport {
  exported_at?: string;
  products?: any[];
  categories?: any[];
  customers?: any[];
  transactions?: any[];
}

const clean = (raw: unknown) => String(raw ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 50);
const safeId = (prefix: string, raw: unknown) => `${prefix}${clean(raw)}`;
/** FNV-1a 32 bit → base36; cukup untuk ID cadangan yang stabil antarimpor. */
export function hashKey(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(7, '0');
}
/**
 * ID impor: kandidat pertama yang tidak kosong setelah dibersihkan. Bila semua kosong (baris tanpa ID dan tanpa kode),
 * ID diturunkan dari isi baris (`fallback`, mis. nama + harga) sehingga tetap deterministik dan sah menurut server
 * (/^[A-Za-z0-9_-]{4,64}$/). Sebelum v1.8 baris seperti itu menjadi "kp-" dan ditolak server ("ID tidak valid").
 */
export function importId(prefix: string, candidates: unknown[], fallback: string): string {
  for (const c of candidates) { const v = clean(c); if (v) return `${prefix}${v}`; }
  return `${prefix}h${hashKey(fallback.trim().toLowerCase())}`;
}
const n = (v: unknown) => Math.round(Number(v) || 0);

/** Waktu Kasir Pintar umumnya "YYYY-MM-DD HH:mm:ss" waktu lokal (WIB) atau epoch. */
export function kpTime(v: unknown): string {
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  const s = String(v ?? '').trim();
  if (/^\d{10,13}$/.test(s)) return kpTime(Number(s));
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+07:00`).toISOString();
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

const METHOD_CODES: Record<string, string> = {
  '0': 'Tunai', '1': 'Debit', '2': 'Transfer', '100': 'GoPay', '101': 'OVO', '102': 'Cashlez', '103': 'Dana', '104': 'LinkAja', '105': 'QRIS', '499': 'Multipayment',
};
export function kpMethod(v: unknown): string {
  const s = String(v ?? '').trim();
  if (METHOD_CODES[s]) return METHOD_CODES[s];
  if (/cash|tunai/i.test(s)) return 'Tunai';
  if (/qris/i.test(s)) return 'QRIS';
  return s || 'Tunai';
}

function parseItems(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; } }
  return [];
}

export interface ImportPlan { categories: number; products: number; customers: number; orders: number; payments: number; /** baris tanpa ID, kode, dan nama */ skipped: number; writes: { c: Collection; id: string; patch: Record<string, unknown> }[] }

export async function planImport(data: KPExport, outletId: string, opts: { importStock: boolean }): Promise<ImportPlan> {
  const writes: ImportPlan['writes'] = [];
  const catByName = new Map<string, string>();
  for (const c of await db.categories.toArray()) catByName.set(c.name.toLowerCase(), c.id);
  const catId = (name: string) => {
    const key = (name || 'Lainnya').trim().toLowerCase();
    if (!catByName.has(key)) {
      const id = importId('kpcat-', [key.replace(/\s+/g, '-')], key);
      catByName.set(key, id);
      writes.push({ c: 'categories', id, patch: { name: (name || 'Lainnya').trim(), sort: 50 + catByName.size } });
    }
    return catByName.get(key)!;
  };
  let categories = 0, products = 0, customers = 0, orders = 0, payments = 0;
  for (const c of data.categories || []) { const before = catByName.size; catId(c.nama || c.name); if (catByName.size > before) categories++; }

  const prodBySku = new Map<string, string>();
  let skipped = 0;
  for (const p of data.products || []) {
    const pname = String(p.nama_barang || p.name || '').trim();
    // baris tanpa ID, tanpa kode, dan tanpa nama bukan produk (mis. baris jumlah): dilewati
    if (!pname && !clean(p.id_barang) && !clean(p.id) && !clean(p.kode_barang)) { skipped++; continue; }
    const id = importId('kp-', [p.id_barang, p.id, p.kode_barang], `${pname}|${n(p.harga_jual)}|${String(p.kategori || '')}`);
    // harga_beli = HPP per unit. harga_modal di Kasir Pintar = nilai modal total (harga_beli × stok), bukan per unit.
    const stok = n(p.stok);
    const cost = n(p.harga_beli) || (n(p.harga_modal) && stok > 0 ? Math.round(n(p.harga_modal) / stok) : n(p.harga_modal));
    const track = opts.importStock && stok !== 0;
    writes.push({
      c: 'products', id, patch: {
        name: String(p.nama_barang || p.name || 'Tanpa nama'), sku: String(p.kode_barang || ''), category_id: catId(p.kategori),
        type: p.barang_jasa === 'jasa' || /jasa/i.test(String(p.barang_jasa || '')) ? 'jasa' : 'buket',
        price: n(p.harga_jual), cost, track_stock: track, min_stock: n(p.stok_minim), description: String(p.keterangan || ''), active: !n(p.soft_delete),
      },
    });
    if (track) writes.push({ c: 'stock_moves', id: safeId('kpstk-', id), patch: { product_id: id, outlet_id: outletId, qty: stok, reason: 'impor', note: 'Stok awal dari Kasir Pintar' } });
    if (p.kode_barang) prodBySku.set(String(p.kode_barang), id);
    products++;
  }

  for (const c of data.customers || []) {
    const cname = String(c.nama || c.name || '').trim();
    if (!cname && !clean(c.id) && !clean(c.kode) && !clean(c.no_hp)) { skipped++; continue; }
    const id = importId('kpcus-', [c.id, c.kode, c.no_hp], cname);
    writes.push({ c: 'customers', id, patch: { name: String(c.nama || c.name || c.no_hp || 'Pelanggan'), phone: String(c.no_hp || c.phone || '').replace(/[^\d+]/g, ''), address: String(c.alamat || ''), note: String(c.email || '') } });
    customers++;
  }

  for (const t of data.transactions || []) {
    if (t.jenis && t.jenis !== 'pemasukan') continue;
    const kode = t.kode ?? t.no_struk;
    if (!kode) continue;
    const id = importId('kpo-', [kode], `${t.timestamp}|${t.grand_total ?? t.total}`);
    const items: OrderItem[] = parseItems(t.data_transaksi).map((it) => ({
      product_id: prodBySku.get(String(it.kode_barang)) || undefined,
      name: String(it.nama_barang || 'Item'), sku: String(it.kode_barang || ''),
      qty: n(it.banyak_barang) || 1, price: n(it.harga_jual), cost: n(it.harga_beli), discount: n(it.nilai_diskon), note: String(it.catatan || ''),
      type: 'buket',
    }));
    const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
    const itemDisc = items.reduce((s, i) => s + i.discount, 0);
    const total = n(t.grand_total) || n(t.total) || subtotal - itemDisc;
    const created = kpTime(t.timestamp);
    const orderDisc = Math.max(0, subtotal - itemDisc - total);
    const fee = Math.max(0, total - (subtotal - itemDisc));
    const paid = Math.min(n(t.bayar) || total, total);
    writes.push({
      c: 'orders', id, patch: {
        no: String(t.no_struk || kode), outlet_id: outletId, cashier_name: String(t.kasir || t.nama_staff_pemesan || ''),
        items, subtotal, item_discount: itemDisc, order_discount: orderDisc, extra_fee: fee, total,
        cost_total: items.reduce((s, i) => s + i.qty * i.cost, 0) || n(t.hpp),
        cash_received: n(t.bayar), change: n(t.kembali), fulfillment: 'sekarang', due_at: created, notes: String(t.keterangan || ''),
        production_status: 'selesai', source: 'kasirpintar', created_at: created,
      },
    });
    orders++;
    if (paid > 0) {
      writes.push({ c: 'payments', id: `kpp-${id.slice(4)}`, patch: { order_id: id, outlet_id: outletId, method: kpMethod(t.metode_pembayaran ?? t.tipe_pembayaran), amount: paid, kind: paid >= total ? 'lunas' : 'dp', created_at: created } });
      payments++;
    }
  }
  // jaring pengaman: tidak boleh ada ID yang akan ditolak server
  const bad = writes.find((w) => !/^[A-Za-z0-9_-]{4,64}$/.test(w.id));
  if (bad) throw new Error(`ID impor tidak sah pada ${bad.c}: "${bad.id}"`);
  return { categories, products, customers, orders, payments, skipped, writes };
}

export async function runImport(plan: ImportPlan, onProgress?: (done: number, total: number) => void) {
  const CHUNK = 500;
  for (let i = 0; i < plan.writes.length; i += CHUNK) {
    await saveMany(plan.writes.slice(i, i + CHUNK));
    onProgress?.(Math.min(i + CHUNK, plan.writes.length), plan.writes.length);
  }
}
