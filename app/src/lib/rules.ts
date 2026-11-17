// Aturan murni (tanpa I/O) supaya mudah diuji: peran akun, penunjukan perangkai, wewenang status produksi,
// dan pesan galat perantara (tunnel).
import type { Order, ProductionStatus, Role } from './types';

/** Semua peran akun. Owner tunggal; akun lama tanpa `roles` memakai `role`. */
export function rolesOf(u?: { role?: Role; roles?: Role[] } | null): Role[] {
  if (!u?.role) return [];
  if (u.role === 'owner') return ['owner'];
  return u.roles?.length ? u.roles : [u.role];
}

/** Perangkai yang bisa ditunjuk. `id` kosong = nama lama dari Pengaturan (belum ada akunnya). */
export interface Florist { id?: string; name: string }

const norm = (s?: string | null) => String(s || '').trim().toLowerCase();
const first = (s?: string | null) => norm(s).split(/\s+/)[0] || '';

/**
 * Daftar perangkai (v1.10) = akun aktif berperan Perangkai (tab Staff). Bila belum ada akun perangkai sama sekali,
 * dipakai daftar nama lama dari Pengaturan (tanpa id) agar toko tetap jalan sebelum akun dibuat.
 */
export function floristList(staff: { id: string; name: string; role?: Role; roles?: Role[]; active?: boolean; deleted?: boolean }[], legacyNames: string[]): Florist[] {
  const acc = staff.filter((s) => !s.deleted && s.active !== false && rolesOf(s).includes('perangkai'))
    .map((s) => ({ id: s.id, name: s.name })).sort((a, b) => a.name.localeCompare(b.name, 'id'));
  return acc.length ? acc : legacyNames.map((name) => ({ name }));
}

/** Nama perangkai cocok bila sama persis atau kata pertamanya sama ("Iin" = "Iin Ruslinda"). */
export function matchFlorist(name: string | undefined | null, list: Florist[]): Florist | undefined {
  if (!norm(name)) return undefined;
  return list.find((f) => norm(f.name) === norm(name)) || list.find((f) => first(f.name) === first(name));
}

/**
 * Akun yang ditunjuk merangkai pesanan: id akun; `null` = belum ditunjuk; `undefined` = nama lama tanpa akun.
 */
export function assigneeOf(order: Pick<Order, 'florist' | 'florist_id'>, list: Florist[]): string | null | undefined {
  if (order.florist_id) return order.florist_id;
  if (!norm(order.florist)) return null;
  return matchFlorist(order.florist, list)?.id;
}

/** Pesanan yang wajib punya perangkai sebelum dirangkai (Ready tidak dirangkai). */
export const needsFlorist = (o: Pick<Order, 'fulfillment' | 'void' | 'production_status'>) =>
  !o.void && o.fulfillment !== 'sekarang' && (o.production_status === 'antri' || o.production_status === 'dirangkai');

/**
 * Siapa boleh memindah status produksi (v1.10).
 * - Antri ⇄ Dirangkai ⇄ Siap: hanya akun perangkai yang ditunjuk. Belum ditunjuk = tidak ada yang bisa (tunjuk dulu).
 *   Nama lama tanpa akun: akun berperan Perangkai. Pesanan Ready lama di antrean: perangkai atau owner.
 * - Siap → Selesai ("Sudah diambil"): Admin (kasir) atau owner, hanya bila sisa tagihan 0. Owner juga dari status lain.
 * - Selesai → Siap (koreksi salah tekan): owner.
 */
export function canSetStatus(
  me: { id?: string; role?: Role; roles?: Role[] } | undefined | null,
  order: Pick<Order, 'void' | 'production_status' | 'fulfillment'>,
  to: ProductionStatus, due: number, assignee?: string | null,
): boolean {
  if (!me || order.void || order.production_status === to || to === 'batal') return false;
  const rs = rolesOf(me);
  const owner = rs.includes('owner'), kasir = rs.includes('kasir'), perangkai = rs.includes('perangkai');
  if (to === 'selesai') return due === 0 && (owner || (kasir && order.production_status === 'siap'));
  if (order.production_status === 'selesai') return owner && to === 'siap';
  if (order.fulfillment === 'sekarang' && !assignee) return perangkai || owner;
  if (assignee === null) return false;
  if (assignee === undefined) return perangkai;
  return !!me.id && me.id === assignee;
}

/** Pesan untuk balasan non-JSON dari perantara (tunnel). Kode ngrok dibaca dari header `ngrok-error-code` atau isi halaman. */
export function proxyMessage(status: number, code: string | null, text: string): string {
  const c = code || text.match(/ERR_NGROK_\d+/)?.[0] || '';
  if (c === 'ERR_NGROK_3200') return `Tunnel ngrok sedang mati (${c}). Jalankan lagi ngrok di PC toko, lalu coba ulang.`;
  if (c === 'ERR_NGROK_8012') return `ngrok berjalan tetapi server Kasir Buket di PC toko mati atau beda port (${c}). Jalankan jalankan-lokal-windows.bat.`;
  if (c) return `Ditolak perantara ngrok (${c}, status ${status}).`;
  if (/cloudflare/i.test(text)) return `Ditolak perantara Cloudflare (status ${status}). Periksa tunnel di PC toko.`;
  return `Server tidak menjawab dengan benar (status ${status}). Kemungkinan tunnel/perantara atau server toko sedang mati.`;
}
