// Perhitungan murni (tanpa I/O) supaya mudah diuji: total keranjang, laporan, shift.
import type { CashMove, LoyaltyCfg, Order, OrderItem, Payment, Shift } from './types';

export interface CartTotals {
  subtotal: number; item_discount: number; order_discount: number; extra_fee: number; total: number; cost_total: number; qty: number;
}

/** total = Σ(qty×harga) − Σ potongan baris − potongan transaksi + biaya tambahan */
export function cartTotals(items: OrderItem[], orderDiscount = 0, extraFee = 0): CartTotals {
  let subtotal = 0, itemDisc = 0, cost = 0, qty = 0;
  for (const it of items) {
    subtotal += it.qty * it.price;
    itemDisc += it.discount || 0;
    cost += it.qty * (it.cost || 0);
    qty += it.qty;
  }
  const base = subtotal - itemDisc;
  const od = Math.min(Math.max(0, orderDiscount), Math.max(0, base));
  const fee = Math.max(0, extraFee);
  return { subtotal, item_discount: itemDisc, order_discount: od, extra_fee: fee, total: base - od + fee, cost_total: cost, qty };
}

export const paidOf = (orderId: string, payments: Payment[]) =>
  payments.filter((p) => p.order_id === orderId && !p.void).reduce((s, p) => s + p.amount, 0);

export function paymentStatus(total: number, paid: number): 'lunas' | 'dp' | 'belum' {
  if (paid >= total) return 'lunas';
  return paid > 0 ? 'dp' : 'belum';
}

export interface ReportInput {
  orders: Order[];
  payments: Payment[];
  cashMoves: CashMove[];
  from: Date;
  to: Date;
  outletId?: string;
}

export interface Report {
  count: number;
  qty: number;
  gross: number; // Σ qty × harga
  discount: number; // potongan baris + transaksi
  extraFee: number;
  netSales: number; // penjualan bersih = gross − discount + extraFee
  cogs: number; // HPP
  grossProfit: number; // netSales − HPP
  expenses: number; // beban (kas keluar kategori biaya)
  netProfit: number; // grossProfit − expenses
  paidForPeriodOrders: number; // pembayaran yang sudah masuk untuk transaksi periode ini
  outstandingForPeriodOrders: number; // sisa tagihan transaksi periode ini
  cashIn: { method: string; amount: number; count: number }[]; // arus kas masuk (basis kas)
  cashInTotal: number;
  byProduct: { name: string; qty: number; sales: number; cogs: number; profit: number }[];
  byCashier: { name: string; count: number; sales: number }[];
  byHour: { hour: number; count: number; sales: number }[];
  voided: number;
}

const inRange = (iso: string | undefined, a: number, b: number) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= a && t <= b;
};

export function buildReport(inp: ReportInput): Report {
  const a = inp.from.getTime(), b = inp.to.getTime();
  const outletOk = (o: { outlet_id?: string }) => !inp.outletId || o.outlet_id === inp.outletId;
  const all = inp.orders.filter((o) => outletOk(o) && inRange(o.created_at, a, b));
  const orders = all.filter((o) => !o.void);
  const payByOrder = new Map<string, number>();
  for (const p of inp.payments) if (!p.void) payByOrder.set(p.order_id, (payByOrder.get(p.order_id) || 0) + p.amount);

  const r: Report = {
    count: orders.length, qty: 0, gross: 0, discount: 0, extraFee: 0, netSales: 0, cogs: 0, grossProfit: 0, expenses: 0, netProfit: 0,
    paidForPeriodOrders: 0, outstandingForPeriodOrders: 0, cashIn: [], cashInTotal: 0, byProduct: [], byCashier: [], byHour: [], voided: all.length - orders.length,
  };
  const prod = new Map<string, Report['byProduct'][number]>();
  const cash = new Map<string, Report['byCashier'][number]>();
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, sales: 0 }));

  for (const o of orders) {
    r.gross += o.subtotal;
    r.discount += o.item_discount + o.order_discount;
    r.extraFee += o.extra_fee;
    r.netSales += o.total;
    r.cogs += o.cost_total;
    const paid = Math.min(payByOrder.get(o.id) || 0, o.total);
    r.paidForPeriodOrders += paid;
    r.outstandingForPeriodOrders += o.total - paid;
    for (const it of o.items) {
      r.qty += it.qty;
      const k = it.product_id || it.name;
      const p = prod.get(k) || { name: it.name, qty: 0, sales: 0, cogs: 0, profit: 0 };
      p.qty += it.qty;
      p.sales += it.qty * it.price - (it.discount || 0);
      p.cogs += it.qty * (it.cost || 0);
      p.profit = p.sales - p.cogs;
      prod.set(k, p);
    }
    const cn = o.cashier_name || '-';
    const c = cash.get(cn) || { name: cn, count: 0, sales: 0 };
    c.count++; c.sales += o.total;
    cash.set(cn, c);
    const h = hours[new Date(o.created_at!).getHours()];
    h.count++; h.sales += o.total;
  }
  r.grossProfit = r.netSales - r.cogs;

  for (const m of inp.cashMoves) {
    if (m.deleted || !outletOk(m) || !inRange(m.created_at, a, b)) continue;
    if (m.type === 'keluar' && m.biaya) r.expenses += m.amount;
  }
  r.netProfit = r.grossProfit - r.expenses;

  const methods = new Map<string, { method: string; amount: number; count: number }>();
  for (const p of inp.payments) {
    if (p.void || !outletOk(p) || !inRange(p.created_at, a, b)) continue;
    const m = methods.get(p.method) || { method: p.method, amount: 0, count: 0 };
    m.amount += p.amount; m.count++;
    methods.set(p.method, m);
    r.cashInTotal += p.amount;
  }
  r.cashIn = [...methods.values()].sort((x, y) => y.amount - x.amount);
  r.byProduct = [...prod.values()].sort((x, y) => y.sales - x.sales);
  r.byCashier = [...cash.values()].sort((x, y) => y.sales - x.sales);
  r.byHour = hours.filter((h) => h.count > 0);
  return r;
}

