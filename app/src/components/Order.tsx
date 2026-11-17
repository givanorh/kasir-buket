// Komponen pesanan bersama: label status, detail operasional (Produksi), jendela pelunasan, dan pembatalan.
// Riwayat (pages/Pesanan.tsx) hanya menampilkan catatan; semua aksi ada di sini dan dipakai halaman Produksi.
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { addPayment, decideCancel, requestCancel, save, setProductionStatus, voidOrder, withdrawCancel } from '../lib/store';
import { fmtDateTime, fmtShort, num, rp } from '../lib/format';
import { printOrder } from '../lib/print';
import { useSession } from '../lib/session';
import { storeCfg } from '../lib/settings';
import { Badge, Field, Modal, MoneyInput, toast } from './ui';
import { canSetStatus } from '../lib/rules';
import type { Order, Payment, ProductionStatus } from '../lib/types';

export const PROD_LABEL: Record<ProductionStatus, string> = { antri: 'Antri', dirangkai: 'Dirangkai', siap: 'Siap', selesai: 'Selesai', batal: 'Batal' };
const PROD_TONE: Record<ProductionStatus, 'gray' | 'amber' | 'blue' | 'green' | 'red'> = { antri: 'gray', dirangkai: 'amber', siap: 'blue', selesai: 'green', batal: 'red' };
export const prodBadge = (s: ProductionStatus) => <Badge tone={PROD_TONE[s]}>{PROD_LABEL[s]}</Badge>;
export const payBadge = (st: 'lunas' | 'dp' | 'belum') => <Badge tone={st === 'lunas' ? 'green' : st === 'dp' ? 'amber' : 'red'}>{st === 'lunas' ? 'Lunas' : st === 'dp' ? 'DP' : 'Belum bayar'}</Badge>;
export const PAY_KIND: Record<Payment['kind'], string> = { lunas: 'Lunas', dp: 'DP', pelunasan: 'Pelunasan' };

export const livePays = (ps: Payment[]) => ps.filter((p) => !p.void).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
export const paidSum = (ps: Payment[]) => ps.filter((p) => !p.void).reduce((s, p) => s + p.amount, 0);


