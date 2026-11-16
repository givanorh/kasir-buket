// Diskon ulasan Google Maps: kolom diskon (nominal/persen), belanja minimal, dan budget per bulan kalender.
import type { EngageCfg, Order, ReviewTier } from './types';

/** Kolom bawaan v1.5, setara min/tengah/maks v1.2–1.4 (Rp 5.000 / 7.500 / 10.000). */
export const DEFAULT_REVIEW_TIERS: ReviewTier[] = [
  { id: 'rt-bintang', label: 'Ulasan bintang', type: 'rp', value: 5000 },
  { id: 'rt-komentar', label: 'Ulasan + komentar', type: 'rp', value: 7500 },
  { id: 'rt-foto', label: 'Ulasan + foto buket', type: 'rp', value: 10000 },
];

/**
 * Budget bawaan Rp 250.000/bulan. Dasar hitung (data toko Nov 2025–Okt 2026, tanpa void dan rekap ≥ Rp 10 jt):
 * 4.571 transaksi ÷ 12 = 380,9 transaksi/bulan; pop-up tiap 5 transaksi → 76,2 tawaran/bulan;
 * asumsi 40% menerima → 30,47 ulasan × rata-rata Rp 7.500 = Rp 228.550, dibulatkan ke atas Rp 250.000.
 */
export const DEFAULT_REVIEW_BUDGET = 250_000;
export const DEFAULT_REVIEW_MIN_SPEND = 50_000;

/** Kolom diskon efektif. Pengaturan lama (hanya min/maks) diturunkan menjadi 1–3 kolom nominal. */
export function reviewTiers(E: Pick<EngageCfg, 'review_tiers' | 'review_discount_min' | 'review_discount_max'>): ReviewTier[] {
  if (Array.isArray(E.review_tiers)) return E.review_tiers;
  const min = E.review_discount_min || 0, max = E.review_discount_max || 0;
  if (min === 5000 && max === 10000) return DEFAULT_REVIEW_TIERS;
  const steps = [min, Math.round((min + max) / 2 / 500) * 500, max].filter((v, i, a) => v > 0 && a.indexOf(v) === i);
  return steps.map((value, i) => ({ id: `rt-${i + 1}`, label: `Diskon ulasan ${i + 1}`, type: 'rp' as const, value }));
}

/** Nominal diskon satu kolom untuk belanja `base`. Persen dibulatkan ke bawah kelipatan Rp 100, lalu dibatasi `max` dan `base`. */
export function tierAmount(t: ReviewTier, base: number): number {
  const raw = t.type === 'persen' ? Math.floor((base * t.value) / 100 / 100) * 100 : t.value;
  const capped = t.type === 'persen' && t.max && t.max > 0 ? Math.min(raw, t.max) : raw;
  return Math.max(0, Math.min(capped, base));
}

/** Kunci bulan kalender menurut zona waktu perangkat, mis. "2026-11". */
export function monthKey(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
}

/** Awal bulan (ISO) untuk kueri indeks `created_at`. */
export const monthStartIso = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1).toISOString();

/** Pemakaian diskon ulasan pada satu bulan: jumlah transaksi dan nominal (transaksi void tidak dihitung). */
export function reviewUsage(orders: Pick<Order, 'created_at' | 'void' | 'review_discount'>[], month: string) {
  let count = 0, used = 0;
  for (const o of orders) {
    if (o.void || !o.review_discount || !o.created_at || monthKey(o.created_at) !== month) continue;
    count++;
    used += o.review_discount;
  }
  return { count, used };
}

/** Sisa budget; `Infinity` bila budget 0 (tanpa batas). */
export const budgetLeft = (budget: number, used: number) => (budget > 0 ? Math.max(0, budget - used) : Infinity);

export type TierBlock = 'nonaktif' | 'belanja' | 'budget' | null;

/** Kolom yang bisa ditawarkan kasir: aktif, belanja ≥ minimal, dan nominal ≤ sisa budget. */
export function tierOffer(t: ReviewTier, base: number, left: number, minSpend: number): { amount: number; block: TierBlock } {
  const amount = tierAmount(t, base);
  if (t.active === false || amount <= 0) return { amount, block: 'nonaktif' };
  if (base < minSpend) return { amount, block: 'belanja' };
  if (amount > left) return { amount, block: 'budget' };
  return { amount, block: null };
}

/** Teks ringkas nilai kolom, mis. "Rp 7.500" atau "5% (maks Rp 15.000)". */
export function tierText(t: ReviewTier, rp: (n: number) => string): string {
  if (t.type === 'rp') return rp(t.value);
  const pct = `${t.value.toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;
  return t.max ? `${pct} (maks ${rp(t.max)})` : pct;
}

export const REVIEW_ACCEPT_RATE = 0.4; // asumsi: 40% pelanggan yang ditawari mau memberi ulasan

/**
 * Saran budget dari data 12 bulan kalender penuh terakhir (tanpa void dan rekap ≥ Rp 10 jt):
 * transaksi/bulan ÷ frekuensi pop-up × tingkat terima × rata-rata diskon kolom aktif, dibulatkan ke atas Rp 50.000.
 */
export function budgetSuggestion(
  orders: Pick<Order, 'created_at' | 'void' | 'total'>[], now: Date, everyN: number, tiers: ReviewTier[], accept = REVIEW_ACCEPT_RATE,
) {
  const end = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const start = new Date(now.getFullYear(), now.getMonth() - 12, 1).getTime();
  const rows = orders.filter((o) => {
    const t = new Date(o.created_at || 0).getTime();
    return !!o.created_at && !o.void && (o.total || 0) < 10_000_000 && t >= start && t < end;
  });
  const months = new Set(rows.map((o) => monthKey(o.created_at!))).size;
  if (!months) return null;
  const perMonth = rows.length / months;
  const avgBasket = rows.reduce((s, o) => s + (o.total || 0), 0) / rows.length;
  const active = tiers.filter((t) => t.active !== false);
  const avgDisc = active.length ? active.reduce((s, t) => s + tierAmount(t, avgBasket), 0) / active.length : 0;
  const offers = perMonth / Math.max(1, everyN);
  const raw = Math.round(offers * accept * avgDisc); // Rupiah bulat
  return { months, trx: rows.length, perMonth, offers, avgBasket, avgDisc, accept, raw, budget: Math.ceil(raw / 50_000) * 50_000 };
}
