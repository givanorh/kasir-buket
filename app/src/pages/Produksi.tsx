import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { addDays, dayKey, fmtDate, fmtShort, fmtTime, rp } from '../lib/format';
import { getDeviceConfig, setProductionStatus, type DeviceConfig } from '../lib/store';
import { retryJob } from '../lib/print';
import { Badge, Empty, Seg } from '../components/ui';
import { Icon } from '../components/icons';
import { AssignFloristModal, OrderDetail, PelunasanModal } from '../components/Order';
import { assigneeOf, canSetStatus, needsFlorist, rolesOf, type Florist } from '../lib/rules';
import { useFlorists } from '../lib/staff';
import type { SessionUser } from '../lib/session';
import { CancelRequests } from '../components/Alerts';
import { useSession } from '../lib/session';
import type { Order, Payment, ProductionStatus } from '../lib/types';

const COLS: { st: ProductionStatus; label: string; next: ProductionStatus; action: string }[] = [
  { st: 'antri', label: 'Antri', next: 'dirangkai', action: 'Mulai rangkai' },
  { st: 'dirangkai', label: 'Dirangkai', next: 'siap', action: 'Selesai dirangkai' },
  { st: 'siap', label: 'Siap diambil/antar', next: 'selesai', action: 'Sudah diambil' },
];

const sumPaid = (ps: Payment[]) => {
  const m = new Map<string, number>();
  for (const p of ps) if (!p.void) m.set(p.order_id, (m.get(p.order_id) || 0) + p.amount);
  return m;
};

/**
 * Papan ruang perangkai: urut jadwal, terlambat ditandai merah.
 * Antri → Dirangkai → Siap dikonfirmasi perangkai yang ditunjuk; Siap → Selesai (sudah diambil) dikonfirmasi kasir setelah lunas.
 * Kartu antri tanpa perangkai diberi peringatan dan tombol "Tunjuk perangkai" (Admin/owner).
 */