/** Jendela pelunasan DP / bayar nanti. Setelah lunas, struk pelunasan dicetak ke printer kasir. */
export function PelunasanModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const paymentsQ = useLiveQuery(() => db.payments.where('order_id').equals(order.id).toArray(), [order.id]);
  const settings = useLiveQuery(() => db.settings.get('toko'));
  const methods = storeCfg(settings).methods;
  const pays = livePays(paymentsQ || []);
  const paid = paidSum(pays);
  const due = Math.max(0, order.total - paid);
  const [method, setMethod] = useState('Tunai');
  const [amt, setAmt] = useState(0);
  const [received, setReceived] = useState(0);
  const [busy, setBusy] = useState(false);
  const pay = Math.min(amt || due, due);
  const cash = method === 'Tunai';
  const short = cash && received > 0 && received < pay;
  const change = cash ? Math.max(0, received - pay) : 0;
  const sugg = [...new Set([pay, Math.ceil(pay / 50000) * 50000, Math.ceil(pay / 100000) * 100000].filter((x) => x >= pay && x > 0))].slice(0, 3);

  async function submit() {
    setBusy(true);
    try {
      const a = await addPayment(order, method, pay);
      if (!a) { toast('Tidak ada sisa tagihan'); onClose(); return; }
      if (paid + a >= order.total) {
        const r = await printOrder(order, ['kasir'], { copyLabel: 'STRUK PELUNASAN' });
        toast(`Lunas. Pelunasan ${rp(a)} dicatat${change ? `, kembalian ${rp(change)}` : ''}. ${r[0]?.ok ? 'Struk pelunasan dicetak.' : `Struk gagal dicetak: ${r[0]?.error}`}`, r[0]?.ok ? 'ok' : 'err');
      } else {
        toast(`Pembayaran ${rp(a)} dicatat. Sisa ${rp(order.total - paid - a)}.`);
      }
      onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Pelunasan ${order.no}`} onClose={onClose}
      footer={<button className="btn primary big grow" disabled={busy || !paymentsQ || !due || pay <= 0 || short} onClick={submit} data-testid="btn-lunasi">
        {busy ? 'Menyimpan…' : pay < due ? `Bayar sebagian · ${rp(pay)}` : `Bayar pelunasan · ${rp(pay)}`}</button>}>
      <div className="stack" data-testid="pelunasan">
        <div className="sum">
          <div className="row"><span>{order.customer_name || 'Umum'} · {order.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</span></div>
          <div className="row"><span>Total</span><b>{rp(order.total)}</b></div>
          {pays.map((p) => <div key={p.id} className="row muted"><span>{PAY_KIND[p.kind]} {p.method} · {fmtShort(p.created_at)}</span><span>−{num(p.amount)}</span></div>)}
          <div className="row total"><span>Sisa tagihan</span><span data-testid="sisa">{rp(due)}</span></div>
        </div>
        <div className="chips">{methods.map((m) => <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{m}</button>)}</div>
        <Field label="Nominal pelunasan" hint={pay < due ? `Sisa setelah bayar: ${rp(due - pay)}` : 'Default = seluruh sisa tagihan'}><MoneyInput value={amt || due} onChange={setAmt} ariaLabel="Nominal pelunasan" /></Field>
        {cash && (
          <>
            <Field label="Uang diterima"><MoneyInput value={received} onChange={setReceived} ariaLabel="Uang diterima pelunasan" /></Field>
            <div className="chips small">{sugg.map((x) => <button key={x} onClick={() => setReceived(x)}>{x === pay ? 'Uang pas' : num(x)}</button>)}</div>
            {received > 0 && <div className={`change ${short ? 'red' : ''}`}>{short ? `Kurang ${rp(pay - received)}` : `Kembalian ${rp(change)}`}</div>}
          </>
        )}
        <p className="muted small">Setelah lunas, struk pelunasan (status LUNAS, tanggal DP dan pelunasan) otomatis dicetak ke printer kasir.</p>
      </div>
    </Modal>
  );
}

const REASONS = ['Pelanggan membatalkan', 'Salah input', 'Bahan tidak tersedia', 'Pesanan dobel', 'Tidak bisa diantar'];

function CancelModal({ mode, order, onClose, onSubmit }: { mode: 'void' | 'request'; order: Order; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={mode === 'request' ? `Ajukan pembatalan ${order.no}` : `Batalkan ${order.no}`} onClose={onClose}
      footer={<button className="btn danger grow" disabled={busy || reason.trim().length < 3} data-testid="kirim-batal"
        onClick={async () => { setBusy(true); try { await onSubmit(reason); } finally { setBusy(false); } }}>
        {mode === 'request' ? 'Kirim pengajuan ke owner' : 'Batalkan transaksi'}</button>}>
      <div className="stack">
        <p className="muted">{mode === 'request' ? `Pesanan ini sudah lunas (${rp(order.total)}). Owner menerima pengajuan beserta alasan, lalu menyetujui atau menolak.` : 'Pesanan dan pembayarannya dibatalkan; stok produk dikembalikan.'}</p>
        <div className="chips small">{REASONS.map((r) => <button key={r} className={reason === r ? 'on' : ''} onClick={() => setReason(r)}>{r}</button>)}</div>
        <Field label="Alasan (wajib)"><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="alasan-batal" /></Field>
      </div>
    </Modal>
  );
}

/** Detail operasional pesanan (dibuka dari Produksi): perangkai, status sesuai peran, pelunasan, cetak, pembatalan. */
export function OrderDetail({ order, onClose }: { order: Order; onClose: () => void }) {
  const s = useSession();
  const role = s.user?.role;
  const paymentsQ = useLiveQuery(() => db.payments.where('order_id').equals(order.id).toArray(), [order.id]);
  const pays = livePays(paymentsQ || []);
  const settings = useLiveQuery(() => db.settings.get('toko'));
  const paid = paidSum(pays);
  const due = Math.max(0, order.total - paid);
  const canEdit = role !== 'perangkai';
  const owner = role === 'owner';
  const lunas = order.total > 0 && paid >= order.total;
  const cr = order.cancel_request;
  const pending = cr?.status === 'pending';
  const [cancelMode, setCancelMode] = useState<'void' | 'request' | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  async function submitCancel(reason: string) {
    if (cancelMode === 'request') { await requestCancel(order, reason); toast('Pengajuan pembatalan dikirim ke owner'); }
    else { await voidOrder(order, reason); toast('Transaksi dibatalkan'); }
    setCancelMode(null);
  }
  async function decide(ok: boolean) {
    const note = ok ? '' : window.prompt('Alasan menolak (opsional)') ?? null;
    if (note === null) return;
    await decideCancel(order, ok, note);
    toast(ok ? 'Pesanan dibatalkan' : 'Pengajuan ditolak');
  }
  async function reprint(t: 'kasir' | 'produksi') {
    const r = await printOrder(order, [t], { copyLabel: t === 'kasir' ? 'CETAK ULANG' : undefined });
    toast(r[0].ok ? (r[0].mode === 'relay' ? 'Dikirim ke stasiun cetak' : 'Dikirim ke printer') : `Gagal: ${r[0].error}`, r[0].ok ? 'ok' : 'err');
  }
  const statusHint = role === 'kasir' ? 'Antri → Dirangkai → Siap dikonfirmasi perangkai. Kasir menandai Selesai setelah lunas.'
    : role === 'perangkai' ? 'Selesai (sudah diambil) dikonfirmasi kasir setelah pelunasan.' : '';

  return (
    <Modal title={`Pesanan ${order.no}`} onClose={onClose} wide>
      <div className="detail">
        <div className="stack">
          <div className="kv"><span>Dibuat</span><b>{fmtDateTime(order.created_at)} · {order.cashier_name}</b></div>
          <div className="kv"><span>Pelanggan</span><b>{order.customer_name || 'Umum'} {order.customer_phone}</b></div>
          <div className="kv"><span>Pengambilan</span><b>{order.fulfillment === 'sekarang' ? 'Ditunggu' : `${order.fulfillment === 'antar' ? 'Diantar' : 'Diambil'} ${fmtDateTime(order.due_at)}`}</b></div>
          {order.fulfillment === 'antar' && <div className="kv"><span>Penerima</span><b>{order.recipient_name} {order.recipient_phone} · {order.delivery_address}</b></div>}
          {canEdit && order.delivery?.km ? <div className="kv"><span>Jarak antar</span><b>{(Math.ceil(order.delivery.km * 10) / 10).toLocaleString('id-ID')} km · ongkir {rp(order.extra_fee)}</b></div> : null}
          {order.card_message && <div className="kv"><span>Kartu ucapan</span><b>“{order.card_message}”</b></div>}
          {order.notes && <div className="kv"><span>Catatan</span><b>{order.notes}</b></div>}
          <div className="kv"><span>Produksi</span><b>{prodBadge(order.production_status)}</b></div>
          {order.void && <div className="note warn">Dibatalkan: {order.void_reason}</div>}
          <div className="items">
            {order.items.map((it, i) => (
              <div key={i} className="row"><span>{it.qty}× {it.name}{it.note ? <i className="muted"> · {it.note}</i> : null}</span>{canEdit && <span>{rp(it.qty * it.price - it.discount)}</span>}</div>
            ))}
            {canEdit && order.order_discount > 0 && <div className="row"><span>Diskon</span><span>−{rp(order.order_discount)}</span></div>}
            {canEdit && order.extra_fee > 0 && <div className="row"><span>Ongkir/biaya</span><span>{rp(order.extra_fee)}</span></div>}
            {canEdit && <div className="row total"><span>Total</span><span>{rp(order.total)}</span></div>}
          </div>
        </div>
        <div className="stack">
          {canEdit && (
            <>
              <h3>Pembayaran</h3>
              {pays.map((p) => <div key={p.id} className="row"><span>{PAY_KIND[p.kind]} · {p.method} · {fmtShort(p.created_at)}</span><b>{rp(p.amount)}</b></div>)}
              <div className="row"><span>Sisa tagihan</span><b className={due ? 'red' : 'ok'} data-testid="sisa-detail">{due ? rp(due) : 'Lunas'}</b></div>
              {due > 0 && !order.void && <button className="btn primary" onClick={() => setPayOpen(true)} data-testid="detail-bayar-pelunasan">Bayar pelunasan · {rp(due)}</button>}
            </>
          )}
          <h3>Perangkai</h3>
          <div className="chips small">
            {[...new Set([...storeCfg(settings).florists, ...(order.florist ? [order.florist] : [])])].map((n) => (
              <button key={n} disabled={!canEdit || order.void} className={order.florist === n ? 'on' : ''} onClick={() => save<Order>('orders', order.id, { florist: order.florist === n ? '' : n })}>{n}</button>
            ))}
          </div>
          <h3>Status produksi</h3>
          <div className="chips" data-testid="status-chips">
            {(['antri', 'dirangkai', 'siap', 'selesai'] as ProductionStatus[]).map((st) => (
              <button key={st} disabled={!canSetStatus(role, order, st, due)} className={order.production_status === st ? 'on' : ''} onClick={() => setProductionStatus(order, st)}>{PROD_LABEL[st]}</button>
            ))}
          </div>
          {statusHint && <p className="muted small">{statusHint}{role !== 'perangkai' && due > 0 && order.production_status === 'siap' ? ' Pesanan belum lunas: bayar pelunasan dulu.' : ''}</p>}
          <h3>Cetak</h3>
          <div className="chips">
            {canEdit && <button onClick={() => reprint('kasir')}>Struk</button>}
            <button onClick={() => reprint('produksi')}>Tiket produksi</button>
          </div>
          {pending && !order.void && (
            <div className="note warn" data-testid="cancel-pending">
              <b>Pengajuan pembatalan oleh {cr!.by_name}</b> ({fmtShort(cr!.at)}): “{cr!.reason}”
              {owner ? (
                <div className="btns" style={{ marginTop: 8 }}>
                  <button className="btn small" onClick={() => decide(false)}>Tolak</button>
                  <button className="btn small danger" onClick={() => decide(true)} data-testid="setujui-batal-detail">Setujui &amp; batalkan</button>
                </div>
              ) : <div className="btns" style={{ marginTop: 8 }}><span className="muted">Menunggu persetujuan owner.</span>{canEdit && <button className="btn small ghost" onClick={() => withdrawCancel(order)}>Tarik pengajuan</button>}</div>}
            </div>
          )}
          {cr?.status === 'rejected' && !order.void && <div className="note small">Pengajuan pembatalan ditolak {cr.decided_by_name}{cr.decision_note ? `: ${cr.decision_note}` : ''}.</div>}
          {canEdit && !order.void && !pending && paymentsQ && (
            owner || !lunas
              ? <button className="btn danger" onClick={() => setCancelMode('void')} data-testid="btn-batal">Batalkan transaksi</button>
              : <button className="btn danger" onClick={() => setCancelMode('request')} data-testid="btn-ajukan-batal">Ajukan pembatalan ke owner</button>
          )}
          {canEdit && !owner && lunas && !order.void && !pending && <p className="muted small">Pesanan sudah lunas: pembatalan butuh persetujuan owner.</p>}
        </div>
      </div>
      {cancelMode && <CancelModal mode={cancelMode} order={order} onClose={() => setCancelMode(null)} onSubmit={submitCancel} />}
      {payOpen && <PelunasanModal order={order} onClose={() => setPayOpen(false)} />}
    </Modal>
  );
}
