// Operasi data tingkat-domain. Semua tulis lewat save() → tabel lokal + outbox → sinkron otomatis.
import { db, getMeta, setMeta } from './db';
import { getSession } from './session';
import { sync } from './sync';
import { cartTotals, paidOf } from './calc';
import type {
  CashMove, Collection, Customer, Fulfillment, Order, OrderItem, Payment, PrintJob, PrintTarget, ProductionStatus, Shift, StockMove,
} from './types';

export function newId(prefix = '') {
  const t = Date.now().toString(36);
  const r = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join('');
  return `${prefix}${t}${r}`;
}

const nowIso = () => new Date().toISOString();

/** Tulis lokal + antre ke server. `patch` digabung ke rekaman yang ada (per kolom). */
export async function save<T extends object>(c: Collection, id: string, patch: Partial<T>): Promise<void> {
  const table = db.table(c);
  await db.transaction('rw', table, db.outbox, async () => {
    const cur = await table.get(id);
    const ts = nowIso();
    const p: Record<string, unknown> = { ...patch };
    if (!cur && !p.created_at) p.created_at = ts;
    await table.put({ ...(cur || {}), ...p, id, updated_at: ts });
    await db.outbox.add({ c, id, patch: p, ts: Date.now() });
  });
  sync.schedulePush();
}

export async function saveMany(items: { c: Collection; id: string; patch: Record<string, unknown> }[]) {
  const tables = [...new Set(items.map((i) => i.c))].map((c) => db.table(c));
  await db.transaction('rw', [...tables, db.outbox], async () => {
    const ts = nowIso();
    for (const it of items) {
      const table = db.table(it.c);
      const cur = await table.get(it.id);
      const p = { ...it.patch };
      if (!cur && !p.created_at) p.created_at = ts;
      await table.put({ ...(cur || {}), ...p, id: it.id, updated_at: ts });
      await db.outbox.add({ c: it.c, id: it.id, patch: p, ts: Date.now() });
    }
  });
  sync.schedulePush();
}

// ---------------- konfigurasi perangkat (lokal, tidak disinkronkan) ----------------
export type PrinterMode = 'none' | 'bluetooth' | 'lan' | 'system' | 'relay';
export interface PrinterConfig { mode: PrinterMode; address?: string; name?: string; host?: string; port?: number; width: 58 | 80; copies: number }
export interface DeviceConfig {
  outletId: string;
  printers: Record<PrinterTarget, PrinterConfig>;
  stationTargets: PrinterTarget[]; // target relay yang dicetak otomatis oleh perangkat ini
  autoPrint: boolean;
}
type PrinterTarget = PrintTarget;

export const DEFAULT_DEVICE_CONFIG: DeviceConfig = {
  outletId: 'outlet-utama',
  printers: {
    kasir: { mode: 'system', width: 58, copies: 1, port: 9100 },
    produksi: { mode: 'relay', width: 80, copies: 1, port: 9100 },
  },
  stationTargets: [],
  autoPrint: true,
};

let deviceConfigCache: DeviceConfig | null = null;
export async function getDeviceConfig(): Promise<DeviceConfig> {
  if (!deviceConfigCache) {
    const c = await getMeta<DeviceConfig | null>('device_config', null);
    deviceConfigCache = c ? { ...DEFAULT_DEVICE_CONFIG, ...c, printers: { ...DEFAULT_DEVICE_CONFIG.printers, ...c.printers } } : DEFAULT_DEVICE_CONFIG;
  }
  return deviceConfigCache;
}
export async function setDeviceConfig(c: DeviceConfig) {
  deviceConfigCache = c;
  await setMeta('device_config', c);
  window.dispatchEvent(new Event('device-config'));
}

