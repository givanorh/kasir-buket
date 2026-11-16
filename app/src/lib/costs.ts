// Gaji & biaya operasional (owner): alokasi ke periode laporan, THR, dan perhitungan HPP penuh per buket.
// Semua nilai uang = bilangan bulat Rupiah. Biaya bulanan dialokasikan per bulan kalender secara proporsional hari:
// alokasi = nilai per bulan × (hari periode di bulan itu ÷ jumlah hari bulan itu). Satu bulan penuh = tepat nilai bulanannya.
import type { CostFreq, CostGroup, CostItem, StaffRole } from './types';

export const FREQ_LABEL: Record<CostFreq, string> = { bulan: 'per bulan', n_bulan: 'tiap N bulan', tahun: 'per tahun', sekali: 'sekali', persen: '% penjualan' };
export const GROUP_LABEL: Record<CostGroup, string> = { tunjangan: 'Bonus', utilitas: 'Utilitas', perawatan: 'Perawatan', operasional: 'Operasional', kas: 'Kas laci' };
export const ROLE_LABEL_STAFF: Record<StaffRole, string> = { perangkai: 'Perangkai', admin: 'Admin', lain: 'Lainnya' };

const pegawai = (id: string, name: string, role: StaffRole, salary: number, sort: number): CostItem =>
  ({ id: `cost-p-${id}`, kind: 'pegawai', name, role, salary, bonus_year: 0, active: true, sort });
const biaya = (id: string, name: string, group: CostGroup, freq: CostFreq, sort: number, extra: Partial<CostItem> = {}): CostItem =>
  ({ id: `cost-b-${id}`, kind: 'biaya', name, group, freq, amount: 0, pl: group !== 'kas', active: true, sort, ...extra });

/**
 * Isian awal (dibuat sekali bila belum ada data gaji/biaya). Gaji sesuai data owner (Nov 2026):
 * 1.400.000 + 1.500.000 + 1.400.000 + 1.400.000 + 1.000.000 + 1.000.000 + 1.000.000 = Rp 8.700.000 per bulan.
 * Nilai biaya lain Rp 0 sampai diisi owner.
 */
export const DEFAULT_COSTS: CostItem[] = [
  pegawai('iin', 'Iin', 'perangkai', 1_400_000, 1),
  pegawai('fira', 'Fira', 'perangkai', 1_500_000, 2),
  pegawai('nazra', 'Nazra', 'perangkai', 1_400_000, 3),
  pegawai('tiara', 'Tiara', 'admin', 1_400_000, 4),
  pegawai('mirna', 'Mirna', 'perangkai', 1_000_000, 5),
  pegawai('putri', 'Putri', 'admin', 1_000_000, 6),
  pegawai('ririn', 'Ririn', 'admin', 1_000_000, 7),
  { id: 'cost-thr', kind: 'thr', name: 'THR', mult: 1, active: true, sort: 0, note: 'Permenaker 6/2016: masa kerja ≥ 12 bulan = 1 bulan upah; 1–12 bulan = masa kerja ÷ 12 × upah; dibayar paling lambat H-7 hari raya.' },
  biaya('bonus', 'Bonus tambahan', 'tunjangan', 'tahun', 10, { note: 'Lembur hari ramai (Valentine, wisuda, Hari Guru) atau target. Pilih "sekali" + tanggal bila dibayar sekaligus.' }),
  biaya('listrik', 'Listrik', 'utilitas', 'bulan', 20),
  biaya('air', 'Air PDAM/galon', 'utilitas', 'bulan', 21),
  biaya('internet', 'Internet & pulsa', 'utilitas', 'bulan', 22),
  biaya('ac', 'Servis AC', 'perawatan', 'n_bulan', 30, { every: 3 }),
  biaya('printer', 'Servis printer', 'perawatan', 'n_bulan', 31, { every: 6 }),
  biaya('komputer', 'Servis komputer', 'perawatan', 'tahun', 32),
  biaya('lampu', 'Pembelian lampu', 'perawatan', 'n_bulan', 33, { every: 6 }),
  biaya('jajan', 'Jajan dadakan', 'operasional', 'bulan', 40, { note: 'Konsumsi pegawai/tamu yang tidak terduga.' }),
  biaya('bbm', 'BBM & parkir antar', 'operasional', 'bulan', 41),
  biaya('kebersihan', 'Kebersihan & keamanan', 'operasional', 'bulan', 42),
  biaya('sewa', 'Sewa tempat', 'operasional', 'tahun', 43),
  biaya('admin-bank', 'Biaya admin bank/QRIS', 'operasional', 'persen', 44, { pct: 0 }),
  biaya('tak-terduga', 'Perbaikan tak terduga', 'operasional', 'bulan', 45),
  biaya('standby', 'Uang standby di laci', 'kas', 'sekali', 50, { pl: false, note: 'Uang kembalian di laci adalah modal kerja yang berputar, bukan beban: tidak mengurangi laba.' }),
];

