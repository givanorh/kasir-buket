import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import qrcode from 'qrcode-generator';
import { db, getMeta, setMeta } from '../lib/db';
import { cartTotals, pointsEarned, scheduledQtyOn } from '../lib/calc';
import { addDays, dayKey, fmtDate, fromLocalInput, memberNo, num, rp, toLocalInput } from '../lib/format';
import { activeShift, checkout, getDeviceConfig, openShift, stockLevels, type CheckoutInput, type DeviceConfig } from '../lib/store';
import { printOrder, type PrintResult } from '../lib/print';
import { buildStruk, buildTiket } from '../lib/print/receipts';
import { pickSurvey, storeCfg } from '../lib/settings';
import { budgetLeft, monthKey, monthStartIso, reviewTiers, reviewUsage, tierOffer } from '../lib/review';
import { api, useSession } from '../lib/session';
import { deliveryFee, isShortMapsLink, parseLocalInput, type LatLng } from '../lib/geo';
import { Badge, Field, Modal, MoneyInput, Seg, toast } from '../components/ui';
import { Icon } from '../components/icons';
import { ReceiptPreview } from '../components/ReceiptPreview';
import type { Fulfillment, Order, OrderItem, Product } from '../lib/types';

const TINTS = ['#f3dfe6', '#e3ece5', '#efe6dc', '#e2e6f1', '#ece3f0', '#f2ecd8'];

export interface EngageResult { reviewDiscount: number; reviewTier?: string; survey: Record<string, string> }

