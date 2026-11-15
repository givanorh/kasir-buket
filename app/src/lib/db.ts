// Basis data lokal (IndexedDB via Dexie). Aplikasi selalu membaca/menulis ke sini dulu (offline-first),
// lalu mesin sinkron mengirim/menarik perubahan ke server di latar belakang.
import Dexie, { type Table } from 'dexie';
import { COLLECTIONS } from './types';
import type {
  CashMove, Category, Customer, Device, Order, Outlet, Payment, PrintJob, Product, Settings, Shift, Staff, StockMove,
} from './types';

export interface OutboxEntry { seq?: number; c: string; id: string; patch: Record<string, unknown>; del?: boolean; ts: number }
export interface MetaEntry { k: string; v: unknown }

export class KasirDB extends Dexie {
  meta!: Table<MetaEntry, string>;
  outbox!: Table<OutboxEntry, number>;
  outlets!: Table<Outlet, string>;
  staff!: Table<Staff, string>;
  devices!: Table<Device, string>;
  settings!: Table<Settings, string>;
  categories!: Table<Category, string>;
  products!: Table<Product, string>;
  customers!: Table<Customer, string>;
  orders!: Table<Order, string>;
  payments!: Table<Payment, string>;
  stock_moves!: Table<StockMove, string>;
  shifts!: Table<Shift, string>;
  cash_moves!: Table<CashMove, string>;
  print_jobs!: Table<PrintJob, string>;

  constructor(name = 'kasir-buket') {
    super(name);
    this.version(1).stores({
      meta: 'k',
      outbox: '++seq, [c+id]',
      outlets: 'id',
      staff: 'id',
      devices: 'id',
      settings: 'id',
      categories: 'id',
      products: 'id, category_id, name',
      customers: 'id, phone, name',
      orders: 'id, no, created_at, due_at, customer_id, production_status',
      payments: 'id, order_id, created_at, shift_id',
      stock_moves: 'id, product_id, created_at',
      shifts: 'id, opened_at, device_id',
      cash_moves: 'id, shift_id, created_at',
      print_jobs: 'id, status, target, created_at',
    });
  }
}

export const db = new KasirDB();

/** Kosongkan semua data bisnis lokal (dipakai saat perangkat pindah ke server/basis data lain). */
export async function resetLocalData() {
  await db.transaction('rw', [db.outbox, db.meta, ...COLLECTIONS.map((c) => db.table(c))], async () => {
    for (const c of COLLECTIONS) await db.table(c).clear();
    await db.outbox.clear();
    await db.meta.bulkDelete(['cursor', 'sync_errors']);
  });
}

export async function getMeta<T>(k: string, fallback: T): Promise<T> {
  const r = await db.meta.get(k);
  return r === undefined ? fallback : (r.v as T);
}
export async function setMeta(k: string, v: unknown) {
  await db.meta.put({ k, v });
}
