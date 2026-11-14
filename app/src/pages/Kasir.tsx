import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { cartTotals, scheduledQtyOn } from '../lib/calc';
import { addDays, dayKey, fmtDate, fromLocalInput, num, rp, toLocalInput } from '../lib/format';
import { activeShift, checkout, stockLevels, type CheckoutInput } from '../lib/store';
import { printOrder, previewText, type PrintResult } from '../lib/print';
import { buildStruk, buildTiket } from '../lib/print/receipts';
import { Field, Modal, MoneyInput, Seg, toast } from '../components/ui';
import type { Fulfillment, Order, OrderItem, Product } from '../lib/types';

const COLORS = ['#f6d6de', '#fde2c8', '#d9ecd9', '#dbe4f7', '#efdcf5', '#f9e9b8'];

export default function Kasir() {
  const products = useLiveQuery(() => db.products.toArray(), []) || [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) || [];
  const stock = useLiveQuery(() => stockLevels(), []) || new Map<string, number>();
  const shift = useLiveQuery(() => activeShift(), []);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [custom, setCustom] = useState(false);
  const [pay, setPay] = useState(false);
  const [done, setDone] = useState<{ order: Order; results: PrintResult[] } | null>(null);
  const [tab, setTab] = useState<'produk' | 'keranjang'>('produk');

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products
      .filter((p) => p.active !== false && !p.deleted && p.type !== 'bahan')
      .filter((p) => !cat || p.category_id === cat)
      .filter((p) => !s || p.name.toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, q, cat]);
  const totals = cartTotals(cart);

  function add(p: Product) {
    setCart((c) => {
      const i = c.findIndex((x) => x.product_id === p.id && !x.note && !x.discount);
      if (i >= 0) return c.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x));
      return [...c, { product_id: p.id, name: p.name, sku: p.sku, qty: 1, price: p.price, cost: p.cost || 0, discount: 0, type: p.type }];
    });
  }
  const setQty = (i: number, d: number) => setCart((c) => c.flatMap((x, j) => (j !== i ? [x] : x.qty + d <= 0 ? [] : [{ ...x, qty: x.qty + d }])));

  return (
    <div className="pos">
      <div className="pos-tabs">
        <Seg value={tab} onChange={setTab} options={[{ value: 'produk', label: 'Produk' }, { value: 'keranjang', label: `Keranjang (${totals.qty})` }]} />
      </div>
      <section className={`pos-left ${tab === 'produk' ? 'show' : ''}`}>
        {!shift && <div className="note warn">Shift belum dibuka. Transaksi tetap bisa, tetapi rekap kas laci lebih akurat bila shift dibuka di menu <a href="#/shift">Shift</a>.</div>}
        <div className="pos-search">
          <input placeholder="Cari buket / kode…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" onClick={() => setCustom(true)}>＋ Item custom</button>
        </div>
        <div className="chips">
          <button className={!cat ? 'on' : ''} onClick={() => setCat('')}>Semua</button>
          {categories.filter((c) => !c.deleted).sort((a, b) => (a.sort || 0) - (b.sort || 0)).map((c) => (
            <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>{c.name}</button>
          ))}
        </div>
        <div className="grid">
          {list.map((p, i) => {
            const st = p.track_stock ? stock.get(p.id) || 0 : null;
            return (
              <button key={p.id} className="pcard" onClick={() => add(p)} disabled={st !== null && st <= 0} data-testid="product-card">
                <div className="pimg" style={{ background: p.photo ? `center/cover url(${p.photo})` : COLORS[i % COLORS.length] }}>{!p.photo && p.name.slice(0, 1)}</div>
                <div className="pname">{p.name}</div>
                <div className="pprice">{rp(p.price)}</div>
                {st !== null && <div className={`pstock ${st <= (p.min_stock || 0) ? 'low' : ''}`}>Stok {st}</div>}
              </button>
            );
          })}
          {!list.length && <div className="empty">Belum ada produk. Tambahkan di menu Produk, atau pakai “Item custom”.</div>}
        </div>
      </section>

      <section className={`pos-right ${tab === 'keranjang' ? 'show' : ''}`}>
        <div className="cart">
          {cart.map((it, i) => (
            <div key={i} className="citem">
              <div className="cmain" onClick={() => setEditIdx(i)}>
                <div className="cname">{it.name}</div>
                <div className="csub">{num(it.price)}{it.discount ? ` · pot. ${num(it.discount)}` : ''}{it.note ? ` · ${it.note}` : ''}</div>
              </div>
              <div className="qty">
                <button onClick={() => setQty(i, -1)} aria-label="Kurangi">−</button>
                <span>{it.qty}</span>
                <button onClick={() => setQty(i, 1)} aria-label="Tambah">＋</button>
              </div>
              <div className="cline">{num(it.qty * it.price - it.discount)}</div>
            </div>
          ))}
          {!cart.length && <div className="empty">Keranjang kosong</div>}
        </div>
        <div className="cart-foot">
          <div className="row"><span>Subtotal ({totals.qty} item)</span><b>{rp(totals.subtotal)}</b></div>
          {totals.item_discount > 0 && <div className="row"><span>Potongan</span><b>−{rp(totals.item_discount)}</b></div>}
          <div className="row actions">
            <button className="btn" onClick={() => setCart([])} disabled={!cart.length}>Kosongkan</button>
            <button className="btn primary big grow" disabled={!cart.length} onClick={() => setPay(true)} data-testid="btn-bayar">Bayar {rp(totals.total)}</button>
          </div>
        </div>
      </section>

      {editIdx !== null && cart[editIdx] && (
        <ItemEditor item={cart[editIdx]} onClose={() => setEditIdx(null)}
          onSave={(it) => { setCart((c) => c.map((x, j) => (j === editIdx ? it : x))); setEditIdx(null); }}
          onRemove={() => { setCart((c) => c.filter((_, j) => j !== editIdx)); setEditIdx(null); }} />
      )}
      {custom && (
        <ItemEditor isNew item={{ name: 'Buket custom', qty: 1, price: 0, cost: 0, discount: 0, type: 'buket' }} onClose={() => setCustom(false)}
          onSave={(it) => { setCart((c) => [...c, it]); setCustom(false); }} />
      )}
      {pay && (
        <Checkout items={cart} onClose={() => setPay(false)}
          onDone={(order, results) => { setPay(false); setCart([]); setTab('produk'); setDone({ order, results }); }} />
      )}
      {done && <Success order={done.order} results={done.results} onClose={() => setDone(null)} />}
    </div>
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
          <Field label="Potongan baris (Rp)"><MoneyInput value={it.discount} onChange={(discount) => setIt({ ...it, discount: Math.min(discount, it.qty * it.price) })} /></Field>
          {isNew && <Field label="HPP/modal per unit"><MoneyInput value={it.cost} onChange={(cost) => setIt({ ...it, cost })} /></Field>}
        </div>
        <Field label="Catatan item (warna, ukuran, isi)"><input value={it.note || ''} onChange={(e) => setIt({ ...it, note: e.target.value })} placeholder="mis. mawar merah 20 tangkai, wrapping hitam" /></Field>
      </div>
    </Modal>
  );
}

