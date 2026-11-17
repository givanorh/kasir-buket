// Akun pegawai di perangkat (koleksi `staff`, cermin dari server) dan daftar perangkai yang bisa ditunjuk.
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { storeCfg } from './settings';
import { floristList, type Florist } from './rules';
import { save } from './store';
import type { Order } from './types';

/** Perangkai yang bisa ditunjuk: akun berperan Perangkai (tab Staff), atau nama lama dari Pengaturan bila belum ada akun. */
export function useFlorists(): Florist[] {
  const staff = useLiveQuery(() => db.staff.toArray(), []) || [];
  const settings = useLiveQuery(() => db.settings.get('toko'));
  return floristList(staff, storeCfg(settings).florists);
}

/** Tunjuk (atau lepas) perangkai pesanan. Notifikasi Tugas ke email perangkai dikirim server. */
export function assignFlorist(order: Order, f: Florist | null) {
  return save<Order>('orders', order.id, { florist: f?.name || '', florist_id: f?.id || null });
}
