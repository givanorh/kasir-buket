import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { fmtShort, rp } from '../lib/format';
import { newId, save } from '../lib/store';
import { Empty, Field, Modal } from '../components/ui';
import type { Customer } from '../lib/types';

export default function Pelanggan() {
  const customers = useLiveQuery(() => db.customers.toArray(), []) || [];
  const orders = useLiveQuery(() => db.orders.toArray(), []) || [];
  const payments = useLiveQuery(() => db.payments.toArray(), []) || [];
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Customer | null>(null);

  const stats = useMemo(() => {
    const paid = new Map<string, number>();
    for (const p of payments) if (!p.void) paid.set(p.order_id, (paid.get(p.order_id) || 0) + p.amount);
    const m = new Map<string, { n: number; total: number; last: string; due: number }>();
    for (const o of orders) {
      if (o.void || !o.customer_id) continue;
      const s = m.get(o.customer_id) || { n: 0, total: 0, last: '', due: 0 };
      s.n++; s.total += o.total; s.due += Math.max(0, o.total - (paid.get(o.id) || 0));
      if ((o.created_at || '') > s.last) s.last = o.created_at || '';
      m.set(o.customer_id, s);
    }
    return m;
  }, [orders, payments]);

  const list = customers
    .filter((c) => !c.deleted && (!q || c.name.toLowerCase().includes(q.toLowerCase()) || (c.phone || '').includes(q)))
    .sort((a, b) => (stats.get(b.id)?.total || 0) - (stats.get(a.id)?.total || 0));

  return (
    <div className="page">
      <div className="toolbar">
        <input className="grow" placeholder="Cari nama / HP" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" onClick={() => setEdit({ id: '', name: '', phone: '' })}>＋ Pelanggan</button>
      </div>
      <div className="table">
        <div className="thead"><div className="grow">Nama</div><div className="right">Transaksi</div><div className="right">Total belanja</div><div className="right hide-sm">Sisa tagihan</div><div className="hide-sm">Terakhir</div></div>
        {list.map((c) => {
          const s = stats.get(c.id);
          return (
            <button key={c.id} className="trow" onClick={() => setEdit(c)}>
              <div className="grow"><b>{c.name}</b><div className="muted">{c.phone}</div></div>
              <div className="right">{s?.n || 0}</div>
              <div className="right">{rp(s?.total || 0)}</div>
              <div className={`right hide-sm ${s?.due ? 'red' : ''}`}>{rp(s?.due || 0)}</div>
              <div className="hide-sm muted">{s?.last ? fmtShort(s.last) : '-'}</div>
            </button>
          );
        })}
        {!list.length && <Empty>Belum ada pelanggan. Pelanggan tersimpan otomatis saat nama/HP diisi di kasir.</Empty>}
      </div>
      {edit && <CustomerForm c={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CustomerForm({ c, onClose }: { c: Customer; onClose: () => void }) {
  const [f, setF] = useState(c);
  return (
    <Modal title={c.id ? 'Ubah pelanggan' : 'Pelanggan baru'} onClose={onClose}
      footer={<button className="btn primary grow" disabled={!f.name} onClick={async () => {
        const { id, created_at, updated_at, ...patch } = f;
        await save<Customer>('customers', c.id || newId('c'), { ...patch, phone: (f.phone || '').replace(/[^\d+]/g, '') });
        onClose();
      }}>Simpan</button>}>
      <div className="stack">
        <Field label="Nama"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="No. HP/WA"><input inputMode="tel" value={f.phone || ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Alamat"><textarea rows={2} value={f.address || ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Catatan (mis. tanggal penting, preferensi warna)"><textarea rows={2} value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
