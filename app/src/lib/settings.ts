// Nilai bawaan pengaturan toko. Pengaturan lama yang belum punya kolom baru tetap berjalan dengan nilai ini.
import type { DeliveryCfg, EngageCfg, LoyaltyCfg, Settings, SurveyQuestion } from './types';
import { DEFAULT_REVIEW_BUDGET, DEFAULT_REVIEW_MIN_SPEND } from './review';

export const DEFAULT_FLORISTS = ['Iin Ruslinda', 'Nazra', 'Fira', 'Mirna'];
export const DEFAULT_DELIVERY: DeliveryCfg = { rate: 3000, min: 15000, round: 1000 };
export const DEFAULT_LOYALTY: LoyaltyCfg = {
  enabled: true, earn_per: 10000, earn_points: 1, point_value: 100, min_redeem: 50, tier_silver: 1_000_000, tier_gold: 3_000_000,
};

/**
 * Bank 20 pertanyaan riset pasar (market intelligence) untuk toko buket. Pop-up mengambil 1–2 secara acak,
 * sehingga tiap pelanggan cukup menjawab sedikit, tetapi seluruh topik terisi seiring waktu.
 * Dua pertanyaan pertama memakai teks yang sama dengan versi 1.2 agar jawaban lama tetap terhitung.
 */
export const DEFAULT_SURVEY: SurveyQuestion[] = [
  { id: 'sumber', q: 'Dari mana tahu toko kami?', options: ['Instagram', 'TikTok', 'Google Maps', 'Teman/keluarga', 'Lewat depan toko', 'Lainnya'] },
  { id: 'acara', q: 'Buket ini untuk acara apa?', options: ['Wisuda', 'Ulang tahun', 'Anniversary', 'Valentine', 'Lamaran/nikah', 'Lainnya'] },
  { id: 'penerima', q: 'Buket ini untuk siapa?', options: ['Pasangan', 'Teman', 'Keluarga', 'Guru/dosen', 'Rekan kerja', 'Diri sendiri'] },
  { id: 'budget', q: 'Biasanya menyiapkan budget berapa untuk satu buket?', options: ['< 100 rb', '100–200 rb', '200–350 rb', '350–500 rb', '> 500 rb'] },
  { id: 'frekuensi', q: 'Berapa kali membeli buket dalam setahun?', options: ['1 kali', '2–3 kali', '4–6 kali', '> 6 kali'] },
  { id: 'alasan', q: 'Alasan utama memilih toko kami?', options: ['Harga', 'Desain', 'Kualitas bunga', 'Cepat jadi', 'Lokasi dekat', 'Rekomendasi'] },
  { id: 'minat', q: 'Jenis buket apa yang ingin lebih banyak pilihannya?', options: ['Bunga segar', 'Bunga artifisial', 'Buket uang', 'Buket snack', 'Boneka', 'Hampers'] },
  { id: 'kanal', q: 'Paling nyaman memesan lewat?', options: ['Datang langsung', 'WhatsApp', 'Instagram DM', 'TikTok Shop', 'Shopee/Tokopedia'] },
  { id: 'pesaing', q: 'Pernah membeli buket di tempat lain?', options: ['Toko lain di Stabat', 'Binjai/Medan', 'Toko online', 'Belum pernah'] },
  { id: 'kapan', q: 'Biasanya memesan buket kapan?', options: ['Hari H', 'H-1', 'H-2 s.d. H-3', 'Seminggu sebelum'] },
  { id: 'tunggu', q: 'Waktu tunggu buket yang masih wajar?', options: ['< 30 menit', '30–60 menit', '1–2 jam', 'Pesan H-1 saja'] },
  { id: 'antar', q: 'Seberapa sering butuh layanan antar?', options: ['Selalu', 'Kadang-kadang', 'Tidak perlu'] },
  { id: 'medsos', q: 'Media sosial yang paling sering dibuka?', options: ['Instagram', 'TikTok', 'Facebook', 'WhatsApp', 'YouTube'] },
  { id: 'bayar', q: 'Cara bayar yang paling disukai?', options: ['Tunai', 'QRIS', 'Transfer bank', 'Dompet digital'] },
  { id: 'puas', q: 'Seberapa puas dengan pelayanan hari ini?', options: ['Sangat puas', 'Puas', 'Biasa saja', 'Kurang puas'] },
  { id: 'rekomendasi', q: 'Akan merekomendasikan kami ke teman?', options: ['Pasti', 'Mungkin', 'Belum tahu', 'Tidak'] },
  { id: 'domisili', q: 'Tinggal di mana?', options: ['Stabat', 'Kecamatan lain di Langkat', 'Binjai', 'Medan', 'Lainnya'] },
  { id: 'usia', q: 'Kelompok usia?', options: ['< 18', '18–24', '25–34', '35–44', '≥ 45'] },
  { id: 'tambahan', q: 'Produk tambahan yang ingin dibeli bersama buket?', options: ['Kartu ucapan', 'Cokelat', 'Boneka', 'Balon', 'Kue', 'Tidak ada'] },
  { id: 'promo', q: 'Promo yang paling menarik?', options: ['Diskon harga', 'Gratis ongkir', 'Poin member', 'Bonus kartu/pita', 'Paket hemat'] },
];

