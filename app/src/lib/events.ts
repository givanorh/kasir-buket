// Kalender event owner: event bawaan 2026 + analisis omzet harian (lonjakan) untuk mengaitkan event dengan penjualan.
// Tanggal libur nasional & cuti bersama 2026 mengikuti SKB 3 Menteri. Catatan angka diambil dari data toko
// (impor Kasir Pintar 26 Apr 2025 s.d. 15 Nov 2026); "×" = omzet hari itu ÷ median omzet harian ±14 hari di sekitarnya.
import type { CalEvent, EventKind, Order } from './types';

export const KIND_LABEL: Record<EventKind, string> = {
  libur: 'Libur nasional', momen: 'Momen buket', musim: 'Musim', lokal: 'Lokal', data: 'Lonjakan data', toko: 'Toko',
};

type Seed = Omit<CalEvent, 'id'> & { id: string };
const e = (id: string, date: string, name: string, kind: EventKind, note = '', end?: string): Seed => ({ id: `ev26-${id}`, date, end, name, kind, note });

export const DEFAULT_EVENTS_2026: Seed[] = [
  e('tahunbaru', '2026-01-01', 'Tahun Baru Masehi', 'libur', 'Bukan hari ramai: 1 Jan 2026 Rp 0,72 jt (0,8×).'),
  e('hutlangkat', '2026-01-17', 'HUT ke-276 Kabupaten Langkat', 'lokal', 'Menjelang HUT: 12 Jan Rp 2,31 jt (3,2×) dan 14 Jan Rp 2,12 jt (2,9×). 17 Jan toko tutup. Kaitan dengan acara HUT belum pasti.'),
  e('isramiraj', '2026-01-16', "Isra Mi'raj Nabi Muhammad SAW", 'libur'),
  e('valentine', '2026-02-12', 'Valentine', 'momen', 'Puncak terbesar tahun ini. 13 Feb Rp 11,82 jt (12,8×, 92 trx), 14 Feb Rp 19,68 jt (21,4×, 160 trx), 15 Feb Rp 4,73 jt (5,9×). Jumlah 12–15 Feb Rp 38,50 jt. Produk dominan buket cokelat: siapkan cokelat & boneka sejak awal Februari.', '2026-02-15'),
  e('imlek', '2026-02-16', 'Imlek 2577 (cuti bersama 16 Feb, libur 17 Feb)', 'libur', '17 Feb Rp 3,73 jt (4,1×), masih ekor Valentine (buket cokelat).', '2026-02-17'),
  e('ramadan', '2026-02-19', 'Ramadan 1447 H (perkiraan)', 'musim', 'Cenderung sepi: rata-rata Rp 0,97 jt/hari (0,89× 28 hari sebelumnya). Awal puasa menunggu sidang isbat.', '2026-03-20'),
  e('perempuan', '2026-03-08', 'Hari Perempuan Internasional', 'momen', '8 Mar (Minggu) toko tutup; 9 Mar Rp 2,76 jt (4,0×).'),
  e('lebaran-buketuang', '2026-03-11', 'Menjelang Idul Fitri: buket uang', 'musim', '11 Mar 3,8×, 12 Mar 3,1×, 16 Mar 2,2×, 19 Mar Rp 3,04 jt (2,9×, 6 buket uang). Siapkan uang pecahan baru & mika.', '2026-03-19'),
  e('nyepi', '2026-03-18', 'Nyepi (cuti bersama 18 Mar, libur 19 Mar)', 'libur', '', '2026-03-19'),
  e('idulfitri', '2026-03-20', 'Idul Fitri 1447 H & cuti bersama', 'libur', 'Libur 21–22 Mar, cuti bersama 20, 23, 24 Mar. Toko tutup 20–21 Mar.', '2026-03-24'),
  e('wafatyesus', '2026-04-03', 'Wafat Yesus Kristus', 'libur'),
  e('paskah', '2026-04-05', 'Paskah', 'libur'),
  e('kartini', '2026-04-18', 'Hari Kartini (21 Apr)', 'momen', '18 Apr (Sab) Rp 4,69 jt (3,1×, 33 trx), 21 Apr Rp 2,83 jt (1,8×). Pembelian untuk acara sekolah jatuh di akhir pekan sebelumnya.', '2026-04-21'),
  e('buruh', '2026-05-01', 'Hari Buruh Internasional', 'libur'),
  e('hardiknas', '2026-05-02', 'Hari Pendidikan Nasional', 'momen', 'Tidak ada lonjakan (0,3×).'),
  e('wisuda-mei', '2026-05-04', 'Musim kelulusan & wisuda sekolah', 'musim', 'Rata-rata Rp 2,71 jt/hari (1,75× 28 hari sebelumnya), jumlah Rp 75,9 jt. Puncak 5 Mei Rp 6,13 jt dan 25 Mei Rp 6,15 jt. Pola sama tahun 2025 (1,82×). Produk: thumbelina, edelweiss L, boneka wisuda.', '2026-05-31'),
  e('ibu-internasional', '2026-05-10', 'Hari Ibu Internasional (Mother’s Day)', 'momen', '10 Mei 2026 Minggu (tutup); 9 Mei Rp 2,53 jt (1,1×). Tahun 2025: 10 Mei Rp 4,76 jt (3,7×).'),
  e('kenaikan', '2026-05-14', 'Kenaikan Yesus Kristus (cuti bersama 15 Mei)', 'libur', '', '2026-05-15'),
  e('iduladha', '2026-05-27', 'Idul Adha 1447 H (cuti bersama 28 Mei)', 'libur', '', '2026-05-28'),
  e('waisak', '2026-05-31', 'Waisak 2570 BE', 'libur'),
  e('pancasila', '2026-06-01', 'Hari Lahir Pancasila', 'libur'),
  e('wisuda-juni', '2026-06-01', 'Perpisahan & wisuda TK–SD', 'musim', 'Rata-rata Rp 1,96 jt/hari: di bawah Mei (0,83×) tetapi di atas median tahunan Rp 1,67 jt. Puncak 15 Jun Rp 3,87 jt (2,0×) dan 25 Jun Rp 3,20 jt (2,2×).', '2026-06-27'),
  e('tahunbaruislam', '2026-06-16', 'Tahun Baru Islam 1448 H', 'libur'),
  e('anak', '2026-07-23', 'Hari Anak Nasional', 'momen', 'Tidak ada lonjakan (0,8×).'),
  e('awal-agustus', '2026-07-31', 'Puncak awal Agustus (penyebab belum diketahui)', 'data', 'Lonjakan terbesar kedua: 31 Jul Rp 5,80 jt (2,4×), 1 Agu Rp 21,85 jt (8,8×, 139 trx), 2 Agu Rp 6,59 jt (2,6×); jumlah Rp 34,24 jt. Berulang dari 2025: 1 Agu Rp 4,07 jt (5,8×), 4 Agu (3,8×). Kemungkinan wisuda/pelepasan sekolah atau kampus. Ganti nama bila penyebabnya diketahui.', '2026-08-02'),
  e('hutri', '2026-08-17', 'HUT ke-81 Republik Indonesia', 'libur', '2026: 17 Agu Rp 1,44 jt (0,6×). 2025: 16 Agu (3,5×).'),
  e('maulid', '2026-08-25', 'Maulid Nabi Muhammad SAW', 'libur'),
  e('awal-oktober', '2026-10-01', 'Lonjakan awal Oktober', 'data', '1 Okt Rp 3,83 jt (2,2×), 2 Okt (1,8×), 3 Okt Rp 4,04 jt (2,2×). Tidak terjadi 2025. Cek apakah ada wisuda kampus atau acara kantor.', '2026-10-03'),
  e('santri', '2026-10-22', 'Hari Santri Nasional', 'momen', 'Tidak ada lonjakan (1,0×).'),
  e('ayah', '2026-11-12', 'Hari Ayah Nasional', 'momen', '2026: Rp 2,75 jt (1,7×). 2025: Rp 1,91 jt (2,8×).'),
  e('guru', '2026-11-23', 'Hari Guru Nasional (25 Nov)', 'momen', 'Tahun 2025: 24 Nov Rp 6,23 jt (11,3×, 68 trx, buket boneka hari guru), 25 Nov Rp 2,91 jt (5,8×). Pembelian memuncak H-1 (Selasa 24 Nov 2026). Siapkan stok & perangkai sejak 21 Nov.', '2026-11-25'),
  e('ibu', '2026-12-20', 'Hari Ibu (22 Des)', 'momen', 'Tahun 2025: 20 Des (2,2×), 21 Des (2,7×), 22 Des Rp 7,61 jt (10,3×, 63 trx, edelweiss S & buket sabun). 22 Des 2026 jatuh hari Selasa.', '2026-12-22'),
  e('natal', '2026-12-24', 'Natal (cuti bersama 24 Des, libur 25 Des)', 'libur', 'Tahun 2025 tidak ramai: 24 Des 1,4×, 25 Des 0,5×.', '2026-12-25'),
];

