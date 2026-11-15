import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { paymentStatus } from '../lib/calc';
import { addDays, endOfDay, fmtDateTime, fmtShort, rp, startOfDay } from '../lib/format';
import { addPayment, setProductionStatus, voidOrder } from '../lib/store';
import { printOrder } from '../lib/print';
import { useSession } from '../lib/session';
import { Badge, Empty, Field, Modal, MoneyInput, Seg, toast } from '../components/ui';
import { Icon } from '../components/icons';
import { storeCfg } from '../lib/settings';
import { save } from '../lib/store';
import type { Order, ProductionStatus } from '../lib/types';

export const PROD_LABEL: Record<ProductionStatus, string> = { antri: 'Antri', dirangkai: 'Dirangkai', siap: 'Siap', selesai: 'Selesai', batal: 'Batal' };
const PROD_TONE: Record<ProductionStatus, 'gray' | 'amber' | 'blue' | 'green' | 'red'> = { antri: 'gray', dirangkai: 'amber', siap: 'blue', selesai: 'green', batal: 'red' };
export const prodBadge = (s: ProductionStatus) => <Badge tone={PROD_TONE[s]}>{PROD_LABEL[s]}</Badge>;
export const payBadge = (st: 'lunas' | 'dp' | 'belum') => <Badge tone={st === 'lunas' ? 'green' : st === 'dp' ? 'amber' : 'red'}>{st === 'lunas' ? 'Lunas' : st === 'dp' ? 'DP' : 'Belum bayar'}</Badge>;

type Filter = 'hari' | 'jadwal' | 'piutang' | '30';