export default function Produksi() {
  const [when, setWhen] = useState<'aktif' | 'hari' | 'besok'>(() => (location.hash.includes('?besok') ? 'besok' : 'aktif'));
  const me = useSession().user;
  const role = me?.role;
  const isOwner = role === 'owner';
  const money = role !== 'perangkai';
  const [open, setOpen] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [flor, setFlor] = useState('');
  const florists = useFlorists();
  const [cfg, setCfg] = useState<DeviceConfig | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const load = () => getDeviceConfig().then(setCfg);
    load();
    window.addEventListener('device-config', load);
    const t = setInterval(() => tick((x) => x + 1), 60000);
    return () => { window.removeEventListener('device-config', load); clearInterval(t); };
  }, []);
  const board = useLiveQuery(async () => {
    const os = await db.orders.where('production_status').anyOf('antri', 'dirangkai', 'siap').toArray();
    const ps = await db.payments.where('order_id').anyOf(os.map((o) => o.id)).toArray();
    return { os, paid: sumPaid(ps) };
  }, []);
  // pesanan yang sudah diambil tetapi masih bersisa tagihan (data lama atau bayar nanti): tetap bisa dilunasi di sini
  const unpaidDone = useLiveQuery(async () => {
    if (!money) return [];
    const os = (await db.orders.where('production_status').equals('selesai').toArray()).filter((o) => !o.void && !o.deleted);
    if (!os.length) return [];
    const paid = sumPaid(await db.payments.where('order_id').anyOf(os.map((o) => o.id)).toArray());
    return os.map((o) => ({ o, due: Math.max(0, o.total - (paid.get(o.id) || 0)) })).filter((x) => x.due > 0)
      .sort((a, b) => (a.o.done_at || '').localeCompare(b.o.done_at || ''));
  }, [money]) || [];
  const jobs = useLiveQuery(() => db.print_jobs.where('status').anyOf('pending', 'printing', 'error').toArray(), []) || [];
  const sel = useLiveQuery(() => (open ? db.orders.get(open) : undefined), [open]);
  const payOrder = useLiveQuery(() => (payFor ? db.orders.get(payFor) : undefined), [payFor]);
  const assignOrder = useLiveQuery(() => (assignFor ? db.orders.get(assignFor) : undefined), [assignFor]);

  const orders = board?.os || [];
  const list = useMemo(() => {
    const today = dayKey(new Date());
    const tomorrow = dayKey(addDays(new Date(), 1));
    return orders
      .filter((o) => !o.void && !o.deleted)
      .filter((o) => !flor || (flor === '-' ? assigneeOf(o, florists) === null : (o.florist_id ? o.florist_id === flor : o.florist === flor || assigneeOf(o, florists) === flor)))
      .filter((o) => when === 'aktif' || dayKey(o.due_at || o.created_at!) === (when === 'hari' ? today : tomorrow))
      .sort((a, b) => (a.due_at || a.created_at || '').localeCompare(b.due_at || b.created_at || ''));
  }, [orders, when, flor, florists]);
  const station = cfg?.stationTargets || [];
  const myJobs = jobs.filter((j) => station.includes(j.target));
  const dueOf = (o: Order) => Math.max(0, o.total - (board?.paid.get(o.id) || 0));

  return (
    <div className="page">
      {isOwner && <CancelRequests onOpen={setOpen} />}
      <div className="toolbar">
        <Seg value={when} onChange={setWhen} options={[{ value: 'aktif', label: 'Semua aktif' }, { value: 'hari', label: 'Hari ini' }, { value: 'besok', label: 'Besok' }]} />
        <div className="chips small" data-testid="florist-filter">
          <button className={!flor ? 'on' : ''} onClick={() => setFlor('')}>Semua perangkai</button>
          {florists.map((f) => <button key={f.id || f.name} className={flor === (f.id || f.name) ? 'on' : ''} onClick={() => setFlor(f.id || f.name)}>{f.name}</button>)}
          <button className={flor === '-' ? 'on' : ''} onClick={() => setFlor('-')}>Belum ditunjuk</button>
        </div>
        {station.length > 0 && (
          <span className="station" data-testid="station">
            <Icon name="print" size={16} />Stasiun cetak aktif ({station.join(', ')}) · antre {myJobs.filter((j) => j.status !== 'error').length}
            {myJobs.filter((j) => j.status === 'error').map((j) => <button key={j.id} className="btn small danger" onClick={() => retryJob(j)} title={j.error}>Ulangi gagal</button>)}
          </span>
        )}
      </div>
      <div className="board">
        {COLS.map((c) => {
          const xs = list.filter((o) => o.production_status === c.st);
          return (
            <div key={c.st} className="bcol">
              <div className="bhead">{c.label} <span>{xs.reduce((s, o) => s + o.items.reduce((a, i) => a + i.qty, 0), 0)} item</span></div>
              {xs.map((o) => <Card key={o.id} o={o} col={c} me={me} florists={florists} due={board ? dueOf(o) : null} onOpen={() => setOpen(o.id)} onPay={() => setPayFor(o.id)} onAssign={() => setAssignFor(o.id)} />)}
              {!xs.length && <Empty>—</Empty>}
            </div>
          );
        })}
      </div>
      {unpaidDone.length > 0 && (
        <div className="stack" data-testid="unpaid-done">
          <h3 className="section-h">Sudah diambil, belum lunas</h3>
          <div className="table" style={{ ['--cols' as string]: '150px minmax(0,1fr) 140px 190px', ['--cols-sm' as string]: 'minmax(96px,auto) minmax(0,1fr) auto' }}>
            {unpaidDone.map(({ o, due }) => (
              <div key={o.id} className="trow">
                <div><b>{o.no}</b><div className="muted">{fmtShort(o.done_at || o.created_at)}</div></div>
                <div className="grow">{o.customer_name || 'Umum'}<div className="muted">{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</div></div>
                <div className="right hide-sm">Sisa <b className="red">{rp(due)}</b></div>
                <button className="btn primary small" onClick={() => setPayFor(o.id)}>Bayar pelunasan · {rp(due)}</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {sel && <OrderDetail order={sel} onClose={() => setOpen(null)} />}
      {payOrder && <PelunasanModal order={payOrder} onClose={() => setPayFor(null)} />}
      {assignOrder && <AssignFloristModal order={assignOrder} onClose={() => setAssignFor(null)} />}
    </div>
  );
}

function Card({ o, col, me, florists, due, onOpen, onPay, onAssign }: {
  o: Order; col: (typeof COLS)[number]; me: SessionUser | null; florists: Florist[]; due: number | null; onOpen: () => void; onPay: () => void; onAssign: () => void;
}) {
  const role = me?.role;
  const roles = rolesOf(me);
  const assignee = assigneeOf(o, florists);
  const unassigned = assignee === null && needsFlorist(o);
  const canAssign = roles.includes('owner') || roles.includes('kasir');
  const assignedName = assignee ? florists.find((f) => f.id === assignee)?.name || o.florist : o.florist;
  const hint = col.next === 'selesai' ? 'Dikonfirmasi Admin setelah pesanan diambil/diantar'
    : unassigned ? 'Tunjuk perangkai dulu' : `Hanya ${assignedName || 'perangkai yang ditunjuk'} yang bisa menekan tombol ini`;
  const mine = !!assignee && assignee === me?.id;
  const at = o.due_at ? new Date(o.due_at) : null;
  const late = at && at.getTime() < Date.now() && o.production_status !== 'siap';
  const soon = at && !late && at.getTime() - Date.now() < 2 * 3600e3;
  const h1 = !!at && o.fulfillment !== 'sekarang' && dayKey(at) === dayKey(addDays(new Date(), 1)) && (o.production_status === 'antri' || o.production_status === 'dirangkai');
  const money = role !== 'perangkai';
  // Siap + masih ada sisa tagihan (DP / bayar nanti): kasir menagih pelunasan dulu, baru "Sudah diambil"
  const needPay = money && col.st === 'siap' && due !== null && due > 0;
  const allowed = due !== null && canSetStatus(me, o, col.next, due, assignee);
  return (
    <div className={`bcard ${late ? 'late' : soon ? 'soon' : h1 ? 'h1' : ''} ${unassigned ? 'unassigned' : ''} ${mine ? 'mine' : ''}`} data-testid="prod-card">
      {unassigned && <div className="bc-flag red" data-testid="belum-ditunjuk">Perangkai belum ditunjuk</div>}
      {h1 && <div className="bc-flag">H-1: untuk besok, belum selesai</div>}
      {o.cancel_request?.status === 'pending' && <div className="bc-flag red">Pengajuan batal menunggu owner</div>}
      <div className="bc-top" onClick={onOpen}>
        <b className="bc-no">#{o.no.split('-').pop()}</b>
        <span className="bc-due">{o.fulfillment === 'sekarang' ? 'READY' : `${o.fulfillment === 'antar' ? 'Antar' : 'Ambil'} ${dayKey(o.due_at!) === dayKey(new Date()) ? 'Hari ini' : fmtDate(o.due_at)} ${fmtTime(o.due_at)}`}</span>
      </div>
      <div onClick={onOpen}>
        {o.items.map((it, i) => <div key={i} className="bc-item"><b>{it.qty}×</b> {it.name}{it.note && <div className="muted">› {it.note}</div>}</div>)}
        {o.notes && <div className="bc-note"><b>Catatan:</b> {o.notes}</div>}
        {o.card_message && <div className="bc-note"><b>Kartu:</b> “{o.card_message}”</div>}
        <div className="muted">{o.customer_name || 'Umum'}</div>
        {o.florist && <div className="bc-who">Perangkai: {assignedName}{mine ? ' (Anda)' : ''}</div>}
        {money && due !== null && due > 0 && <div className="bc-pay"><Badge tone={due < o.total ? 'amber' : 'red'}>{due < o.total ? 'DP' : 'Belum bayar'}</Badge> sisa {rp(due)}</div>}
      </div>
      {unassigned && canAssign && <button className="btn" onClick={onAssign} data-testid="btn-tunjuk">Tunjuk perangkai</button>}
      {needPay
        ? <button className="btn primary" onClick={onPay} data-testid="btn-bayar-pelunasan">Bayar pelunasan · {rp(due!)}</button>
        : <button className="btn primary" disabled={!allowed} title={allowed ? undefined : hint} onClick={() => setProductionStatus(o, col.next)} data-testid={`act-${col.st}`}>{col.action}</button>}
    </div>
  );
}
