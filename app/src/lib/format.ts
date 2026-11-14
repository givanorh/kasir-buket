// Format angka & waktu (zona waktu mengikuti perangkat, umumnya WIB).
export const rp = (n: number | undefined | null) =>
  'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

export const num = (n: number | undefined | null) => Math.round(Number(n) || 0).toLocaleString('id-ID');

/** Ubah teks "150.000" / "150000" / "150rb" menjadi bilangan. */
export function parseRp(s: string): number {
  const t = String(s).toLowerCase().replace(/\s/g, '');
  const m = t.match(/^([\d.,]+)(rb|k|jt)?$/);
  if (!m) return Number(t.replace(/\D/g, '')) || 0;
  const base = Number(m[1].replace(/[.,]/g, '')) || 0;
  return m[2] === 'jt' ? base * 1_000_000 : m[2] ? base * 1000 : base;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Kunci tanggal lokal YYYY-MM-DD. */
export function dayKey(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
export function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function fmtDate(iso?: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
}
export function fmtTime(iso?: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtDateTime(iso?: string | null) {
  if (!iso) return '-';
  return `${fmtDate(iso)} ${fmtTime(iso)}`;
}
export function fmtShort(iso?: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${fmtTime(iso)}`;
}

/** Nilai untuk <input type="datetime-local">. */
export function toLocalInput(iso?: string | Date | null) {
  const d = iso ? new Date(iso) : new Date();
  return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(v: string) {
  return v ? new Date(v).toISOString() : null;
}