export default function Kasir() {
  const products = useLiveQuery(() => db.products.toArray(), []) || [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) || [];
  const stock = useLiveQuery(() => stockLevels(), []) || new Map<string, number>();
  const shift = useLiveQuery(async () => (await activeShift()) ?? null, []); // undefined = memuat, null = belum dibuka
  const role = useSession().user?.role;
  const [opening, setOpening] = useState(0);
  // animasi masuk berurutan hanya saat halaman pertama dibuka, bukan setiap kali mencari/memfilter
  const [enter, setEnter] = useState(true);
  useEffect(() => { if (!products.length) return; const t = setTimeout(() => setEnter(false), 1000); return () => clearTimeout(t); }, [products.length > 0]); // eslint-disable-line
  const settings = useLiveQuery(() => db.settings.get('toko'));
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [panel, setPanel] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [custom, setCustom] = useState(false);
  const [engage, setEngage] = useState(false);
  const [pay, setPay] = useState<EngageResult | null>(null);
  const [done, setDone] = useState<{ order: Order; results: PrintResult[] } | null>(null);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products
      .filter((p) => p.active !== false && !p.deleted && p.type !== 'bahan')
      .filter((p) => !cat || p.category_id === cat)
      .filter((p) => !s || p.name.toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, q, cat]);
  const inCart = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of cart) if (it.product_id) m.set(it.product_id, (m.get(it.product_id) || 0) + it.qty);
    return m;
  }, [cart]);
  const totals = cartTotals(cart);

  function add(p: Product) {
    setCart((c) => {
      const i = c.findIndex((x) => x.product_id === p.id && !x.note && !x.discount);
      if (i >= 0) return c.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x));
      return [...c, { product_id: p.id, name: p.name, sku: p.sku, qty: 1, price: p.price, cost: p.cost || 0, discount: 0, type: p.type }];
    });
  }
  const setQty = (i: number, d: number) => setCart((c) => c.flatMap((x, j) => (j !== i ? [x] : x.qty + d <= 0 ? [] : [{ ...x, qty: x.qty + d }])));
  /** Kurangi 1 dari baris terakhir produk ini (langsung dari kartu produk, tanpa membuka keranjang). */
  const dec = (pid: string) => setCart((c) => {
    const i = c.map((x) => x.product_id).lastIndexOf(pid);
    return i < 0 ? c : c.flatMap((x, j) => (j !== i ? [x] : x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []));
  });

  async function startPay() {
    setPanel(false);
    const cfg = storeCfg(settings).engage;
    if (cfg.enabled && cfg.every_n > 0) {
      const n = (await getMeta<number>('engage_count', 0)) + 1;
      await setMeta('engage_count', n);
      if (n % cfg.every_n === 0) { setEngage(true); return; }
    }
    setPay({ reviewDiscount: 0, survey: {} });
  }

  return (
    shift === null && role !== 'owner' ? (
      <div className="gate" data-testid="shift-gate">
        <div className="gate-mark"><Icon name="shift" size={28} /></div>
        <h2>Buka shift untuk mulai berjualan</h2>
        <p className="muted">Kasir hanya bisa dipakai setelah shift dibuka, agar uang di laci bisa direkap saat tutup shift. Owner tetap bisa berjualan tanpa shift.</p>
        <Field label="Kas awal di laci"><MoneyInput value={opening} onChange={setOpening} ariaLabel="Kas awal" /></Field>
        <button className="btn primary big" onClick={async () => { await openShift(opening); toast('Shift dibuka. Selamat berjualan'); }} data-testid="gate-buka-shift">Buka shift</button>
      </div>
    ) : (
    <div className="pos">
      {shift === null && <div className="note warn">Shift belum dibuka (akun owner tetap bisa berjualan). Rekap kas laci lebih akurat bila shift dibuka di menu <a href="#/shift">Shift</a>.</div>}
      <div className="pos-search">
        <div className="search"><Icon name="search" /><input placeholder="Cari buket atau kode" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn" onClick={() => setCustom(true)}><Icon name="plus" size={18} />Item custom</button>
      </div>
      <div className="chips scroll">
        <button className={!cat ? 'on' : ''} onClick={() => setCat('')}>Semua</button>
        {categories.filter((c) => !c.deleted).sort((a, b) => (a.sort || 0) - (b.sort || 0)).map((c) => (
          <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>{c.name}</button>
        ))}
      </div>
      <div className={`grid ${enter ? 'enter' : ''}`}>
        {list.map((p, i) => {
          const st = p.track_stock ? stock.get(p.id) || 0 : null;
          const n = inCart.get(p.id) || 0;
          return (
            <div key={p.id} className={`pwrap ${n ? 'in' : ''}`} style={{ ['--i' as string]: i }} data-testid="product-card">
              <button className="pcard" onClick={() => add(p)} disabled={st !== null && st <= 0}>
                <div className={`pimg ${p.photo ? '' : 'ph'}`} style={p.photo ? { background: `center/cover url(${p.photo})` } : { backgroundColor: TINTS[i % TINTS.length] }}>{!p.photo && p.name.slice(0, 1).toUpperCase()}</div>
                <div className="pinfo">
                  <span className="pname">{p.name}</span>
                  <span className="pprice">{rp(p.price)}</span>
                  {st !== null && <span className={`pstock ${st <= (p.min_stock || 0) ? 'low' : ''}`}>Stok {num(st)}</span>}
                </div>
              </button>
              {n > 0 && (
                <div className="pstep" data-testid="pstep">
                  <button onClick={() => dec(p.id)} aria-label={`Kurangi ${p.name}`} data-testid="pstep-minus"><Icon name="minus" size={18} /></button>
                  <span aria-live="polite">{n}</span>
                  <button onClick={() => add(p)} disabled={st !== null && n >= st} aria-label={`Tambah ${p.name}`} data-testid="pstep-plus"><Icon name="plus" size={18} /></button>
                </div>
              )}
            </div>
          );
        })}
        {!list.length && <div className="empty">Belum ada produk. Tambahkan di menu Produk, atau pakai Item custom.</div>}
      </div>

      <div className="tag-wrap">
        {panel && cart.length > 0 && (
          <div className="cart-panel" role="dialog" aria-label="Keranjang">
            <div className="cart-panel-head"><h2>Keranjang</h2><button className="icon-btn" onClick={() => setPanel(false)} aria-label="Tutup keranjang"><Icon name="close" /></button></div>
            <div className="cart">
              {cart.map((it, i) => (
                <div key={i} className="citem">
                  <div className="cmain" onClick={() => setEditIdx(i)}>
                    <div className="cname">{it.name}</div>
                    <div className="csub">{num(it.price)}{it.discount ? ` · potongan ${num(it.discount)}` : ''}{it.note ? ` · ${it.note}` : ''}</div>
                  </div>
                  <div className="qty">
                    <button onClick={() => setQty(i, -1)} aria-label="Kurangi"><Icon name="minus" size={16} /></button>
                    <span>{it.qty}</span>
                    <button onClick={() => setQty(i, 1)} aria-label="Tambah"><Icon name="plus" size={16} /></button>
                  </div>
                  <div className="cline">{num(it.qty * it.price - it.discount)}</div>
                </div>
              ))}
            </div>
            <div className="cart-foot">
              <button className="btn ghost small" onClick={() => { setCart([]); setPanel(false); }}>Kosongkan</button>
              <span className="muted">Ketuk item untuk ubah harga, potongan, catatan</span>
            </div>
          </div>
        )}
        {cart.length > 0 ? (
          <div className="cart-tag" data-testid="cart-tag">
            <button className="tag-open" onClick={() => setPanel(!panel)} aria-expanded={panel} data-testid="cart-open">
              <span><span className="tag-count">{totals.qty} item · lihat keranjang</span><span className="tag-total">{rp(totals.total)}</span></span>
            </button>
            <button className="btn accent" onClick={startPay} data-testid="btn-bayar">Bayar</button>
          </div>
        ) : null}
      </div>

      {editIdx !== null && cart[editIdx] && (
        <ItemEditor item={cart[editIdx]} onClose={() => setEditIdx(null)}
          onSave={(it) => { setCart((c) => c.map((x, j) => (j === editIdx ? it : x))); setEditIdx(null); }}
          onRemove={() => { setCart((c) => c.filter((_, j) => j !== editIdx)); setEditIdx(null); }} />
      )}
      {custom && (
        <ItemEditor isNew item={{ name: 'Buket custom', qty: 1, price: 0, cost: 0, discount: 0, type: 'buket' }} onClose={() => setCustom(false)}
          onSave={(it) => { setCart((c) => [...c, it]); setCustom(false); }} />
      )}
      {engage && <EngageModal base={cartTotals(cart).subtotal - cartTotals(cart).item_discount} onClose={(r) => { setEngage(false); setPay(r); }} />}
      {pay && (
        <Checkout items={cart} engage={pay} onClose={() => setPay(null)}
          onDone={(order, results) => { setPay(null); setCart([]); setDone({ order, results }); }} />
      )}
      {done && <Success order={done.order} results={done.results} onClose={() => setDone(null)} />}
    </div>
    )
  );
}