export default function Pesanan() {
  const [filter, setFilter] = useState<Filter>('hari');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const orders = useLiveQuery(() => db.orders.toArray(), []) || [];
  const payments = useLiveQuery(() => db.payments.toArray(), []) || [];
  const paid = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments) if (!p.void) m.set(p.order_id, (m.get(p.order_id) || 0) + p.amount);
    return m;
  }, [payments]);

  const list = useMemo(() => {
    const now = new Date();
    const s = q.trim().toLowerCase();
    let xs = orders.filter((o) => !s || o.no.toLowerCase().includes(s) || (o.customer_name || '').toLowerCase().includes(s) || (o.customer_phone || '').includes(s));
    if (filter === 'hari') xs = xs.filter((o) => (o.created_at || '') >= startOfDay(now).toISOString());
    if (filter === 'jadwal') xs = xs.filter((o) => !o.void && o.fulfillment !== 'sekarang' && !['selesai', 'batal'].includes(o.production_status)).sort((a, b) => (a.due_at || '').localeCompare(b.due_at || ''));
    if (filter === 'piutang') xs = xs.filter((o) => !o.void && (paid.get(o.id) || 0) < o.total);
    if (filter === '30') xs = xs.filter((o) => (o.created_at || '') >= addDays(startOfDay(now), -30).toISOString());
    if (filter !== 'jadwal') xs.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return xs.slice(0, 300);
  }, [orders, filter, q, paid]);
  const sel = orders.find((o) => o.id === open);

  return (
    <div className="page">
      <div className="toolbar">
        <Seg value={filter} onChange={setFilter} options={[{ value: 'hari', label: 'Hari ini' }, { value: 'jadwal', label: 'Jadwal' }, { value: 'piutang', label: 'Belum lunas' }, { value: '30', label: '30 hari' }]} />
        <input className="grow" placeholder="Cari no / nama / HP" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table">
        {list.map((o) => {
          const pd = paid.get(o.id) || 0;
          return (
            <div key={o.id} role="button" tabIndex={0} className={`trow click ${o.void ? 'void' : ''}`} onClick={() => setOpen(o.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(o.id)} data-testid="order-row">
              <div><b>{o.no}</b><div className="muted">{fmtShort(o.created_at)}</div></div>
              <div className="grow">{o.customer_name || 'Umum'}<div className="muted">{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</div></div>
              <div className="hide-sm">{o.fulfillment === 'sekarang' ? <span className="muted">ditunggu</span> : <span>{o.fulfillment === 'antar' ? 'Antar' : 'Ambil'} {fmtShort(o.due_at)}</span>}</div>
              <div className="right"><b>{rp(o.total)}</b><div>{o.void ? <Badge tone="red">Batal</Badge> : payBadge(paymentStatus(o.total, pd))}</div></div>
              <div className="hide-sm">{prodBadge(o.production_status)}</div>
              <button className="icon-btn" title="Cetak ulang struk" aria-label={`Cetak ulang struk ${o.no}`} data-testid="reprint"
                onClick={async (e) => { e.stopPropagation(); const r = await printOrder(o, ['kasir'], { copyLabel: 'CETAK ULANG' }); toast(r[0].ok ? `Struk ${o.no} dikirim ke printer` : `Gagal: ${r[0].error}`, r[0].ok ? 'ok' : 'err'); }}>
                <Icon name="print" />
              </button>
            </div>
          );
        })}
        {!list.length && <Empty>Tidak ada pesanan.</Empty>}
      </div>
      {sel && <OrderDetail order={sel} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function OrderDetail({ order, onClose }: { order: Order; onClose: () => void }) {
  const s = useSession();
  const payments = useLiveQuery(() => db.payments.where('order_id').equals(order.id).toArray(), [order.id]) || [];
  const settings = useLiveQuery(() => db.settings.get('toko'));
  const paid = payments.filter((p) => !p.void).reduce((a, p) => a + p.amount, 0);
  const due = Math.max(0, order.total - paid);
  const [payAmt, setPayAmt] = useState(0);
  const [method, setMethod] = useState('Tunai');
  const canEdit = s.user?.role !== 'perangkai';

  async function pay() {
    const amt = await addPayment(order, method, payAmt || due);
    if (amt) { toast(`Pembayaran ${rp(amt)} dicatat`); setPayAmt(0); }
  }
  async function doVoid() {
    const reason = window.prompt('Alasan pembatalan transaksi ini?');
    if (!reason) return;
    await voidOrder(order, reason);
    toast('Transaksi dibatalkan');
  }
  async function reprint(t: 'kasir' | 'produksi') {
    const r = await printOrder(order, [t], { copyLabel: t === 'kasir' ? 'CETAK ULANG' : undefined });
    toast(r[0].ok ? (r[0].mode === 'relay' ? 'Dikirim ke stasiun cetak' : 'Dikirim ke printer') : `Gagal: ${r[0].error}`, r[0].ok ? 'ok' : 'err');
  }

  return (
    <Modal title={`Pesanan ${order.no}`} onClose={onClose} wide>
      <div className="detail">
        <div className="stack">
          <div className="kv"><span>Dibuat</span><b>{fmtDateTime(order.created_at)} · {order.cashier_name}</b></div>
          <div className="kv"><span>Pelanggan</span><b>{order.customer_name || 'Umum'} {order.customer_phone}</b></div>
          <div className="kv"><span>Pengambilan</span><b>{order.fulfillment === 'sekarang' ? 'Ditunggu' : `${order.fulfillment === 'antar' ? 'Diantar' : 'Diambil'} ${fmtDateTime(order.due_at)}`}</b></div>
          {order.fulfillment === 'antar' && <div className="kv"><span>Penerima</span><b>{order.recipient_name} {order.recipient_phone} · {order.delivery_address}</b></div>}
          {order.delivery?.km ? <div className="kv"><span>Jarak antar</span><b>{(Math.ceil(order.delivery.km * 10) / 10).toLocaleString('id-ID')} km · ongkir {rp(order.extra_fee)}</b></div> : null}
          {order.card_message && <div className="kv"><span>Kartu ucapan</span><b>“{order.card_message}”</b></div>}
          {order.notes && <div className="kv"><span>Catatan</span><b>{order.notes}</b></div>}
          <div className="kv"><span>Produksi</span><b>{prodBadge(order.production_status)}</b></div>
          {order.void && <div className="note warn">Dibatalkan: {order.void_reason}</div>}
          <div className="items">
            {order.items.map((it, i) => (
              <div key={i} className="row"><span>{it.qty}× {it.name}{it.note ? <i className="muted"> · {it.note}</i> : null}</span><span>{rp(it.qty * it.price - it.discount)}</span></div>
            ))}
            {order.order_discount > 0 && <div className="row"><span>Diskon</span><span>−{rp(order.order_discount)}</span></div>}
            {order.extra_fee > 0 && <div className="row"><span>Ongkir/biaya</span><span>{rp(order.extra_fee)}</span></div>}
            <div className="row total"><span>Total</span><span>{rp(order.total)}</span></div>
          </div>
        </div>
        <div className="stack">
          <h3>Pembayaran</h3>
          {payments.map((p) => (
            <div key={p.id} className={`row ${p.void ? 'strike' : ''}`}><span>{fmtShort(p.created_at)} · {p.kind} · {p.method}</span><b>{rp(p.amount)}</b></div>
          ))}
          <div className="row"><span>Sisa tagihan</span><b className={due ? 'red' : ''} data-testid="sisa">{rp(due)}</b></div>
          {canEdit && due > 0 && !order.void && (
            <div className="stack box">
              <div className="chips methods">{(settings?.payment_methods || ['Tunai']).map((m) => <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{m}</button>)}</div>
              <Field label="Nominal pelunasan"><MoneyInput value={payAmt || due} onChange={setPayAmt} /></Field>
              <button className="btn primary" onClick={pay} data-testid="btn-lunasi">Catat pembayaran</button>
            </div>
          )}
          <h3>Perangkai</h3>
          <div className="chips small">
            {[...new Set([...storeCfg(settings).florists, ...(order.florist ? [order.florist] : [])])].map((n) => (
              <button key={n} disabled={!canEdit || order.void} className={order.florist === n ? 'on' : ''} onClick={() => save<Order>('orders', order.id, { florist: order.florist === n ? '' : n })}>{n}</button>
            ))}
          </div>
          <h3>Status produksi</h3>
          <div className="chips">
            {(['antri', 'dirangkai', 'siap', 'selesai'] as ProductionStatus[]).map((st) => (
              <button key={st} disabled={order.void} className={order.production_status === st ? 'on' : ''} onClick={() => setProductionStatus(order, st)}>{PROD_LABEL[st]}</button>
            ))}
          </div>
          <h3>Cetak</h3>
          <div className="chips">
            <button onClick={() => reprint('kasir')}>Struk</button>
            <button onClick={() => reprint('produksi')}>Tiket produksi</button>
          </div>
          {canEdit && !order.void && <button className="btn danger" onClick={doVoid}>Batalkan transaksi</button>}
        </div>
      </div>
    </Modal>
  );
}