export interface ShiftSummary {
  opening: number; cashSales: number; cashIn: number; cashOut: number; expected: number; nonCash: { method: string; amount: number }[];
}

/** Kas seharusnya = kas awal + pembayaran tunai + kas masuk tunai − kas keluar tunai */
export function shiftSummary(shift: Shift, payments: Payment[], moves: CashMove[]): ShiftSummary {
  const ps = payments.filter((p) => p.shift_id === shift.id && !p.void);
  const cashSales = ps.filter((p) => p.method === 'Tunai').reduce((s, p) => s + p.amount, 0);
  const non = new Map<string, number>();
  for (const p of ps) if (p.method !== 'Tunai') non.set(p.method, (non.get(p.method) || 0) + p.amount);
  const ms = moves.filter((m) => m.shift_id === shift.id && !m.deleted && m.method === 'Tunai');
  const cashIn = ms.filter((m) => m.type === 'masuk').reduce((s, m) => s + m.amount, 0);
  const cashOut = ms.filter((m) => m.type === 'keluar').reduce((s, m) => s + m.amount, 0);
  return {
    opening: shift.opening_cash, cashSales, cashIn, cashOut,
    expected: shift.opening_cash + cashSales + cashIn - cashOut,
    nonCash: [...non.entries()].map(([method, amount]) => ({ method, amount })),
  };
}

/** Jumlah buket terjadwal per tanggal (untuk kontrol kapasitas hari ramai). */
export function scheduledQtyOn(orders: Order[], dayKeyStr: string, dayKeyFn: (iso: string) => string) {
  let n = 0;
  for (const o of orders) {
    if (o.void || !o.due_at || o.production_status === 'batal') continue;
    if (dayKeyFn(o.due_at) !== dayKeyStr) continue;
    for (const it of o.items) if ((it.type || 'buket') === 'buket') n += it.qty;
  }
  return n;
}

// ---------------- loyalty ----------------

/** Poin didapat = ⌊(total − ongkir) / earn_per⌋ × earn_points. */
export function pointsEarned(total: number, extraFee: number, cfg: LoyaltyCfg): number {
  if (!cfg.enabled || cfg.earn_per <= 0) return 0;
  return Math.floor(Math.max(0, total - extraFee) / cfg.earn_per) * cfg.earn_points;
}

export interface CustomerStats {
  count: number; spend: number; avg: number; spend12m: number; first: string; last: string; due: number;
  earned: number; redeemed: number; balance: number; tier: 'Bronze' | 'Silver' | 'Gold';
  favorites: { name: string; qty: number }[]; occasions: { label: string; n: number }[];
}