function ItemEditor({ item, isNew, onSave, onClose, onRemove }: { item: OrderItem; isNew?: boolean; onSave: (i: OrderItem) => void; onClose: () => void; onRemove?: () => void }) {
  const [it, setIt] = useState(item);
  return (
    <Modal title={isNew ? 'Item custom' : 'Ubah item'} onClose={onClose}
      footer={<>
        {onRemove && <button className="btn danger" onClick={onRemove}>Hapus</button>}
        <button className="btn primary grow" disabled={!it.name || it.qty < 1} onClick={() => onSave(it)}>Simpan</button>
      </>}>
      <div className="stack">
        <Field label="Nama"><input value={it.name} onChange={(e) => setIt({ ...it, name: e.target.value })} /></Field>
        <div className="cols">
          <Field label="Jumlah"><input type="number" min={1} value={it.qty} onChange={(e) => setIt({ ...it, qty: Math.max(1, Number(e.target.value) || 1) })} /></Field>
          <Field label="Harga satuan"><MoneyInput value={it.price} onChange={(price) => setIt({ ...it, price })} /></Field>
        </div>
        <div className="cols">
          <Field label="Potongan item"><MoneyInput value={it.discount} onChange={(discount) => setIt({ ...it, discount: Math.min(discount, it.qty * it.price) })} /></Field>
          {isNew && <Field label="Modal per unit (HPP)"><MoneyInput value={it.cost} onChange={(cost) => setIt({ ...it, cost })} /></Field>}
        </div>
        <Field label="Catatan item"><input value={it.note || ''} onChange={(e) => setIt({ ...it, note: e.target.value })} placeholder="mis. mawar merah 20 tangkai, wrapping hitam" /></Field>
      </div>
    </Modal>
  );
}

/**
 * Pop-up sesekali: tawarkan diskon ulasan Google Maps dan 1–2 pertanyaan survei yang diacak dari bank pertanyaan.
 * Kolom diskon, belanja minimal, dan budget per bulan diatur owner (Pengaturan › Promo poin & ongkir).
 */
