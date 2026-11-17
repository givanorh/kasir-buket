// Riwayat transaksi: catatan saja. Tidak ada pelunasan, ubah status, atau pembatalan di sini
// (semua aksi operasional ada di Produksi). Detail hanya menampilkan invoice dan status transaksi.
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { paymentStatus } from '../lib/calc';
import { addDays, fmtDateTime, fmtShort, rp, startOfDay } from '../lib/format';
import { docFor, printOrder } from '../lib/print';
import { Badge, Empty, Modal, Seg, toast } from '../components/ui';
import { Icon } from '../components/icons';
import { ReceiptPreview } from '../components/ReceiptPreview';
import { livePays, paidSum, payBadge, prodBadge } from '../components/Order';
import type { Order } from '../lib/types';

type Filter = 'hari' | 'jadwal' | 'piutang' | '30';

export default function Riwayat() {
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
      <div className="table" style={{ ['--cols' as string]: '150px minmax(0,1fr) 170px 150px 110px 44px', ['--cols-sm' as string]: 'minmax(96px,auto) minmax(0,1fr) auto 40px' }}>
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
        {!list.length && <Empty>Tidak ada transaksi.</Empty>}
      </div>
      {sel && <RiwayatDetail order={sel} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Detail catatan transaksi: invoice + status. DP dan pelunasan tampil dengan nominal dan tanggalnya. */
export function RiwayatDetail({ order, onClose }: { order: Order; onClose: () => void }) {
  const paymentsQ = useLiveQuery(() => db.payments.where('order_id').equals(order.id).toArray(), [order.id]);
  const doc = useLiveQuery(() => docFor(order, 'struk'), [order]);
  const pays = livePays(paymentsQ || []);
  const paid = paidSum(pays);
  const due = Math.max(0, order.total - paid);
  const st = paymentStatus(order.total, paid);
  const dp = pays.filter((p) => p.kind === 'dp');
  const lunasan = pays.filter((p) => p.kind === 'pelunasan');
  const sekali = pays.filter((p) => p.kind === 'lunas');
  const cr = order.cancel_request;
  async function reprint() {
    const r = await printOrder(order, ['kasir'], { copyLabel: 'CETAK ULANG' });
    toast(r[0].ok ? (r[0].mode === 'relay' ? 'Dikirim ke stasiun cetak' : 'Dikirim ke printer') : `Gagal: ${r[0].error}`, r[0].ok ? 'ok' : 'err');
  }
  const PayRows = ({ label, xs }: { label: string; xs: typeof pays }) => (
    <>{xs.map((p, i) => (
      <div key={p.id} className="kv" data-testid={`riw-${p.kind}`}>
        <span>{label}{xs.length > 1 ? ` ${i + 1}` : ''} · {p.method}</span>
        <b>{rp(p.amount)} · {fmtDateTime(p.created_at)}</b>
      </div>
    ))}</>
  );

  return (
    <Modal title={`Transaksi ${order.no}`} onClose={onClose} wide
      footer={<button className="btn grow" onClick={reprint} data-testid="riw-cetak"><Icon name="print" size={16} /> Cetak ulang struk</button>}>
      <div className="detail" data-testid="riwayat-detail">
        <div className="stack">
          <h3>Invoice</h3>
          {doc ? <ReceiptPreview doc={doc} width={58} testId="riw-invoice" /> : <p className="muted">Memuat…</p>}
        </div>
        <div className="stack">
          <h3>Status transaksi</h3>
          <div className="kv"><span>Pembayaran</span><b data-testid="riw-status">{order.void ? <Badge tone="red">Dibatalkan</Badge> : payBadge(st)}</b></div>
          <div className="kv"><span>Produksi</span><b>{prodBadge(order.production_status)}</b></div>
          <div className="kv"><span>Dibuat</span><b>{fmtDateTime(order.created_at)} · {order.cashier_name}</b></div>
          {order.ready_at && <div className="kv"><span>Siap</span><b>{fmtDateTime(order.ready_at)}</b></div>}
          {order.done_at && <div className="kv"><span>Diambil/diantar</span><b>{fmtDateTime(order.done_at)}</b></div>}
          {order.void && <div className="note warn">Dibatalkan{order.void_at ? ` ${fmtDateTime(order.void_at)}` : ''}: {order.void_reason}</div>}
          {!order.void && cr?.status === 'pending' && <div className="note warn small">Pengajuan pembatalan oleh {cr.by_name} menunggu persetujuan owner.</div>}

          <h3>Rincian pembayaran</h3>
          <div className="kv"><span>Total transaksi</span><b>{rp(order.total)}</b></div>
          <PayRows label="Dibayar lunas" xs={sekali} />
          <PayRows label="DP" xs={dp} />
          <PayRows label="Pelunasan" xs={lunasan} />
          {!pays.length && paymentsQ && <div className="kv"><span>Pembayaran</span><b>Belum ada</b></div>}
          <div className="kv"><span>Total dibayar</span><b>{rp(paid)}</b></div>
          {!order.void && <div className="kv"><span>Sisa tagihan</span><b className={due ? 'red' : 'ok'} data-testid="riw-sisa">{due ? rp(due) : 'Lunas'}</b></div>}
          {!order.void && due > 0 && <p className="muted small">Pelunasan dilakukan kasir di menu Produksi (tombol Bayar pelunasan pada kartu pesanan).</p>}
        </div>
      </div>
    </Modal>
  );
}
