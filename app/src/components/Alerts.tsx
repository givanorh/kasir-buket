// Peringatan lintas halaman: pesanan H-1 / hari ini yang belum selesai dirangkai, dan pengajuan pembatalan untuk owner.
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { addDays, dayKey, fmtDate, fmtTime, rp } from '../lib/format';
import { decideCancel } from '../lib/store';
import { Icon } from './icons';
import { toast } from './ui';
import type { Order } from '../lib/types';

const OPEN = ['antri', 'dirangkai'];

/** Pesanan berjadwal (ambil/antar) untuk hari ini & besok yang statusnya masih Antri/Dirangkai. */
export function useDueSoon() {
  const list = useLiveQuery(() => db.orders.where('production_status').anyOf(OPEN).toArray(), []) || [];
  const today = dayKey(new Date()), tomorrow = dayKey(addDays(new Date(), 1));
  const xs = list.filter((o) => !o.void && !o.deleted && o.fulfillment !== 'sekarang' && o.due_at);
  const sort = (a: Order, b: Order) => (a.due_at || '').localeCompare(b.due_at || '');
  return {
    today: xs.filter((o) => dayKey(o.due_at!) === today).sort(sort),
    tomorrow: xs.filter((o) => dayKey(o.due_at!) === tomorrow).sort(sort),
    tomorrowKey: tomorrow,
  };
}

const short = (o: Order) => `#${o.no.split('-').pop()} ${fmtTime(o.due_at)}${o.florist ? ` ${o.florist}` : ' (belum ditunjuk)'}`;

/** Banner H-1: tampil di bawah judul halaman untuk semua peran. Bisa disembunyikan sampai jumlahnya berubah. */
export function DueAlert() {
  const { today, tomorrow } = useDueSoon();
  const key = `${today.length}/${tomorrow.length}`;
  const [hidden, setHidden] = useState('');
  if ((!today.length && !tomorrow.length) || hidden === key) return null;
  return (
    <div className="alert" role="status" data-testid="due-alert">
      <Icon name="produksi" />
      <div className="grow">
        {tomorrow.length > 0 && <div><b>H-1: {tomorrow.length} pesanan untuk besok ({fmtDate(tomorrow[0].due_at).replace(/ \d{4}$/, '')}) belum selesai dirangkai.</b> <span className="muted">{tomorrow.slice(0, 4).map(short).join(' · ')}{tomorrow.length > 4 ? ` · +${tomorrow.length - 4}` : ''}</span></div>}
        {today.length > 0 && <div><b className="red">Hari ini: {today.length} pesanan belum selesai.</b> <span className="muted">{today.slice(0, 4).map(short).join(' · ')}</span></div>}
      </div>
      <a className="btn small" href="#/produksi?besok">Lihat</a>
      <button className="icon-btn" onClick={() => setHidden(key)} aria-label="Sembunyikan peringatan"><Icon name="close" size={18} /></button>
    </div>
  );
}

export function usePendingCancels() {
  return useLiveQuery(() => db.orders.filter((o) => o.cancel_request?.status === 'pending' && !o.void).toArray(), []) || [];
}

/** Daftar pengajuan pembatalan (owner) dengan tombol setujui/tolak. */
export function CancelRequests({ onOpen }: { onOpen?: (id: string) => void }) {
  const list = usePendingCancels();
  const [busy, setBusy] = useState('');
  if (!list.length) return null;
  async function decide(o: Order, ok: boolean) {
    const note = ok ? '' : window.prompt('Alasan menolak (opsional)') ?? null;
    if (note === null) return;
    setBusy(o.id);
    try { await decideCancel(o, ok, note); toast(ok ? `Pesanan ${o.no} dibatalkan` : `Pengajuan ${o.no} ditolak`); } finally { setBusy(''); }
  }
  return (
    <section className="card approvals" data-testid="cancel-requests">
      <h3>Menunggu persetujuan pembatalan ({list.length})</h3>
      {list.map((o) => (
        <div key={o.id} className="appr">
          <button className="linkish grow" onClick={() => onOpen?.(o.id)}>
            <b>{o.no}</b> · {o.customer_name || 'Umum'} · {rp(o.total)} lunas
            <div className="muted">{o.cancel_request!.by_name}: “{o.cancel_request!.reason}”</div>
          </button>
          <button className="btn small" disabled={!!busy} onClick={() => decide(o, false)}>Tolak</button>
          <button className="btn small danger" disabled={!!busy} onClick={() => decide(o, true)} data-testid="setujui-batal">Setujui &amp; batalkan</button>
        </div>
      ))}
    </section>
  );
}