function EngageModal({ base, onClose }: { base: number; onClose: (r: EngageResult) => void }) {
  const settings = useLiveQuery(() => db.settings.get('toko'));
  const cfg = storeCfg(settings).engage;
  const [sel, setSel] = useState<{ id: string; label: string; amount: number } | null>(null);
  const [ans, setAns] = useState<Record<string, string>>({});
  // diacak sekali saat pengaturan selesai dimuat, agar pertanyaan tidak berganti ketika kasir memilih jawaban
  const [qs, setQs] = useState<ReturnType<typeof pickSurvey> | null>(null);
  useEffect(() => { if (settings && !qs) setQs(pickSurvey(cfg.survey, Math.max(1, Math.min(2, cfg.per_popup || 2)))); }, [settings]); // eslint-disable-line
  // pemakaian budget bulan berjalan dari seluruh perangkat yang sudah tersinkron
  const monthOrders = useLiveQuery(() => db.orders.where('created_at').aboveOrEqual(monthStartIso()).toArray(), []) || [];
  const now = new Date();
  const usage = reviewUsage(monthOrders, monthKey(now));
  const budget = cfg.review_budget || 0;
  const left = budgetLeft(budget, usage.used);
  const tiers = reviewTiers(cfg).filter((t) => t.active !== false);
  const monthName = now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  const qrSvg = useMemo(() => {
    if (!cfg.review_url) return '';
    const qr = qrcode(0, 'M');
    qr.addData(cfg.review_url);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [cfg.review_url]);
  const clean = () => Object.fromEntries(Object.entries(ans).filter(([, v]) => v));
  const finish = () => onClose({ reviewDiscount: sel?.amount || 0, reviewTier: sel?.label, survey: clean() });
  return (
    <Modal title="Sebelum bayar" onClose={() => onClose({ reviewDiscount: 0, survey: clean() })} wide
      footer={<>
        <button className="btn" onClick={() => onClose({ reviewDiscount: 0, survey: clean() })}>Lewati</button>
        <button className="btn primary grow" onClick={finish} data-testid="engage-next">Lanjut ke pembayaran</button>
      </>}>
      <div className="engage" data-testid="engage">
        <div className="stack">
          {qrSvg ? <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg }} /> : <div className="note warn">Link ulasan Google Maps belum diisi owner.</div>}
          <span className="muted small">Minta pelanggan memindai kode ini dan memberi ulasan di Google Maps.</span>
        </div>
        <div className="stack">
          <div>
            <h3>Ulasan Google Maps</h3>
            <p className="muted">Pilih diskon sesuai ulasan yang sudah dikirim dan ditunjukkan pelanggan.</p>
            {budget > 0 && (
              <div className="rbudget" data-testid="review-budget">
                <div className="row"><span>Sisa budget {monthName}</span><b>{rp(left)} <span className="muted">dari {rp(budget)}</span></b></div>
                <div className="meter"><i style={{ width: `${Math.min(100, (usage.used / budget) * 100)}%` }} /></div>
                <div className="muted small">Terpakai {rp(usage.used)} untuk {num(usage.count)} transaksi</div>
              </div>
            )}
            {base < (cfg.review_min_spend || 0) && <div className="note" data-testid="review-min">Belanja {rp(base)} di bawah minimal {rp(cfg.review_min_spend)}: diskon ulasan tidak berlaku.</div>}
            {budget > 0 && left <= 0 && <div className="note warn" data-testid="review-habis">Budget diskon ulasan {monthName} sudah habis.</div>}
            <div className="tiers">
              <button className={!sel ? 'on' : ''} onClick={() => setSel(null)}>Tidak ulasan</button>
              {tiers.map((t) => {
                const o = tierOffer(t, base, left, cfg.review_min_spend || 0);
                return (
                  <button key={t.id} className={sel?.id === t.id ? 'on' : ''} disabled={!!o.block} data-testid={`tier-${t.id}`}
                    onClick={() => setSel({ id: t.id, label: t.label, amount: o.amount })} title={o.block === 'budget' ? 'Melebihi sisa budget bulan ini' : undefined}>
                    <span>{t.label}</span><b>−{rp(o.amount)}</b>
                    {o.block && <i>{o.block === 'budget' ? 'melebihi sisa budget' : o.block === 'belanja' ? 'di bawah belanja minimal' : 'tidak aktif'}</i>}
                  </button>
                );
              })}
            </div>
            {!tiers.length && <div className="muted small">Owner belum mengatur kolom diskon ulasan.</div>}
          </div>
          {(qs || []).map((s) => (
            <div key={s.id} data-testid="survey-q">
              <h3>{s.q}</h3>
              <div className="chips small">
                {s.options.map((o) => <button key={o} className={ans[s.id] === o ? 'on' : ''} onClick={() => setAns({ ...ans, [s.id]: ans[s.id] === o ? '' : o })}>{o}</button>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function Checkout({ items, engage, onClose, onDone }: { items: OrderItem[]; engage: EngageResult; onClose: () => void; onDone: (o: Order, r: PrintResult[]) => void }) {
  const settings = useLiveQuery(() => db.settings.get('toko'));
  const cfg = storeCfg(settings);
  const customers = useLiveQuery(() => db.customers.toArray(), []) || [];
  const orders = useLiveQuery(() => db.orders.where('due_at').above(addDays(new Date(), -1).toISOString()).toArray(), []) || [];
  const [dev, setDev] = useState<DeviceConfig | null>(null);
  useEffect(() => { getDeviceConfig().then(setDev); }, []);
  const outlet = useLiveQuery(() => (dev ? db.outlets.get(dev.outletId) : undefined), [dev?.outletId]);
  const [f, setF] = useState({
    name: '', phone: '', customerId: '' as string, fulfillment: 'sekarang' as Fulfillment, due: toLocalInput(new Date(Date.now() + 3 * 3600e3)),
    recipient: '', recipientPhone: '', address: '', mapsInput: '', fee: 0, card: '', notes: '', disc: 0, florist: '',
    method: 'Tunai', payType: 'lunas' as 'lunas' | 'dp' | 'nanti', dp: 0, received: 0, usePoints: false, register: false,
  });
  const [geo, setGeo] = useState<{ point: LatLng | null; km: number; source: 'ors' | 'osrm' | 'manual'; minutes?: number } | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [manualKm, setManualKm] = useState<string | null>(null); // terisi bila rute jalan gagal / kasir memilih isi km sendiri
  const [busy, setBusy] = useState(false);

  // pelanggan & poin
  const mn = memberNo(f.phone);
  const cust = customers.find((c) => c.id === f.customerId) || (mn ? customers.find((c) => !c.deleted && memberNo(c.phone) === mn) : undefined);
  const custMn = memberNo(cust?.phone) || mn;
  const isMember = !!cust?.member || (f.register && !!custMn);
  // nomor HP diisi lebih dulu: bila cocok dengan pelanggan tersimpan, data lainnya terisi otomatis
  const [filledFor, setFilledFor] = useState('');
  useEffect(() => {
    if (!cust || cust.id === filledFor) return;
    setFilledFor(cust.id);
    setF((x) => ({ ...x, customerId: cust.id, name: cust.name, address: x.address || cust.address || '', recipient: x.recipient, register: false }));
  }, [cust?.id]); // eslint-disable-line
  const custOrders = useLiveQuery(() => (cust ? db.orders.where('customer_id').equals(cust.id).toArray() : Promise.resolve([] as Order[])), [cust?.id]) || [];
  const balance = custOrders.filter((o) => !o.void).reduce((s, o) => s + (o.points_earned || 0) - (o.points_redeemed || 0), 0);

  const base = cartTotals(items);
  const goods = Math.max(0, base.subtotal - base.item_discount - f.disc - engage.reviewDiscount);
  const L = cfg.loyalty;
  const maxRedeem = L.enabled && cust && isMember && balance >= L.min_redeem ? Math.min(balance, Math.floor(goods / L.point_value)) : 0;
  const redeem = f.usePoints ? maxRedeem : 0;
  const pointsDisc = redeem * L.point_value;
  const fee = f.fulfillment === 'antar' ? f.fee : 0;
  const t = cartTotals(items, f.disc + engage.reviewDiscount + pointsDisc, fee);
  const earn = isMember ? pointsEarned(t.total, fee, L) : 0; // poin hanya untuk member
  const payAmount = f.payType === 'lunas' ? t.total : f.payType === 'dp' ? Math.min(f.dp, t.total) : 0;
  const change = f.method === 'Tunai' ? Math.max(0, f.received - payAmount) : 0;
  const shortCash = f.method === 'Tunai' && payAmount > 0 && f.received > 0 && f.received < payAmount;
  const dueIso = f.fulfillment === 'sekarang' ? null : fromLocalInput(f.due);
  const cap = settings?.daily_capacity || 0;
  const scheduled = dueIso ? scheduledQtyOn(orders, dayKey(dueIso), dayKey) : 0;
  const newQty = items.filter((i) => (i.type || 'buket') === 'buket').reduce((s, i) => s + i.qty, 0);
  const sugg = [...new Set([payAmount, Math.ceil(payAmount / 50000) * 50000, Math.ceil(payAmount / 100000) * 100000, payAmount + 50000].filter((x) => x >= payAmount && x > 0))].slice(0, 4);
  const matches = f.name.trim().length >= 2 && !cust
    ? customers.filter((c) => !c.deleted && c.name.toLowerCase().includes(f.name.trim().toLowerCase())).slice(0, 4)
    : [];
  const needCustomer = f.payType !== 'lunas' || f.fulfillment !== 'sekarang';
  const invalid = (needCustomer && !f.name.trim()) || (f.fulfillment !== 'sekarang' && !dueIso) || (f.payType === 'dp' && (f.dp <= 0 || f.dp >= t.total)) || shortCash;

  const applyKm = (km: number, source: 'ors' | 'osrm' | 'manual', point: LatLng | null, minutes?: number) => {
    setGeo({ point, km, source, minutes });
    setF((x) => ({ ...x, fee: deliveryFee(km, cfg.delivery).fee }));
  };
  const feeCalc = geo ? (() => {
    const r = deliveryFee(geo.km, cfg.delivery);
    return `${r.kmBilled.toLocaleString('id-ID')} km × ${rp(cfg.delivery.rate)} = ${rp(r.raw)}${r.usedMin ? ` → minimum ${rp(cfg.delivery.min)}` : r.fee !== r.raw ? ` → dibulatkan ${rp(r.fee)}` : ''}`;
  })() : '';
  const SRC: Record<string, string> = { ors: 'Rute jalan kendaraan (OpenRouteService)', osrm: 'Rute jalan kendaraan (OSRM, cadangan)', manual: 'Jarak diisi manual' };

  async function hitungOngkir() {
    const input = f.mapsInput.trim();
    if (!input) return;
    setGeoBusy(true);
    let point: LatLng | null = null;
    try {
      const ref = outlet?.location || null;
      point = parseLocalInput(input, ref);
      if (!point && (isShortMapsLink(input) || /^https?:\/\//i.test(input))) point = await api<LatLng>('/api/geo/expand', { body: { url: input }, timeout: 20000 });
      if (!point) throw new Error('Titik tidak terbaca. Tempel link Google Maps, Plus Code (mis. VP3+PR Stabat), atau koordinat.');
      if (!ref) throw new Error('Lokasi toko belum diatur. Owner: Pengaturan › Toko & cabang › Lokasi toko.');
      // hanya rute jalan kendaraan; tidak ada perkiraan garis lurus
      const r = await api<{ km: number; source: 'ors' | 'osrm'; minutes?: number }>('/api/geo/route', { body: { from: ref, to: point }, timeout: 20000 });
      setManualKm(null);
      applyKm(r.km, r.source, point, r.minutes);
    } catch (e) {
      setGeo(null);
      setManualKm('');
      setF((x) => ({ ...x, fee: 0 }));
      toast((e as Error).message, 'err');
    } finally {
      setGeoBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const input: CheckoutInput = {
        items, orderDiscount: f.disc + engage.reviewDiscount + pointsDisc, extraFee: fee,
        customer: { id: cust?.id || null, name: f.name, phone: f.phone || cust?.phone || '', registerMember: f.register && !cust?.member }, fulfillment: f.fulfillment, dueAt: dueIso,
        recipientName: f.recipient, recipientPhone: f.recipientPhone, deliveryAddress: f.address,
        cardMessage: f.card, notes: f.notes, payMethod: f.method, payAmount, cashReceived: f.received || payAmount,
        florist: f.florist, manualDiscount: f.disc, reviewDiscount: engage.reviewDiscount, reviewTier: engage.reviewTier, survey: engage.survey,
        pointsRedeemed: redeem, pointsDiscount: pointsDisc, pointsEarned: earn,
        delivery: f.fulfillment === 'antar' && geo ? { input: f.mapsInput, lat: geo.point?.lat ?? 0, lng: geo.point?.lng ?? 0, km: geo.km, km_source: geo.source, rate: cfg.delivery.rate, min: cfg.delivery.min } : null,
      };
      const order = await checkout(input);
      const results = await printOrder(order, ['kasir', 'produksi'], { skipRelay: true });
      onDone(order, results);
    } catch (e) {
      toast('Gagal menyimpan: ' + (e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Pembayaran" onClose={onClose} wide
      footer={<button className="btn primary big grow" disabled={busy || invalid} onClick={submit} data-testid="btn-simpan">
        {busy ? 'Menyimpan…' : f.payType === 'lunas' ? `Simpan dan cetak · ${rp(t.total)}` : `Simpan pesanan · bayar ${rp(payAmount)}`}
      </button>}>
      <div className="checkout">
        <div className="stack">
          <div className="section-title">Pelanggan</div>
          <Field label="Nomor HP" hint={!cust && mn ? 'Nomor belum tersimpan: transaksi tetap bisa dilanjutkan. Centang Daftarkan member bila pelanggan setuju.' : undefined}>
            <div className={`lookup ${cust ? 'found' : ''}`}>
              <input inputMode="tel" autoFocus value={f.phone} placeholder="08…" data-testid="cust-phone" aria-label="Nomor HP"
                onChange={(e) => { const v = e.target.value; setF((x) => ({ ...x, phone: v, customerId: memberNo(v) && memberNo(v) === memberNo(cust?.phone) ? x.customerId : '' })); }} />
              {cust && <span className="lookup-ok" aria-hidden="true"><Icon name="check" size={18} /></span>}
            </div>
          </Field>
          {cust && (
            <div className="found-card" data-testid="cust-found">
              <span className="avatar">{cust.name.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
              <div className="grow"><b>{cust.name}</b>{cust.member ? <Badge tone="rose">member</Badge> : <Badge>bukan member</Badge>}
                <div className="muted">{[cust.address, cust.instagram && `IG ${cust.instagram}`, `${custOrders.filter((o) => !o.void).length} transaksi`].filter(Boolean).join(' · ')}</div></div>
            </div>
          )}
          <Field label={`Nama${needCustomer ? ' (wajib)' : ''}`}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="cust-name" /></Field>
          {!cust && matches.length > 0 && (
            <div className="chips small"><span className="muted small">Pelanggan lama?</span>{matches.map((c) => <button key={c.id} onClick={() => setF({ ...f, customerId: c.id, phone: c.phone || f.phone })}>{c.name} {c.phone}</button>)}</div>
          )}
          {L.enabled && cust?.member && (
            <div className="loyal" data-testid="member">
              <Icon name="star" />
              <div className="grow"><b>Member {cust.phone} · {num(balance)} poin</b><div className="muted">{maxRedeem ? `Bisa ditukar ${num(maxRedeem)} poin = ${rp(maxRedeem * L.point_value)}` : `Minimal tukar ${num(L.min_redeem)} poin`}</div></div>
              {maxRedeem > 0 && <label className="check"><input type="checkbox" checked={f.usePoints} onChange={(e) => setF({ ...f, usePoints: e.target.checked })} />Tukar</label>}
            </div>
          )}
          {L.enabled && !cust?.member && (f.name.trim() || f.phone.trim() || cust) && (
            <div className="loyal off" data-testid="non-member">
              <Icon name="star" />
              <div className="grow">
                <label className="check"><input type="checkbox" checked={f.register} disabled={!custMn} onChange={(e) => setF({ ...f, register: e.target.checked })} data-testid="daftar-member" />
                  <span><b>Daftarkan member</b>{custMn ? ` · nomor member ${custMn}` : ''}</span></label>
                <div className="muted">{!custMn ? 'Isi nomor HP yang valid (08…) untuk mendaftar member.' : f.register ? `Transaksi ini mendapat poin${balance > 0 ? `; saldo lama ${num(balance)} poin ikut aktif` : ''}.` : 'Bukan member: transaksi ini tidak mendapat poin.'}</div>
              </div>
            </div>
          )}

          <div className="section-title">Pengambilan</div>
          <Seg value={f.fulfillment} onChange={(fulfillment) => setF({ ...f, fulfillment })}
            options={[{ value: 'sekarang', label: 'Ready' }, { value: 'ambil', label: 'Ambil nanti' }, { value: 'antar', label: 'Diantar' }]} />
          {f.fulfillment !== 'sekarang' && (
            <Field label="Tanggal dan jam" hint={cap ? <span className={scheduled + newQty > cap ? 'red' : ''}>Kapasitas {fmtDate(dueIso)}: {scheduled} + {newQty} dari {cap} buket</span> : undefined}>
              <input type="datetime-local" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} data-testid="due" />
            </Field>
          )}
          {f.fulfillment === 'antar' && (
            <>
              <Field label="Titik antar" hint="Tempel link Google Maps, Plus Code, atau koordinat dari pelanggan">
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={f.mapsInput} onChange={(e) => setF({ ...f, mapsInput: e.target.value })} placeholder="https://maps.app.goo.gl/… atau VP3+PR Stabat" data-testid="maps-input" />
                  <button className="btn" onClick={hitungOngkir} disabled={geoBusy || !f.mapsInput.trim()} data-testid="btn-ongkir"><Icon name="pin" size={18} />{geoBusy ? 'Menghitung…' : 'Hitung'}</button>
                </div>
              </Field>
              {geo && geo.km > 0 && <div className="calc" data-testid="ongkir-calc">{feeCalc}<br />{SRC[geo.source]}{geo.minutes ? ` · ± ${geo.minutes} menit berkendara` : ''}</div>}
              {manualKm !== null ? (
                <Field label="Jarak rute (km)" hint="Lihat jarak rute motor/mobil di Google Maps, lalu isi di sini">
                  <input inputMode="decimal" value={manualKm} data-testid="km-manual" placeholder="mis. 6,8"
                    onChange={(e) => { setManualKm(e.target.value); const km = Number(e.target.value.replace(',', '.')); if (km > 0) applyKm(km, 'manual', geo?.point ?? null); else setGeo(null); }} />
                </Field>
              ) : <button type="button" className="linkish small" onClick={() => setManualKm('')}>Isi jarak km manual</button>}
              <div className="cols">
                <Field label="Nama penerima"><input value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value })} /></Field>
                <Field label="HP penerima"><input inputMode="tel" value={f.recipientPhone} onChange={(e) => setF({ ...f, recipientPhone: e.target.value })} /></Field>
              </div>
              <Field label="Alamat lengkap"><textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
              <Field label="Ongkir" hint="Terisi otomatis dari jarak; bisa diubah"><MoneyInput value={f.fee} onChange={(fee) => setF({ ...f, fee })} ariaLabel="Ongkir" /></Field>
            </>
          )}

          <div className="section-title">Perangkai</div>
          <div className="chips" data-testid="florists">
            <button className={!f.florist ? 'on' : ''} onClick={() => setF({ ...f, florist: '' })}>Belum ditunjuk</button>
            {cfg.florists.map((n) => <button key={n} className={f.florist === n ? 'on' : ''} onClick={() => setF({ ...f, florist: n })}>{n}</button>)}
          </div>
          <Field label="Kartu ucapan"><textarea rows={2} value={f.card} onChange={(e) => setF({ ...f, card: e.target.value })} placeholder="Happy graduation, Rina!" data-testid="card" /></Field>
          <Field label="Catatan untuk perangkai"><textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="warna dominan pink, pita satin putih" data-testid="notes" /></Field>
        </div>

        <div className="stack">
          <div className="section-title">Ringkasan</div>
          <div className="sum">
            {items.map((it, i) => <div key={i} className="row muted"><span>{it.qty}× {it.name}</span><span>{num(it.qty * it.price - it.discount)}</span></div>)}
            <div className="row"><span>Subtotal</span><span>{rp(t.subtotal - t.item_discount)}</span></div>
            <div className="row"><span>Diskon</span><MoneyInput value={f.disc} onChange={(disc) => setF({ ...f, disc })} ariaLabel="Diskon transaksi" /></div>
            {engage.reviewDiscount > 0 && <div className="row"><span>Diskon ulasan{engage.reviewTier ? ` (${engage.reviewTier})` : ' Google Maps'}</span><span>−{rp(engage.reviewDiscount)}</span></div>}
            {pointsDisc > 0 && <div className="row"><span>Tukar {num(redeem)} poin</span><span>−{rp(pointsDisc)}</span></div>}
            {fee > 0 && <div className="row"><span>Ongkir</span><span>{rp(fee)}</span></div>}
            <div className="row total"><span>Total</span><span data-testid="total">{rp(t.total)}</span></div>
            {earn > 0 && <div className="row muted"><span>Poin didapat</span><span>+{num(earn)}</span></div>}
          </div>
          <div className="section-title">Pembayaran</div>
          <Seg value={f.payType} onChange={(payType) => setF({ ...f, payType, dp: payType === 'dp' && !f.dp ? Math.round((t.total * (settings?.dp_min_percent || 50)) / 100 / 1000) * 1000 : f.dp })}
            options={[{ value: 'lunas', label: 'Lunas' }, { value: 'dp', label: 'DP' }, { value: 'nanti', label: 'Bayar nanti' }]} />
          {f.payType === 'dp' && <Field label="Jumlah DP" hint={`Sisa ditagih saat ambil: ${rp(t.total - payAmount)}`}><MoneyInput value={f.dp} onChange={(dp) => setF({ ...f, dp })} /></Field>}
          {f.payType !== 'nanti' && (
            <>
              <div className="chips">{cfg.methods.map((m) => <button key={m} className={f.method === m ? 'on' : ''} onClick={() => setF({ ...f, method: m })}>{m}</button>)}</div>
              {f.method === 'Tunai' && (
                <>
                  <Field label="Uang diterima"><MoneyInput value={f.received} onChange={(received) => setF({ ...f, received })} ariaLabel="Uang diterima" /></Field>
                  <div className="chips small">{sugg.map((x) => <button key={x} onClick={() => setF({ ...f, received: x })}>{x === payAmount ? 'Uang pas' : num(x)}</button>)}</div>
                  <div className={`change ${shortCash ? 'red' : ''}`}>{shortCash ? `Kurang ${rp(payAmount - f.received)}` : `Kembalian ${rp(change)}`}</div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function Success({ order, results, onClose }: { order: Order; results: PrintResult[]; onClose: () => void }) {
  const settings = useLiveQuery(() => db.settings.get('toko'));
  const payments = useLiveQuery(() => db.payments.where('order_id').equals(order.id).toArray(), [order.id]) || [];
  const [res, setRes] = useState(results);
  const [show, setShow] = useState<'struk' | 'tiket'>('struk');
  const label = (r: PrintResult) => r.mode === 'relay' ? 'dikirim ke perangkat ruang perangkai' : r.mode === 'none' ? 'printer belum diatur' : r.mode === 'system' ? 'dialog cetak dibuka' : r.ok ? 'tercetak' : `gagal: ${r.error}`;
  async function reprint(target: 'kasir' | 'produksi') {
    const r = await printOrder(order, [target], { copyLabel: target === 'kasir' ? 'CETAK ULANG' : undefined });
    setRes((x) => [...x.filter((y) => y.target !== target), ...r]);
    toast(r[0].ok ? 'Dikirim ke printer' : `Gagal: ${r[0].error}`, r[0].ok ? 'ok' : 'err');
  }
  const mine = useLiveQuery(() => (order.customer_id ? db.orders.where('customer_id').equals(order.customer_id).toArray() : Promise.resolve([] as Order[])), [order.customer_id]) || [];
  const bal = mine.filter((o) => !o.void).reduce((s, o) => s + (o.points_earned || 0) - (o.points_redeemed || 0), 0);
  const custRec = useLiveQuery(async () => (order.customer_id ? await db.customers.get(order.customer_id) : undefined), [order.customer_id]);
  const doc = show === 'struk' ? buildStruk(order, payments, settings, custRec?.member ? { pointsBalance: bal, memberNo: custRec.phone } : {}) : buildTiket(order, settings);
  return (
    <Modal title="Transaksi tersimpan" onClose={onClose} wide footer={<button className="btn primary big grow" onClick={onClose} autoFocus data-testid="btn-baru">Transaksi baru</button>}>
      <div className="success">
        <div className="stack">
          <div className="big-no" data-testid="order-no">{order.no}</div>
          <div className="muted">{rp(order.total)} · {order.fulfillment === 'sekarang' ? 'ready' : `${order.fulfillment === 'antar' ? 'antar' : 'ambil'} ${fmtDate(order.due_at)}`}{order.florist ? ` · perangkai ${order.florist}` : ''}</div>
          {(['kasir', 'produksi'] as const).map((tg) => {
            const r = res.find((x) => x.target === tg);
            return (
              <div key={tg} className={`print-row ${r && !r.ok ? 'bad' : ''}`} data-testid={`print-${tg}`}>
                <div><b>{tg === 'kasir' ? 'Struk pelanggan' : 'Tiket produksi'}</b><div className="muted">{r ? label(r) : '-'}</div></div>
                <button className="btn" onClick={() => reprint(tg)}><Icon name="print" size={18} />Cetak ulang</button>
              </div>
            );
          })}
        </div>
        <div>
          <Seg value={show} onChange={setShow} options={[{ value: 'struk', label: 'Struk' }, { value: 'tiket', label: 'Tiket' }]} />
          <ReceiptPreview doc={doc} width={58} testId="preview" />
        </div>
      </div>
    </Modal>
  );
}