export const DEFAULT_ENGAGE: EngageCfg = {
  enabled: true,
  every_n: 5,
  review_url: '',
  review_discount_min: 5000,
  review_discount_max: 10000,
  review_budget: DEFAULT_REVIEW_BUDGET,
  review_min_spend: DEFAULT_REVIEW_MIN_SPEND,
  survey: DEFAULT_SURVEY,
  per_popup: 2,
};

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tanya';

/**
 * Bank pertanyaan efektif. Data v1.2 (tanpa id, hanya 2 pertanyaan) dinaikkan: pertanyaan yang teksnya sama
 * dengan bawaan memakai id bawaan; pertanyaan buatan owner dipertahankan di depan, lalu bank bawaan.
 */
export function surveyBank(saved?: Partial<SurveyQuestion>[] | null): SurveyQuestion[] {
  if (!saved?.length) return DEFAULT_SURVEY;
  if (saved.every((x) => x.id)) return saved as SurveyQuestion[];
  const custom = saved
    .filter((x) => x.q && !DEFAULT_SURVEY.some((d) => d.q === x.q))
    .map((x) => ({ id: `q-${slug(x.q!)}`, q: x.q!, options: x.options || [], active: x.active }));
  return [...custom, ...DEFAULT_SURVEY];
}

/** Ambil `n` pertanyaan aktif secara acak (Fisher–Yates parsial). `rnd` bisa diganti untuk pengujian. */
export function pickSurvey(bank: SurveyQuestion[], n: number, rnd: () => number = Math.random): SurveyQuestion[] {
  const pool = bank.filter((q) => q.active !== false && q.q.trim() && q.options.length >= 2);
  const k = Math.max(0, Math.min(n, pool.length));
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rnd() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, k);
}

/** Jawaban satu pertanyaan pada satu transaksi (mendukung kunci lama berupa teks pertanyaan). */
export const answerOf = (survey: Record<string, string> | undefined, q: Pick<SurveyQuestion, 'id' | 'q'>) => survey?.[q.id] ?? survey?.[q.q] ?? '';

/** Bawaan dua laci kas (v1.9): laci kasir hanya untuk kembalian, laci meja kamar = kas kecil untuk kas keluar/masuk. */
export const DEFAULT_DRAWER_FLOAT = 1_000_000;
export const DEFAULT_PETTY_TARGET = 500_000;
/** Kategori kas kecil yang selalu tersedia, ditambah kategori kas keluar dari Pengaturan › Toko. */
export const PETTY_CATEGORIES = ['Uang sampah', 'Sumbangan', 'Pembelian darurat'];
export const PETTY_TOPUP = 'Isi ulang kas kecil';

export interface StoreCfg { florists: string[]; delivery: DeliveryCfg; loyalty: LoyaltyCfg; engage: EngageCfg; methods: string[]; drawerFloat: number; pettyTarget: number }

export function storeCfg(st?: Settings | null): StoreCfg {
  return {
    florists: st?.florists?.length ? st.florists : DEFAULT_FLORISTS,
    delivery: { ...DEFAULT_DELIVERY, ...(st?.delivery || {}) },
    loyalty: { ...DEFAULT_LOYALTY, ...(st?.loyalty || {}) },
    engage: { ...DEFAULT_ENGAGE, ...(st?.engagement || {}), survey: surveyBank(st?.engagement?.survey) },
    methods: st?.payment_methods?.length ? st.payment_methods : ['Tunai', 'QRIS', 'Transfer'],
    drawerFloat: st?.drawer_float && st.drawer_float > 0 ? st.drawer_float : DEFAULT_DRAWER_FLOAT,
    pettyTarget: st?.petty?.target && st.petty.target > 0 ? st.petty.target : DEFAULT_PETTY_TARGET,
  };
}