export function customerStats(customerId: string, orders: Order[], paid: Map<string, number>, cfg: LoyaltyCfg, now = new Date()): CustomerStats {
  const yearAgo = new Date(now); yearAgo.setFullYear(now.getFullYear() - 1);
  const s: CustomerStats = { count: 0, spend: 0, avg: 0, spend12m: 0, first: '', last: '', due: 0, earned: 0, redeemed: 0, balance: 0, tier: 'Bronze', favorites: [], occasions: [] };
  const fav = new Map<string, number>(), occ = new Map<string, number>();
  for (const o of orders) {
    if (o.void || o.customer_id !== customerId) continue;
    s.count++; s.spend += o.total;
    if ((o.created_at || '') >= yearAgo.toISOString()) s.spend12m += o.total;
    if (!s.first || (o.created_at || '') < s.first) s.first = o.created_at || '';
    if ((o.created_at || '') > s.last) s.last = o.created_at || '';
    s.due += Math.max(0, o.total - (paid.get(o.id) || 0));
    s.earned += o.points_earned || 0;
    s.redeemed += o.points_redeemed || 0;
    for (const it of o.items) fav.set(it.name, (fav.get(it.name) || 0) + it.qty);
    const oc = o.survey && Object.values(o.survey)[1];
    if (oc) occ.set(oc, (occ.get(oc) || 0) + 1);
  }
  s.avg = s.count ? Math.round(s.spend / s.count) : 0;
  s.balance = s.earned - s.redeemed;
  s.tier = s.spend12m >= cfg.tier_gold ? 'Gold' : s.spend12m >= cfg.tier_silver ? 'Silver' : 'Bronze';
  s.favorites = [...fav.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, qty]) => ({ name, qty }));
  s.occasions = [...occ.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n }));
  return s;
}

// ---------------- analisis penjualan (owner) ----------------
export interface Analysis {
  daily: { day: string; sales: number; count: number }[];
  weekday: { day: number; sales: number; count: number }[];
  repeatRate: number; // % pelanggan dengan ≥ 2 transaksi
  customersKnown: number;
  avgBasket: number;
  delivery: { count: number; fees: number; avgKm: number };
  review: { count: number; discount: number };
  survey: { q: string; answers: { label: string; n: number }[] }[];
  florists: { name: string; orders: number; items: number }[];
  pointsRedeemed: number;
  pointsDiscount: number;
}

export function buildAnalysis(orders: Order[], from: Date, to: Date, dayKeyFn: (iso: string) => string, questions: string[], outletId?: string): Analysis {
  const a = from.getTime(), b = to.getTime();
  const xs = orders.filter((o) => !o.void && (!outletId || o.outlet_id === outletId) && inRange(o.created_at, a, b));
  const daily = new Map<string, { day: string; sales: number; count: number }>();
  for (let d = new Date(from); d.getTime() <= b; d.setDate(d.getDate() + 1)) daily.set(dayKeyFn(d.toISOString()), { day: dayKeyFn(d.toISOString()), sales: 0, count: 0 });
  const weekday = Array.from({ length: 7 }, (_, day) => ({ day, sales: 0, count: 0 }));
  const perCust = new Map<string, number>();
  const surveys = questions.map((q) => ({ q, m: new Map<string, number>() }));
  const flor = new Map<string, { name: string; orders: number; items: number }>();
  const r: Analysis = { daily: [], weekday, repeatRate: 0, customersKnown: 0, avgBasket: 0, delivery: { count: 0, fees: 0, avgKm: 0 }, review: { count: 0, discount: 0 }, survey: [], florists: [], pointsRedeemed: 0, pointsDiscount: 0 };
  let kmSum = 0, total = 0;
  for (const o of xs) {
    const k = dayKeyFn(o.created_at!);
    const d = daily.get(k) || { day: k, sales: 0, count: 0 };
    d.sales += o.total; d.count++; daily.set(k, d);
    const w = weekday[new Date(o.created_at!).getDay()]; w.sales += o.total; w.count++;
    total += o.total;
    if (o.customer_id) perCust.set(o.customer_id, (perCust.get(o.customer_id) || 0) + 1);
    if (o.fulfillment === 'antar') { r.delivery.count++; r.delivery.fees += o.extra_fee; kmSum += o.delivery?.km || 0; }
    if (o.review_discount) { r.review.count++; r.review.discount += o.review_discount; }
    r.pointsRedeemed += o.points_redeemed || 0;
    r.pointsDiscount += o.points_discount || 0;
    if (o.survey) surveys.forEach((s) => { const ans = o.survey![s.q]; if (ans) s.m.set(ans, (s.m.get(ans) || 0) + 1); });
    if (o.florist) {
      const f = flor.get(o.florist) || { name: o.florist, orders: 0, items: 0 };
      f.orders++; f.items += o.items.reduce((s, i) => s + i.qty, 0);
      flor.set(o.florist, f);
    }
  }
  r.daily = [...daily.values()].sort((x, y) => x.day.localeCompare(y.day));
  r.customersKnown = perCust.size;
  r.repeatRate = perCust.size ? ([...perCust.values()].filter((n) => n >= 2).length / perCust.size) * 100 : 0;
  r.avgBasket = xs.length ? Math.round(total / xs.length) : 0;
  r.delivery.avgKm = r.delivery.count ? Math.round((kmSum / r.delivery.count) * 10) / 10 : 0;
  r.survey = surveys.map((s) => ({ q: s.q, answers: [...s.m.entries()].sort((x, y) => y[1] - x[1]).map(([label, n]) => ({ label, n })) }));
  r.florists = [...flor.values()].sort((x, y) => y.orders - x.orders);
  return r;
}