// ---------- analisis omzet ----------
export interface Day { sales: number; count: number }
const pad = (n: number) => String(n).padStart(2, '0');
export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shift = (day: string, n: number) => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n); return localDay(d); };

/** Omzet harian (zona waktu perangkat). Transaksi ≥ `rekapMin` (mis. "Penjualan Cabang 2 Jun–Des") dibuang karena rekap, bukan penjualan hari itu. */
export function dailySales(orders: Order[], rekapMin = 10_000_000) {
  const days = new Map<string, Day>();
  let first = '', last = '';
  for (const o of orders) {
    if (o.void || o.deleted || !o.created_at || o.total >= rekapMin) continue;
    const k = localDay(new Date(o.created_at));
    const d = days.get(k) || { sales: 0, count: 0 };
    d.sales += o.total; d.count++;
    days.set(k, d);
    if (!first || k < first) first = k;
    if (!last || k > last) last = k;
  }
  return { days, first, last };
}
export type Daily = ReturnType<typeof dailySales>;

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const inSpan = (dl: Daily, day: string) => !!dl.first && day >= dl.first && day <= dl.last;

/** Median omzet harian ±`r` hari di sekitar `day` (tanpa hari itu; hari tanpa transaksi = 0). */
export function baselineAround(dl: Daily, day: string, r = 14) {
  const xs: number[] = [];
  for (let i = -r; i <= r; i++) {
    if (!i) continue;
    const k = shift(day, i);
    if (inSpan(dl, k)) xs.push(dl.days.get(k)?.sales || 0);
  }
  return median(xs);
}

