// Kode perangkat = huruf jenis + huruf fungsi; menjadi awalan nomor struk (mis. 261115-KK001).
import { Capacitor } from '@capacitor/core';

export type DeviceKind = 'K' | 'H' | 'T';
export type DeviceFn = 'K' | 'R' | 'O';
export const KIND_LABEL: Record<DeviceKind, string> = { K: 'Komputer', H: 'HP', T: 'Tablet' };
export const FN_LABEL: Record<DeviceFn, string> = { K: 'Kasir', R: 'Ruang Rangkai', O: 'Owner' };
export const KIND_OPTIONS = (Object.keys(KIND_LABEL) as DeviceKind[]).map((value) => ({ value, label: KIND_LABEL[value] }));
export const FN_OPTIONS = (Object.keys(FN_LABEL) as DeviceFn[]).map((value) => ({ value, label: FN_LABEL[value] }));

/** Tebakan jenis perangkat: layar sentuh kecil = HP, layar sentuh besar = tablet, selain itu komputer. */
export function guessKind(): DeviceKind {
  const touch = Capacitor.isNativePlatform() || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  if (!touch) return 'K';
  const short = Math.min(screen.width, screen.height);
  return short < 600 ? 'H' : 'T';
}

/** "KK2" -> "Komputer Kasir ke-2"; kode lama (mis. "A") dijelaskan sebagai kode versi lama. */
export function codeMeaning(code?: string | null): string {
  const m = String(code || '').match(/^([KHT])([KRO])(\d*)$/);
  if (!m) return 'kode versi lama, belum bermakna';
  return `${KIND_LABEL[m[1] as DeviceKind]} ${FN_LABEL[m[2] as DeviceFn]}${m[3] ? ` ke-${m[3]}` : ''}`;
}

export function splitCode(code?: string | null): { kind: DeviceKind; fn: DeviceFn } | null {
  const m = String(code || '').match(/^([KHT])([KRO])\d*$/);
  return m ? { kind: m[1] as DeviceKind, fn: m[2] as DeviceFn } : null;
}

/** Contoh nomor struk hari ini dari perangkat ini. */
export function sampleNo(code: string, d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${code}001`;
}
