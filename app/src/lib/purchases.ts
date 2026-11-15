// Belanja bahan baku: pemetaan baris spreadsheet → data belanja, ID deterministik agar unggah ulang tidak menggandakan.
import { parseDateCell, parseMoney, parseNum } from './sheet';
import type { Purchase } from './types';

export const PURCHASE_CATEGORIES = ['Bunga segar', 'Bunga artifisial', 'Wrapping & kertas', 'Pita & aksesori', 'Boneka', 'Snack & cokelat', 'Uang (buket uang)', 'Kemasan & plastik', 'Lainnya'];

type Col = 'date' | 'item' | 'category' | 'qty' | 'unit' | 'price' | 'total' | 'supplier' | 'note';
const SYN: Record<Col, string[]> = {
  date: ['tanggal', 'tgl', 'date', 'waktu', 'tanggalbelanja'],
  item: ['bahan', 'namabahan', 'item', 'barang', 'namabarang', 'produk', 'nama', 'uraian'],
  category: ['kategori', 'jenis', 'category', 'kelompok'],
  qty: ['jumlah', 'qty', 'kuantitas', 'banyak', 'volume', 'jml'],
  unit: ['satuan', 'unit', 'sat'],
  price: ['harga', 'hargasatuan', 'hargaunit', 'price', 'unitprice', 'hargaperunit', 'hargapersatuan'],
  total: ['total', 'subtotal', 'jumlahharga', 'nilai', 'totalharga', 'amount', 'jumlahrp'],
  supplier: ['pemasok', 'supplier', 'toko', 'vendor', 'tokopemasok', 'belidi'],
  note: ['catatan', 'note', 'keterangan', 'ket'],
};
const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

export const TEMPLATE_ROWS: (string | number)[][] = [
  ['Tanggal', 'Bahan', 'Kategori', 'Jumlah', 'Satuan', 'Harga satuan', 'Total', 'Pemasok', 'Catatan'],
  ['2026-11-16', 'Mawar merah', 'Bunga segar', 50, 'tangkai', 4000, 200000, 'Pasar Bunga Medan', ''],
  ['2026-11-16', 'Kertas wrapping korea', 'Wrapping & kertas', 2, 'pak', 35000, 70000, 'Toko Sinar', '20 lembar/pak'],
];

function fnv(s: string, seed: number) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

export type ParsedPurchase = Omit<Purchase, 'created_at' | 'updated_at'> & { line: number };
export interface PurchaseParse { header: Partial<Record<Col, number>>; rows: ParsedPurchase[]; errors: { line: number; msg: string }[] }

/** Petakan baris spreadsheet. Baris judul dicari di 5 baris pertama; kolom wajib: bahan dan (harga atau total). */
export function mapPurchaseRows(rows: string[][], defaultDate: string, outletId?: string): PurchaseParse {
  let hi = -1, header: Partial<Record<Col, number>> = {};
  for (let r = 0; r < Math.min(5, rows.length); r++) {
    const h: Partial<Record<Col, number>> = {};
    rows[r].forEach((cell, i) => {
      const n = norm(cell);
      for (const col of Object.keys(SYN) as Col[]) if (h[col] === undefined && SYN[col].includes(n)) { h[col] = i; break; }
    });
    if (h.item !== undefined && (h.price !== undefined || h.total !== undefined)) { hi = r; header = h; break; }
  }
  const errors: PurchaseParse['errors'] = [];
  if (hi < 0) return { header, rows: [], errors: [{ line: 1, msg: 'Baris judul tidak dikenali. Wajib ada kolom "Bahan" dan "Harga satuan" atau "Total". Unduh template untuk contoh.' }] };
  const seen = new Map<string, number>();
  const out: ParsedPurchase[] = [];
  const get = (row: string[], c: Col) => (header[c] !== undefined ? String(row[header[c]!] ?? '').trim() : '');
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r], line = r + 1;
    if (row.some((c) => /^(sub ?total|total|jumlah|grand ?total)$/i.test(String(c ?? '').trim()))) continue; // baris rekap di bawah tabel
    const item = get(row, 'item');
    if (!item) { if (row.some((x) => String(x).trim())) errors.push({ line, msg: 'Nama bahan kosong' }); continue; }
    const dateRaw = get(row, 'date');
    const date = dateRaw ? parseDateCell(dateRaw) : defaultDate;
    if (!date) { errors.push({ line, msg: `Tanggal "${dateRaw}" tidak dikenali (pakai 2026-11-16 atau 16/11/2026)` }); continue; }
    const qtyRaw = get(row, 'qty');
    const qty = qtyRaw ? parseNum(qtyRaw) : 1;
    let price = get(row, 'price') ? parseMoney(get(row, 'price')) : NaN;
    let total = get(row, 'total') ? parseMoney(get(row, 'total')) : NaN;
    if (!(qty > 0)) { errors.push({ line, msg: `Jumlah "${qtyRaw}" tidak valid` }); continue; }
    if (Number.isNaN(total) && !Number.isNaN(price)) total = Math.round(qty * price);
    if (Number.isNaN(price) && !Number.isNaN(total)) price = Math.round(total / qty);
    if (!(total >= 0) || !(price >= 0)) { errors.push({ line, msg: 'Harga/total tidak terbaca' }); continue; }
    const supplier = get(row, 'supplier');
    const key = [date, item.toLowerCase(), qty, price, total, supplier.toLowerCase()].join('|');
    const k = (seen.get(key) || 0) + 1;
    seen.set(key, k);
    out.push({
      id: `bl-${fnv(key + '#' + k, 2166136261)}${fnv(key + '#' + k, 16777619)}`,
      date, item, category: get(row, 'category') || 'Lainnya', qty, unit: get(row, 'unit'), price, total, supplier, note: get(row, 'note'),
      outlet_id: outletId, source: 'impor', line,
    });
  }
  return { header, rows: out, errors };
}

export const sumTotal = (xs: Pick<Purchase, 'total'>[]) => xs.reduce((s, x) => s + (x.total || 0), 0);