const DAY = 86400e3;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const atNoon = (k: string) => new Date(k + 'T12:00:00');
const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** Pecahan bulan kalender yang tercakup [a, b] (tanggal lokal, inklusif). */
export function monthSlices(a: string, b: string): { y: number; m: number; frac: number; days: number }[] {
  if (!a || !b || a > b) return [];
  const out: { y: number; m: number; frac: number; days: number }[] = [];
  const s = atNoon(a), e = atNoon(b);
  let y = s.getFullYear(), m = s.getMonth();
  for (let guard = 0; guard < 600; guard++) {
    const first = new Date(y, m, 1, 12), last = new Date(y, m, daysIn(y, m), 12);
    const lo = s > first ? s : first, hi = e < last ? e : last;
    if (lo <= hi) {
      const days = Math.round((hi.getTime() - lo.getTime()) / DAY) + 1;
      out.push({ y, m, days, frac: days / daysIn(y, m) });
    }
    if (last >= e) break;
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}

/** Irisan [a, b] dengan masa aktif [start, end] (opsional). */
function clip(a: string, b: string, start?: string, end?: string): [string, string] {
  return [start && start > a ? start : a, end && end < b ? end : b];
}
const spread = (monthly: number, a: string, b: string, start?: string, end?: string) => {
  const [lo, hi] = clip(a, b, start, end);
  return monthSlices(lo, hi).reduce((s, x) => s + monthly * x.frac, 0);
};

/** Bulan kerja penuh dari `start` sampai `asOf` (tanggal lokal). */
export function monthsWorked(start: string | undefined, asOf: string): number {
  if (!start) return Infinity;
  const s = atNoon(start), t = atNoon(asOf);
  let n = (t.getFullYear() - s.getFullYear()) * 12 + (t.getMonth() - s.getMonth());
  if (t.getDate() < s.getDate()) n--;
  return Math.max(0, n);
}

/** THR setahun satu pegawai: masa kerja ≥ 12 bulan = pengali × gaji; 1–11 bulan = masa kerja ÷ 12 × pengali × gaji; < 1 bulan = 0. */
export function thrOf(p: CostItem, asOf: string, mult = 1): number {
  const n = monthsWorked(p.start, asOf);
  if (n < 1) return 0;
  return Math.round((p.salary || 0) * mult * Math.min(1, n / 12));
}

/** Nilai per bulan (untuk biaya tetap & titik impas). Biaya "sekali" dan "% penjualan" tidak termasuk. */
export function monthlyOf(c: CostItem): number {
  if (c.kind !== 'biaya' || c.active === false) return 0;
  const a = c.amount || 0;
  if (c.freq === 'bulan') return a;
  if (c.freq === 'n_bulan') return a / Math.max(1, c.every || 1);
  if (c.freq === 'tahun') return a / 12;
  return 0;
}

export interface CostLine { id: string; name: string; cat: 'gaji' | 'thr' | 'bonus' | CostGroup; amount: number; pl: boolean; role?: StaffRole }
export interface CostAlloc {
  lines: CostLine[];
  gaji: number; gajiPerangkai: number; tunjangan: number; operasional: number; kas: number; total: number;
  monthlyFixed: number; // biaya tetap per bulan (gaji + THR/12 + bonus/12 + biaya rutin)
}

/**
 * Alokasi gaji & biaya ke periode [from, to] (tanggal lokal). `omzet` = penjualan bersih periode (untuk biaya persen).
 * Biaya tahunan (THR, bonus tahunan, biaya per tahun) dibagi rata per bulan (akrual), sehingga laba bulanan tidak melonjak di bulan bayar.
 */
export function allocCosts(items: CostItem[], from: Date, to: Date, omzet = 0): CostAlloc {
  const a = ymd(from), b = ymd(to);
  const live = items.filter((c) => !c.deleted && c.active !== false);
  const staff = live.filter((c) => c.kind === 'pegawai');
  const thrRule = live.find((c) => c.kind === 'thr');
  const lines: CostLine[] = [];
  let monthlyFixed = 0;
  for (const p of staff) {
    const g = Math.round(spread(p.salary || 0, a, b, p.start, p.end));
    lines.push({ id: p.id, name: `Gaji ${p.name}`, cat: 'gaji', amount: g, pl: true, role: p.role });
    monthlyFixed += p.end && p.end < b ? 0 : p.salary || 0;
    if (thrRule) {
      const thr = thrOf(p, b, thrRule.mult ?? 1);
      const v = Math.round(spread(thr / 12, a, b, p.start, p.end));
      if (v) lines.push({ id: `${p.id}-thr`, name: `THR ${p.name}`, cat: 'thr', amount: v, pl: true, role: p.role });
      monthlyFixed += p.end && p.end < b ? 0 : thr / 12;
    }
    if (p.bonus_year) {
      const v = Math.round(spread(p.bonus_year / 12, a, b, p.start, p.end));
      if (v) lines.push({ id: `${p.id}-bonus`, name: `Bonus tahunan ${p.name}`, cat: 'bonus', amount: v, pl: true, role: p.role });
      monthlyFixed += p.end && p.end < b ? 0 : p.bonus_year / 12;
    }
  }
  for (const c of live.filter((x) => x.kind === 'biaya')) {
    const pl = c.pl !== false && c.group !== 'kas';
    let v = 0;
    if (c.group === 'kas') v = c.amount || 0; // saldo, bukan aliran
    else if (c.freq === 'sekali') v = c.date && c.date >= a && c.date <= b ? c.amount || 0 : 0;
    else if (c.freq === 'persen') v = ((c.pct || 0) / 100) * omzet;
    else v = spread(monthlyOf(c), a, b);
    v = Math.round(v);
    if (pl) monthlyFixed += monthlyOf(c);
    lines.push({ id: c.id, name: c.name, cat: c.group || 'operasional', amount: v, pl });
  }
  const sum = (f: (l: CostLine) => boolean) => lines.filter(f).reduce((s, l) => s + l.amount, 0);
  const gaji = sum((l) => l.cat === 'gaji');
  const gajiPerangkai = sum((l) => (l.cat === 'gaji' || l.cat === 'thr' || l.cat === 'bonus') && l.role === 'perangkai');
  const tunjangan = sum((l) => l.pl && (l.cat === 'thr' || l.cat === 'bonus' || l.cat === 'tunjangan'));
  const operasional = sum((l) => l.pl && (l.cat === 'utilitas' || l.cat === 'perawatan' || l.cat === 'operasional'));
  const kas = sum((l) => l.cat === 'kas');
  return { lines, gaji, gajiPerangkai, tunjangan, operasional, kas, total: gaji + tunjangan + operasional, monthlyFixed: Math.round(monthlyFixed) };
}

/**
 * HPP penuh per buket = (HPP bahan + tenaga kerja + overhead) ÷ buket terjual.
 * Titik impas per bulan = biaya tetap per bulan ÷ (harga rata-rata − bahan per buket).
 */
export function hppPerBuket(x: { buketQty: number; buketSales: number; cogs: number; labor: number; overhead: number; monthlyFixed: number }) {
  const q = x.buketQty;
  const per = (v: number) => (q ? v / q : 0);
  const bahan = per(x.cogs), tk = per(x.labor), oh = per(x.overhead);
  const full = bahan + tk + oh;
  const price = per(x.buketSales);
  const contrib = price - bahan;
  return { bahan, tk, oh, full, price, margin: price - full, marginPct: price ? ((price - full) / price) * 100 : 0, bep: contrib > 0 ? Math.ceil(x.monthlyFixed / contrib) : null };
}