// ---------------- nomor transaksi ----------------
/** Format: YYMMDD-<kode perangkat><urut 3 digit>, unik walau offline karena kode perangkat unik. */
export async function nextOrderNo(date = new Date()): Promise<string> {
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${String(date.getFullYear()).slice(2)}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  const code = getSession().device?.code || 'X';
  const key = `orderseq:${day}:${code}`;
  let seq = (await getMeta<number>(key, 0)) + 1;
  const prefix = `${day}-${code}`;
  const existing = await db.orders.where('no').startsWith(prefix).toArray();
  for (const o of existing) {
    // hanya nomor milik perangkat ini: "261115-KK2001" (perangkat KK2) juga berawalan "261115-KK"
    if (o.device_id && o.device_id !== getSession().deviceId) continue;
    const m = o.no.slice(prefix.length).match(/^\d{3,}$/);
    if (m) seq = Math.max(seq, Number(m[0]) + 1);
  }
  await setMeta(key, seq);
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

// ---------------- shift ----------------
export async function activeShift(): Promise<Shift | undefined> {
  const s = getSession();
  const list = await db.shifts.where('device_id').equals(s.deviceId).toArray();
  return list.filter((x) => !x.closed_at && !x.deleted).sort((a, b) => b.opened_at.localeCompare(a.opened_at))[0];
}

// ---------------- checkout ----------------
export interface CheckoutInput {
  items: OrderItem[];
  orderDiscount: number;
  extraFee: number;
  customer: { id?: string | null; name: string; phone: string };
  fulfillment: Fulfillment;
  dueAt: string | null;
  recipientName: string;
  recipientPhone: string;
  deliveryAddress: string;
  cardMessage: string;
  notes: string;
  payMethod: string;
  payAmount: number; // nominal yang dicatat sebagai pembayaran (≤ total)
  cashReceived: number; // uang diterima (tunai), untuk kembalian
  florist?: string;
  delivery?: Order['delivery'];
  manualDiscount?: number;
  pointsRedeemed?: number;
  pointsDiscount?: number;
  reviewDiscount?: number;
  survey?: Record<string, string>;
  pointsEarned?: number;
}

export async function checkout(inp: CheckoutInput): Promise<Order> {
  const s = getSession();
  const cfg = await getDeviceConfig();
  const shift = await activeShift();
  const t = cartTotals(inp.items, inp.orderDiscount, inp.extraFee);
  const ts = nowIso();
  const writes: { c: Collection; id: string; patch: Record<string, unknown> }[] = [];

  // pelanggan: pakai yang ada (berdasar nomor HP) atau buat baru bila nama/HP diisi
  let customerId = inp.customer.id || null;
  const phone = inp.customer.phone.replace(/[^\d+]/g, '');
  if (!customerId && phone) customerId = (await db.customers.where('phone').equals(phone).first())?.id || null;
  if (!customerId && (inp.customer.name.trim() || phone)) {
    customerId = newId('c');
    writes.push({ c: 'customers', id: customerId, patch: { name: inp.customer.name.trim() || phone, phone } satisfies Partial<Customer> });
  }

  const payAmount = Math.max(0, Math.min(inp.payAmount, t.total));
  const orderId = newId('o');
  const order: Order = {
    id: orderId,
    no: await nextOrderNo(),
    outlet_id: cfg.outletId,
    device_id: s.deviceId,
    cashier_id: s.user?.id,
    cashier_name: s.user?.name,
    shift_id: shift?.id || null,
    customer_id: customerId,
    customer_name: inp.customer.name.trim(),
    customer_phone: phone,
    items: inp.items,
    ...t,
    cash_received: inp.payMethod === 'Tunai' ? inp.cashReceived : payAmount,
    change: inp.payMethod === 'Tunai' ? Math.max(0, inp.cashReceived - payAmount) : 0,
    fulfillment: inp.fulfillment,
    due_at: inp.fulfillment === 'sekarang' ? ts : inp.dueAt,
    recipient_name: inp.recipientName,
    recipient_phone: inp.recipientPhone,
    delivery_address: inp.deliveryAddress,
    card_message: inp.cardMessage,
    notes: inp.notes,
    production_status: 'antri',
    source: 'app',
    created_at: ts,
    florist: inp.florist || '',
    delivery: inp.fulfillment === 'antar' ? inp.delivery || null : null,
    manual_discount: inp.manualDiscount || 0,
    points_redeemed: customerId ? inp.pointsRedeemed || 0 : 0,
    points_discount: customerId ? inp.pointsDiscount || 0 : 0,
    review_discount: inp.reviewDiscount || 0,
    survey: inp.survey && Object.keys(inp.survey).length ? inp.survey : undefined,
    points_earned: customerId ? inp.pointsEarned || 0 : 0,
  };
  delete (order as any).qty;
  writes.push({ c: 'orders', id: orderId, patch: order as any });

  if (payAmount > 0) {
    const pay: Omit<Payment, 'id'> = {
      order_id: orderId, outlet_id: cfg.outletId, method: inp.payMethod, amount: payAmount,
      kind: payAmount >= t.total ? 'lunas' : 'dp', shift_id: shift?.id || null, user_id: s.user?.id, created_at: ts,
    };
    writes.push({ c: 'payments', id: newId('p'), patch: pay as any });
  }

  // stok: kurangi untuk produk yang dilacak
  const products = await db.products.bulkGet(inp.items.map((i) => i.product_id || ''));
  inp.items.forEach((it, i) => {
    if (products[i]?.track_stock) {
      const mv: Omit<StockMove, 'id'> = { product_id: it.product_id!, outlet_id: cfg.outletId, qty: -it.qty, reason: 'penjualan', ref_id: orderId, created_at: ts };
      writes.push({ c: 'stock_moves', id: newId('m'), patch: mv as any });
    }
  });

  // tiket ke printer yang dikelola perangkat lain (mode relay)
  for (const target of ['kasir', 'produksi'] as PrintTarget[]) {
    if (cfg.autoPrint && cfg.printers[target].mode === 'relay') {
      const job: Omit<PrintJob, 'id'> = { target, order_id: orderId, kind: target === 'kasir' ? 'struk' : 'tiket', status: 'pending', from_device: s.deviceId, created_at: ts };
      writes.push({ c: 'print_jobs', id: newId('j'), patch: job as any });
    }
  }

  await saveMany(writes);
  return order;
}

export async function addPayment(order: Order, method: string, amount: number) {
  const s = getSession();
  const cfg = await getDeviceConfig();
  const shift = await activeShift();
  const paid = paidOf(order.id, await db.payments.where('order_id').equals(order.id).toArray());
  const amt = Math.max(0, Math.min(amount, order.total - paid));
  if (!amt) return 0;
  await save<Payment>('payments', newId('p'), {
    order_id: order.id, outlet_id: order.outlet_id || cfg.outletId, method, amount: amt, kind: 'pelunasan',
    shift_id: shift?.id || null, user_id: s.user?.id,
  });
  return amt;
}

export async function setProductionStatus(order: Order, status: ProductionStatus) {
  const ts = nowIso();
  const patch: Partial<Order> = { production_status: status };
  if (status === 'dirangkai') { patch.production_at = ts; patch.assigned_to = getSession().user?.id; }
  if (status === 'siap') patch.ready_at = ts;
  if (status === 'selesai') patch.done_at = ts;
  await save<Order>('orders', order.id, patch);
}

export async function voidOrder(order: Order, reason: string) {
  const ts = nowIso();
  const writes: { c: Collection; id: string; patch: Record<string, unknown> }[] = [
    { c: 'orders', id: order.id, patch: { void: true, void_reason: reason, void_at: ts, production_status: 'batal' } },
  ];
  for (const p of await db.payments.where('order_id').equals(order.id).toArray()) {
    if (!p.void) writes.push({ c: 'payments', id: p.id, patch: { void: true } });
  }
  const moves = (await db.stock_moves.toArray()).filter((m) => m.ref_id === order.id && m.reason === 'penjualan');
  for (const m of moves) {
    writes.push({ c: 'stock_moves', id: newId('m'), patch: { product_id: m.product_id, outlet_id: m.outlet_id, qty: -m.qty, reason: 'batal', ref_id: order.id } });
  }
  await saveMany(writes);
}

export async function addCashMove(m: Omit<CashMove, 'id' | 'outlet_id' | 'shift_id' | 'user_id'>) {
  const cfg = await getDeviceConfig();
  const shift = await activeShift();
  await save<CashMove>('cash_moves', newId('k'), { ...m, outlet_id: cfg.outletId, shift_id: shift?.id || null, user_id: getSession().user?.id });
}

export async function stockLevels(outletId?: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const m of await db.stock_moves.toArray()) {
    if (m.deleted || (outletId && m.outlet_id !== outletId)) continue;
    map.set(m.product_id, (map.get(m.product_id) || 0) + m.qty);
  }
  return map;
}