export interface EventStat { covered: boolean; sales: number; count: number; days: number; peak?: { day: string; sales: number; ratio: number }; avgRatio?: number }

/** Omzet selama event: jumlah, hari puncak & rasionya, serta rasio rata-rata harian terhadap median 28 hari sebelum event (untuk event ≥ 7 hari). */
export function eventStat(ev: Pick<CalEvent, 'date' | 'end'>, dl: Daily): EventStat {
  const end = ev.end && ev.end >= ev.date ? ev.end : ev.date;
  let sales = 0, count = 0, days = 0, covered = false;
  let peak: EventStat['peak'];
  for (let k = ev.date; k <= end; k = shift(k, 1)) {
    days++;
    if (!inSpan(dl, k)) continue;
    covered = true;
    const d = dl.days.get(k);
    sales += d?.sales || 0; count += d?.count || 0;
    if (d && (!peak || d.sales > peak.sales)) peak = { day: k, sales: d.sales, ratio: 0 };
    if (days > 400) break;
  }
  if (peak) { const b = baselineAround(dl, peak.day); peak.ratio = b ? peak.sales / b : 0; }
  let avgRatio: number | undefined;
  if (covered && days >= 7) {
    const pre: number[] = [];
    for (let i = 1; i <= 28; i++) { const k = shift(ev.date, -i); if (inSpan(dl, k)) pre.push(dl.days.get(k)?.sales || 0); }
    const b = median(pre);
    avgRatio = b ? sales / days / b : undefined;
  }
  return { covered, sales, count, days, peak, avgRatio };
}

/** Hari dengan omzet ≥ `minRatio` × median sekitarnya dan ≥ 1,5 × median harian tahun itu. */
export function spikeDays(dl: Daily, year: number, minRatio = 2.5) {
  const ys = [...dl.days.entries()].filter(([k]) => k.startsWith(String(year)));
  const yMed = median(ys.map(([, v]) => v.sales));
  return ys
    .map(([day, v]) => { const b = baselineAround(dl, day); return { day, sales: v.sales, count: v.count, ratio: b ? v.sales / b : 0 }; })
    .filter((x) => x.ratio >= minRatio && x.sales >= 1.5 * yMed)
    .sort((a, b) => a.day.localeCompare(b.day));
}

export const covers = (ev: Pick<CalEvent, 'date' | 'end'>, day: string, pad1 = 0) => day >= shift(ev.date, -pad1) && day <= shift(ev.end || ev.date, pad1);
export const shiftDay = shift;
