import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { addDays, dayKey, fmtDate, fmtTime } from '../lib/format';
import { getDeviceConfig, setProductionStatus, type DeviceConfig } from '../lib/store';
import { retryJob } from '../lib/print';
import { Empty, Seg } from '../components/ui';
import { storeCfg } from '../lib/settings';
import { Icon } from '../components/icons';
import { OrderDetail } from './Pesanan';
import { CancelRequests } from '../components/Alerts';
import { useSession } from '../lib/session';
import type { Order, ProductionStatus } from '../lib/types';

const COLS: { st: ProductionStatus; label: string; next?: ProductionStatus; action?: string }[] = [
  { st: 'antri', label: 'Antri', next: 'dirangkai', action: 'Mulai rangkai' },
  { st: 'dirangkai', label: 'Dirangkai', next: 'siap', action: 'Selesai dirangkai' },
  { st: 'siap', label: 'Siap diambil/antar', next: 'selesai', action: 'Sudah diambil' },
];

/** Papan ruang perangkai: urut jadwal, terlambat ditandai merah, ketuk untuk memajukan status. */
export default function Produksi() {
  const [when, setWhen] = useState<'aktif' | 'hari' | 'besok'>(() => (location.hash.includes('?besok') ? 'besok' : 'aktif'));
  const isOwner = useSession().user?.role === 'owner';
  const [open, setOpen] = useState<string | null>(null);
  const [flor, setFlor] = useState('');
  const settings = useLiveQuery(() => db.settings.get('toko'));
  const florists = storeCfg(settings).florists;
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
      .filter((o) => !flor || (flor === '-' ? !o.florist : o.florist === flor))
      .filter((o) => when === 'aktif' || dayKey(o.due_at || o.created_at!) === (when === 'hari' ? today : tomorrow))
      .sort((a, b) => (a.due_at || a.created_at || '').localeCompare(b.due_at || b.created_at || ''));
  }, [orders, when, flor]);
  const station = cfg?.stationTargets || [];
  const myJobs = jobs.filter((j) => station.includes(j.target));
  const sel = orders.find((o) => o.id === open);

  return (
    <div className="page">
      {isOwner && <CancelRequests onOpen={setOpen} />}
      <div className="toolbar">
        <Seg value={when} onChange={setWhen} options={[{ value: 'aktif', label: 'Semua aktif' }, { value: 'hari', label: 'Hari ini' }, { value: 'besok', label: 'Besok' }]} />
        <div className="chips small" data-testid="florist-filter">
          <button className={!flor ? 'on' : ''} onClick={() => setFlor('')}>Semua perangkai</button>
          {florists.map((n) => <button key={n} className={flor === n ? 'on' : ''} onClick={() => setFlor(n)}>{n}</button>)}
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
  const h1 = !!due && o.fulfillment !== 'sekarang' && dayKey(due) === dayKey(addDays(new Date(), 1)) && (o.production_status === 'antri' || o.production_status === 'dirangkai');
  return (
    <div className={`bcard ${late ? 'late' : soon ? 'soon' : h1 ? 'h1' : ''}`} data-testid="prod-card">
      {h1 && <div className="bc-flag">H-1: untuk besok, belum selesai</div>}
      {o.cancel_request?.status === 'pending' && <div className="bc-flag red">Pengajuan batal menunggu owner</div>}
      <div className="bc-top" onClick={onOpen}>
        <b className="bc-no">#{o.no.split('-').pop()}</b>
        <span className="bc-due">{o.fulfillment === 'sekarang' ? 'DITUNGGU' : `${o.fulfillment === 'antar' ? 'Antar' : 'Ambil'} ${dayKey(o.due_at!) === dayKey(new Date()) ? 'Hari ini' : fmtDate(o.due_at)} ${fmtTime(o.due_at)}`}</span>
      </div>
      <div onClick={onOpen}>
        {o.items.map((it, i) => <div key={i} className="bc-item"><b>{it.qty}×</b> {it.name}{it.note && <div className="muted">› {it.note}</div>}</div>)}
        {o.notes && <div className="bc-note"><b>Catatan:</b> {o.notes}</div>}
        {o.card_message && <div className="bc-note"><b>Kartu:</b> “{o.card_message}”</div>}
        <div className="muted">{o.customer_name || 'Umum'}</div>
        {o.florist && <div className="bc-who">Perangkai: {o.florist}</div>}
      </div>
      {next && <button className="btn primary" onClick={() => setProductionStatus(o, next)}>{action}</button>}
    </div>
  );
}
