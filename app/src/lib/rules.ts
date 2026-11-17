// Aturan murni (tanpa I/O) supaya mudah diuji: wewenang status produksi per peran, dan pesan galat perantara (tunnel).
import type { Order, ProductionStatus, Role } from './types';

/**
 * Siapa boleh memindah status produksi (v1.7).
 * Antri → Dirangkai → Siap: perangkai (dan owner). Siap → Selesai ("Sudah diambil"): kasir/Admin (dan owner), hanya bila sisa tagihan 0.
 */
export function canSetStatus(role: Role | undefined, order: Pick<Order, 'void' | 'production_status'>, to: ProductionStatus, due: number): boolean {
  if (order.void || order.production_status === to) return false;
  if (role === 'owner') return to !== 'selesai' || due === 0;
  if (role === 'perangkai') return to === 'antri' || to === 'dirangkai' || to === 'siap';
  if (role === 'kasir') return to === 'selesai' && order.production_status === 'siap' && due === 0;
  return false;
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
