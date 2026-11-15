// Nilai bawaan pengaturan toko. Pengaturan lama yang belum punya kolom baru tetap berjalan dengan nilai ini.
import type { DeliveryCfg, EngageCfg, LoyaltyCfg, Settings } from './types';

export const DEFAULT_FLORISTS = ['Iin Ruslinda', 'Nazra', 'Fira', 'Mirna'];
export const DEFAULT_DELIVERY: DeliveryCfg = { rate: 3000, min: 15000, round: 1000 };
export const DEFAULT_LOYALTY: LoyaltyCfg = {
  enabled: true, earn_per: 10000, earn_points: 1, point_value: 100, min_redeem: 50, tier_silver: 1_000_000, tier_gold: 3_000_000,
};
export const DEFAULT_ENGAGE: EngageCfg = {
  enabled: true,
  every_n: 5,
  review_url: '',
  review_discount_min: 5000,
  review_discount_max: 10000,
  survey: [
    { q: 'Dari mana tahu toko kami?', options: ['Instagram', 'TikTok', 'Google Maps', 'Teman/keluarga', 'Lewat depan toko', 'Lainnya'] },
    { q: 'Buket ini untuk acara apa?', options: ['Wisuda', 'Ulang tahun', 'Anniversary', 'Valentine', 'Lamaran/nikah', 'Lainnya'] },
  ],
};

export interface StoreCfg { florists: string[]; delivery: DeliveryCfg; loyalty: LoyaltyCfg; engage: EngageCfg; methods: string[] }

export function storeCfg(st?: Settings | null): StoreCfg {
  return {
    florists: st?.florists?.length ? st.florists : DEFAULT_FLORISTS,
    delivery: { ...DEFAULT_DELIVERY, ...(st?.delivery || {}) },
    loyalty: { ...DEFAULT_LOYALTY, ...(st?.loyalty || {}) },
    engage: { ...DEFAULT_ENGAGE, ...(st?.engagement || {}), survey: st?.engagement?.survey?.length ? st.engagement.survey : DEFAULT_ENGAGE.survey },
    methods: st?.payment_methods?.length ? st.payment_methods : ['Tunai', 'QRIS', 'Transfer'],
  };
}