function Checkout({ items, onClose, onDone }: { items: OrderItem[]; onClose: () => void; onDone: (o: Order, r: PrintResult[]) => void }) {
  const settings = useLiveQuery(() => db.settings.get('toko'));
  const customers = useLiveQuery(() => db.customers.toArray(), []) || [];
  const orders = useLiveQuery(() => db.orders.where('due_at').above(addDays(new Date(), -1).toISOString()).toArray(), []) || [];
  const methods = settings?.payment_methods?.length ? settings.payment_methods : ['Tunai', 'QRIS', 'Transfer'];
  const [f, setF] = useState({
    name: '', phone: '', fulfillment: 'sekarang' as Fulfillment, due: toLocalInput(new Date(Date.now() + 3 * 3600e3)),
    recipient: '', recipientPhone: '', address: '', fee: 0, card: '', notes: '', disc: 0,
    method: 'Tunai', payType: 'lunas' as 'lunas' | 'dp' | 'nanti', dp: 0, received: 0,
  });
  const [busy, setBusy] = useState(false);
  const t = cartTotals(items, f.disc, f.fulfillment === 'antar' ? f.fee : 0);
  const payAmount = f.payType === 'lunas' ? t.total : f.payType === 'dp' ? Math.min(f.dp, t.total) : 0;
  const change = f.method === 'Tunai' ? Math.max(0, f.received - payAmount) : 0;
  const shortCash = f.method === 'Tunai' && payAmount > 0 && f.received > 0 && f.received < payAmount;
  const dueIso = f.fulfillment === 'sekarang' ? null : fromLocalInput(f.due);
  const cap = settings?.daily_capacity || 0;
  const scheduled = dueIso ? scheduledQtyOn(orders, dayKey(dueIso), dayKey) : 0;
  const newQty = items.filter((i) => (i.type || 'buket') === 'buket').reduce((s, i) => s + i.qty, 0);
  const sugg = (() => {
    const xs = [payAmount, Math.ceil(payAmount / 50000) * 50000, Math.ceil(payAmount / 100000) * 100000, payAmount + 50000];
    return [...new Set(xs.filter((x) => x >= payAmount && x > 0))].slice(0, 4);
  })();
  const matches = f.phone.length >= 3 || f.name.length >= 2
    ? customers.filter((c) => (f.phone && (c.phone || '').includes(f.phone.replace(/\D/g, ''))) || (f.name && c.name.toLowerCase().includes(f.name.toLowerCase()))).slice(0, 4)
    : [];
  const needCustomer = f.payType !== 'lunas' || f.fulfillment !== 'sekarang';
  const invalid = (needCustomer && !f.name.trim()) || (f.fulfillment !== 'sekarang' && !dueIso) || (f.payType === 'dp' && (f.dp <= 0 || f.dp >= t.total)) || shortCash;

  async function submit() {
    setBusy(true);
    try {
      const input: CheckoutInput = {
        items, orderDiscount: f.disc, extraFee: f.fulfillment === 'antar' ? f.fee : 0,
        customer: { name: f.name, phone: f.phone }, fulfillment: f.fulfillment, dueAt: dueIso,
        recipientName: f.recipient, recipientPhone: f.recipientPhone, deliveryAddress: f.address,
        cardMessage: f.card, notes: f.notes, payMethod: f.method, payAmount, cashReceived: f.received || payAmount,
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
    <Modal title={`Pembayaran · ${rp(t.total)}`} onClose={onClose} wide
      footer={<button className="btn primary big grow" disabled={busy || invalid} onClick={submit} data-testid="btn-simpan">
        {busy ? 'Menyimpan…' : f.payType === 'lunas' ? `Simpan & Cetak · ${rp(t.total)}` : `Simpan pesanan · bayar ${rp(payAmount)}`}
      </button>}>
      <div className="checkout">
        <div className="stack">
          <h3>Pelanggan</h3>
          <div className="cols">
            <Field label={`Nama${needCustomer ? ' *' : ''}`}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="cust-name" /></Field>
            <Field label="No. HP/WA"><input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          </div>
          {matches.length > 0 && !customers.some((c) => c.name === f.name && c.phone === f.phone) && (
            <div className="chips small">{matches.map((c) => <button key={c.id} onClick={() => setF({ ...f, name: c.name, phone: c.phone || '', address: f.address || c.address || '' })}>{c.name} {c.phone}</button>)}</div>
          )}

          <h3>Pengambilan</h3>
          <Seg value={f.fulfillment} onChange={(fulfillment) => setF({ ...f, fulfillment })}
            options={[{ value: 'sekarang', label: 'Ditunggu' }, { value: 'ambil', label: 'Ambil nanti' }, { value: 'antar', label: 'Diantar' }]} />
          {f.fulfillment !== 'sekarang' && (
            <>
              <Field label="Tanggal & jam" hint={cap ? <span className={scheduled + newQty > cap ? 'red' : ''}>Kapasitas {fmtDate(dueIso)}: {scheduled} + {newQty} dari {cap} buket</span> : undefined}>
                <input type="datetime-local" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} data-testid="due" />
              </Field>
            </>
          )}
          {f.fulfillment === 'antar' && (
            <>
              <div className="cols">
                <Field label="Nama penerima"><input value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value })} /></Field>
                <Field label="HP penerima"><input inputMode="tel" value={f.recipientPhone} onChange={(e) => setF({ ...f, recipientPhone: e.target.value })} /></Field>
              </div>
              <Field label="Alamat antar"><textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
              <Field label="Ongkir"><MoneyInput value={f.fee} onChange={(fee) => setF({ ...f, fee })} /></Field>
            </>
          )}
          <Field label="Kartu ucapan"><textarea rows={2} value={f.card} onChange={(e) => setF({ ...f, card: e.target.value })} placeholder="Happy Graduation, Rina! 🎓" data-testid="card" /></Field>
          <Field label="Catatan rangkaian (untuk perangkai)"><textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="warna dominan pink, pita satin putih" data-testid="notes" /></Field>
        </div>

        <div className="stack">
          <h3>Ringkasan</h3>
          <div className="sum">
            <div className="row"><span>Subtotal</span><span>{rp(t.subtotal)}</span></div>
            {t.item_discount > 0 && <div className="row"><span>Potongan item</span><span>−{rp(t.item_discount)}</span></div>}
            <div className="row"><span>Diskon transaksi</span><MoneyInput value={f.disc} onChange={(disc) => setF({ ...f, disc })} ariaLabel="Diskon transaksi" /></div>
            {t.extra_fee > 0 && <div className="row"><span>Ongkir</span><span>{rp(t.extra_fee)}</span></div>}
            <div className="row total"><span>Total</span><span>{rp(t.total)}</span></div>
          </div>
          <h3>Pembayaran</h3>
          <Seg value={f.payType} onChange={(payType) => setF({ ...f, payType, dp: payType === 'dp' && !f.dp ? Math.round((t.total * (settings?.dp_min_percent || 50)) / 100 / 1000) * 1000 : f.dp })}
            options={[{ value: 'lunas', label: 'Lunas' }, { value: 'dp', label: 'DP' }, { value: 'nanti', label: 'Bayar nanti' }]} />
          {f.payType === 'dp' && <Field label="Jumlah DP" hint={`Sisa ditagih saat ambil: ${rp(t.total - payAmount)}`}><MoneyInput value={f.dp} onChange={(dp) => setF({ ...f, dp })} /></Field>}
          {f.payType !== 'nanti' && (
            <>
              <div className="chips methods">{methods.map((m) => <button key={m} className={f.method === m ? 'on' : ''} onClick={() => setF({ ...f, method: m })}>{m}</button>)}</div>
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
  const label = (r: PrintResult) => r.mode === 'relay' ? 'dikirim ke perangkat stasiun' : r.mode === 'none' ? 'printer tidak diatur' : r.mode === 'system' ? 'dialog cetak dibuka' : r.ok ? 'tercetak' : `gagal: ${r.error}`;
  async function reprint(target: 'kasir' | 'produksi') {
    const r = await printOrder(order, [target], { copyLabel: target === 'kasir' ? 'CETAK ULANG' : undefined });
    setRes((x) => [...x.filter((y) => y.target !== target), ...r]);
    toast(r[0].ok ? 'Dikirim ke printer' : `Gagal: ${r[0].error}`, r[0].ok ? 'ok' : 'err');
  }
  const doc = show === 'struk' ? buildStruk(order, payments, settings) : buildTiket(order, settings);
  return (
    <Modal title="Transaksi berhasil ✓" onClose={onClose} wide footer={<button className="btn primary big grow" onClick={onClose} autoFocus data-testid="btn-baru">Transaksi baru</button>}>
      <div className="success">
        <div className="stack">
          <div className="big-no" data-testid="order-no">{order.no}</div>
          <div className="muted">{rp(order.total)} · {order.fulfillment === 'sekarang' ? 'ditunggu' : `${order.fulfillment === 'antar' ? 'antar' : 'ambil'} ${fmtDate(order.due_at)}`}</div>
          {(['kasir', 'produksi'] as const).map((t) => {
            const r = res.find((x) => x.target === t);
            return (
              <div key={t} className={`print-row ${r && !r.ok ? 'bad' : ''}`} data-testid={`print-${t}`}>
                <div><b>{t === 'kasir' ? 'Struk pelanggan (printer kasir)' : 'Tiket produksi (ruang perangkai)'}</b><div className="muted">{r ? label(r) : '-'}</div></div>
                <button className="btn" onClick={() => reprint(t)}>Cetak ulang</button>
              </div>
            );
          })}
        </div>
        <div>
          <Seg value={show} onChange={setShow} options={[{ value: 'struk', label: 'Struk' }, { value: 'tiket', label: 'Tiket' }]} />
          <pre className="receipt" data-testid="preview">{previewText(doc, 58).join('\n')}</pre>
        </div>
      </div>
    </Modal>
  );
}
