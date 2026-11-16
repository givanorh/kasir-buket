import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REVIEW_TIERS, budgetLeft, budgetSuggestion, monthKey, reviewTiers, reviewUsage, tierAmount, tierOffer } from '../src/lib/review';
import { storeCfg } from '../src/lib/settings';
import type { ReviewTier } from '../src/lib/types';

test('diskon ulasan: pengaturan lama (min/maks) diturunkan menjadi kolom', () => {
  const cfg = storeCfg({ id: 'toko' } as any).engage;
  assert.equal(cfg.review_budget, 250000);
  assert.equal(cfg.review_min_spend, 50000);
  assert.deepEqual(reviewTiers(cfg).map((t) => t.value), [5000, 7500, 10000]);
  assert.equal(reviewTiers(cfg), DEFAULT_REVIEW_TIERS);
  // owner v1.4 mengatur 4.000–12.000 → 4.000 / 8.000 / 12.000
  assert.deepEqual(reviewTiers({ review_discount_min: 4000, review_discount_max: 12000 }).map((t) => t.value), [4000, 8000, 12000]);
  // kolom yang sudah diatur (termasuk daftar kosong) dipakai apa adanya
  assert.deepEqual(reviewTiers({ review_tiers: [], review_discount_min: 5000, review_discount_max: 10000 }), []);
});

test('diskon ulasan: nominal dan persen dengan batas maksimal', () => {
  const pct: ReviewTier = { id: 'p', label: 'Ulasan + foto', type: 'persen', value: 5, max: 15000 };
  assert.equal(tierAmount(pct, 141_685), 7000); // 141.685 × 5% = 7.084,25 → ke bawah kelipatan 100 = 7.000
  assert.equal(tierAmount(pct, 500_000), 15000); // 25.000 dibatasi maks 15.000
  assert.equal(tierAmount({ id: 'r', label: 'x', type: 'rp', value: 10000 }, 6000), 6000); // tidak melebihi belanja
});

test('diskon ulasan: budget bulanan, sisa, dan kolom yang diblokir', () => {
  const m = monthKey(new Date(2026, 10, 16));
  const orders = [
    { created_at: new Date(2026, 10, 2, 10).toISOString(), review_discount: 10000 },
    { created_at: new Date(2026, 10, 5, 10).toISOString(), review_discount: 7500 },
    { created_at: new Date(2026, 10, 6, 10).toISOString(), review_discount: 5000, void: true }, // void tidak dihitung
    { created_at: new Date(2026, 9, 31, 22).toISOString(), review_discount: 10000 }, // bulan lalu
    { created_at: new Date(2026, 10, 7, 10).toISOString(), review_discount: 0 },
  ];
  const u = reviewUsage(orders, m);
  assert.deepEqual(u, { count: 2, used: 17500 });
  assert.equal(budgetLeft(250000, u.used), 232500);
  assert.equal(budgetLeft(0, u.used), Infinity);
  const t10: ReviewTier = { id: 'a', label: 'foto', type: 'rp', value: 10000 };
  assert.deepEqual(tierOffer(t10, 150000, 8000, 50000), { amount: 10000, block: 'budget' });
  assert.deepEqual(tierOffer(t10, 40000, 100000, 50000), { amount: 10000, block: 'belanja' });
  assert.deepEqual(tierOffer({ ...t10, active: false }, 150000, 100000, 50000), { amount: 10000, block: 'nonaktif' });
  assert.deepEqual(tierOffer(t10, 150000, 10000, 50000), { amount: 10000, block: null });
});

test('diskon ulasan: saran budget dari 12 bulan penuh terakhir', () => {
  const now = new Date(2026, 10, 16);
  const orders: { created_at: string; total: number; void?: boolean }[] = [];
  // 12 bulan (Nov 2025–Okt 2026), 380 transaksi/bulan @ Rp 140.000
  for (let k = 0; k < 12; k++) for (let i = 0; i < 380; i++) orders.push({ created_at: new Date(2025, 10 + k, 1 + (i % 28), 12).toISOString(), total: 140000 });
  orders.push({ created_at: new Date(2026, 5, 3).toISOString(), total: 25_000_000 }); // rekap ≥ 10 jt dibuang
  orders.push({ created_at: new Date(2026, 10, 3).toISOString(), total: 140000 }); // bulan berjalan dibuang
  orders.push({ created_at: new Date(2026, 4, 3).toISOString(), total: 140000, void: true });
  const s = budgetSuggestion(orders, now, 5, DEFAULT_REVIEW_TIERS)!;
  assert.equal(s.months, 12);
  assert.equal(s.perMonth, 380);
  assert.equal(s.offers, 76); // 380 ÷ 5
  assert.equal(s.avgDisc, 7500); // (5.000 + 7.500 + 10.000) ÷ 3
  assert.equal(s.raw, 228000); // 76 × 0,4 × 7.500
  assert.equal(s.budget, 250000); // ke atas kelipatan 50.000
  assert.equal(budgetSuggestion([], now, 5, DEFAULT_REVIEW_TIERS), null);
});
