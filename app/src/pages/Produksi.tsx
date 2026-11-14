import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { addDays, dayKey, fmtDate, fmtTime } from '../lib/format';
import { getDeviceConfig, setProductionStatus, type DeviceConfig } from '../lib/store';
import { retryJob } from '../lib/print';
import { Empty, Seg } from '../components/ui';
import { OrderDetail } from './Pesanan';
import type { Order, ProductionStatus } from '../lib/types';

const COLS: { st: ProductionStatus; label: string; next?: ProductionStatus; action?: string }[] = [
  { st: 'antri', label: 'Antri', next: 'dirangkai', action: 'Mulai rangkai' },
  { st: 'dirangkai', label: 'Dirangkai', next: 'siap', action: 'Selesai dirangkai' },
  { st: 'siap', label: 'Siap diambil/antar', next: 'selesai', action: 'Sudah diambil' },
];

/** Papan ruang perangkai: urut jadwal, terlambat ditandai merah, ketuk untuk memajukan status. */
export default function Produksi() {
  const [when, setWhen] = useState<'aktif' | 'hari' | 'besok'>('aktif');
  const [open, setOpen] = useState<string | null>(null);
  const [cfg, setCfg] = useState<DeviceConfig | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const load = () => getDeviceConfig().then(setCfg);
    load();
    window.addEventListener('device-config', load);
    const t = setInterval(() => tick((x) => x + 1), 60000);
    return () => { window.removeEventListener('device-config', load); clearInterval(t); };
  }, []);
  const orders = useLiveQuery(() => db.orders.where('production_status').anyOf('antri', 'dirangkai', 'siap').toArray(), []) || [];
  const jobs = useLiveQuery(() => db.print_jobs.where('status').anyOf('pending', 'printing', 'error').toArray(), []) || [];

  const list = useMemo(() => {
    const today = dayKey(new Date());
    const tomorrow = dayKey(addDays(new Date(), 1));
    return orders
      .filter((o) => !o.void && !o.deleted)
      .filter((o) => when === 'aktif' || dayKey(o.due_at || o.created_at!) === (when === 'hari' ? today : tomorrow))
      .sort((a, b) => (a.due_at || a.created_at || '').localeCompare(b.due_at || b.created_at || ''));
  }, [orders, when]);
  const station = cfg?.stationTargets || [];
  const myJobs = jobs.filter((j) => station.includes(j.target));
  const sel = orders.find((o) => o.id === open);

  return (
    <div className="page">
      <div className="toolbar">
        <Seg value={when} onChange={setWhen} options={[{ value: 'aktif', label: 'Semua aktif' }, { value: 'hari', label: 'Hari ini' }, { value: 'besok', label: 'Besok' }]} />
        {station.length > 0 && (
          <span className="station" data-testid="station">
            🖨️ Stasiun cetak aktif ({station.join(', ')}) · antre {myJobs.filter((j) => j.status !== 'error').length}
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
              {xs.map((o) => <Card key={o.id} o={o} next={c.next} action={c.action} onOpen={() => setOpen(o.id)} />)}
              {!xs.length && <Empty>—</Empty>}
            </div>
          );
        })}
      </div>
      {sel && <OrderDetail order={sel} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Card({ o, next, action, onOpen }: { o: Order; next?: ProductionStatus; action?: string; onOpen: () => void }) {
  const due = o.due_at ? new Date(o.due_at) : null;
  const late = due && due.getTime() < Date.now() && o.production_status !== 'siap';
  const soon = due && !late && due.getTime() - Date.now() < 2 * 3600e3;
  return (
    <div className={`bcard ${late ? 'late' : soon ? 'soon' : ''}`} data-testid="prod-card">
      <div className="bc-top" onClick={onOpen}>
        <b className="bc-no">#{o.no.split('-').pop()}</b>
        <span className="bc-due">{o.fulfillment === 'sekarang' ? 'DITUNGGU' : `${o.fulfillment === 'antar' ? '🚚' : '🛍️'} ${dayKey(o.due_at!) === dayKey(new Date()) ? 'Hari ini' : fmtDate(o.due_at)} ${fmtTime(o.due_at)}`}</span>
      </div>
      <div onClick={onOpen}>
        {o.items.map((it, i) => <div key={i} className="bc-item"><b>{it.qty}×</b> {it.name}{it.note && <div className="muted">› {it.note}</div>}</div>)}
        {o.notes && <div className="bc-note">📝 {o.notes}</div>}
        {o.card_message && <div className="bc-note">💌 “{o.card_message}”</div>}
        <div className="muted">{o.customer_name || 'Umum'}</div>
      </div>
      {next && <button className="btn primary" onClick={() => setProductionStatus(o, next)}>{action}</button>}
    </div>
  );
}
