import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { customerStats } from '../lib/calc';
import { fmtDate, fmtShort, num, rp } from '../lib/format';
import { newId, save } from '../lib/store';
import { storeCfg } from '../lib/settings';
import { printOrder } from '../lib/print';
import { Badge, Empty, Field, Modal, toast } from '../components/ui';
import { Icon } from '../components/icons';
import type { Customer } from '../lib/types';

const initials = (n: string) => n.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const tierBadge = (t: string) => <Badge tone={t === 'Gold' ? 'amber' : t === 'Silver' ? 'blue' : 'gray'}>{t}</Badge>;

/** Profil pelanggan & program loyalitas: poin, tingkat (tier), kebiasaan belanja. */
export default function Pelanggan() {
  const customers = useLiveQuery(() => db.customers.toArray(), []) || [];
  const orders = useLiveQuery(() => db.orders.toArray(), []) || [];
  const payments = useLiveQuery(() => db.payments.toArray(), []) || [];
  const settings = useLiveQuery(() => db.settings.get('toko'));
  const L = storeCfg(settings).loyalty;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<Customer | null>(null);
  const [sort, setSort] = useState<'belanja' | 'poin' | 'terbaru'>('belanja');

  const paid = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments) if (!p.void) m.set(p.order_id, (m.get(p.order_id) || 0) + p.amount);
    return m;
  }, [payments]);
  const stats = useMemo(() => new Map(customers.map((c) => [c.id, customerStats(c.id, orders, paid, L)])), [customers, orders, paid, L]);

  const list = customers
    .filter((c) => !c.deleted && (!q || c.name.toLowerCase().includes(q.toLowerCase()) || (c.phone || '').includes(q)))
    .sort((a, b) => {
      const x = stats.get(a.id)!, y = stats.get(b.id)!;
      if (sort === 'poin') return y.balance - x.balance;
      if (sort === 'terbaru') return (y.last || '').localeCompare(x.last || '');
      return y.spend - x.spend;
    });
  const cur = customers.find((c) => c.id === sel) || null;
  const st = cur ? stats.get(cur.id)! : null;
  const history = cur ? orders.filter((o) => o.customer_id === cur.id).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 25) : [];

  return (
    <div className="page">
      <div className="toolbar">
        <input className="grow" placeholder="Cari nama atau nomor HP" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ maxWidth: 200 }}>
          <option value="belanja">Urut: total belanja</option>
          <option value="poin">Urut: poin terbanyak</option>
          <option value="terbaru">Urut: belanja terakhir</option>
        </select>
        <button className="btn primary" onClick={() => setEdit({ id: '', name: '', phone: '' })}><Icon name="plus" size={18} />Pelanggan</button>
      </div>
      <div className="crm">
        <div className="table">
          {list.map((c) => {
            const s = stats.get(c.id)!;
            return (
              <div key={c.id} role="button" tabIndex={0} className={`trow click ${sel === c.id ? 'sel' : ''}`} onClick={() => setSel(c.id)} onKeyDown={(e) => e.key === 'Enter' && setSel(c.id)}>
                <span className="avatar">{initials(c.name)}</span>
                <div className="grow"><b>{c.name}</b><div className="muted">{c.phone || 'tanpa nomor'} · {s.count} transaksi</div></div>
                <div className="right"><b>{rp(s.spend)}</b><div className="muted">{num(s.balance)} poin</div></div>
              </div>
            );
          })}
          {!list.length && <Empty>Belum ada pelanggan. Pelanggan tersimpan otomatis saat nama atau nomor HP diisi di kasir.</Empty>}
        </div>

        {cur && st ? (
          <section className="card" data-testid="profile">
            <div className="profile-head">
              <span className="avatar">{initials(cur.name)}</span>
              <div className="grow">
                <h2 style={{ fontSize: 20 }}>{cur.name} {tierBadge(st.tier)}</h2>
                <div className="muted">{cur.phone || 'tanpa nomor'}{cur.instagram ? ` · IG ${cur.instagram}` : ''}{cur.birthday ? ` · ulang tahun ${fmtDate(cur.birthday).replace(/^\w+, /, '')}` : ''}</div>
              </div>
              <button className="btn small" onClick={() => setEdit(cur)}>Ubah</button>
            </div>
            <div className="stats">
              <div className="stat"><span>Saldo poin</span><b data-testid="poin">{num(st.balance)}</b><div className="muted small">nilai {rp(st.balance * L.point_value)}</div></div>
              <div className="stat"><span>Total belanja</span><b>{rp(st.spend)}</b><div className="muted small">{st.count} transaksi · rata-rata {rp(st.avg)}</div></div>
              <div className="stat"><span>Belanja 12 bulan</span><b>{rp(st.spend12m)}</b><div className="muted small">{st.tier === 'Gold' ? 'tingkat tertinggi' : `kurang ${rp((st.tier === 'Silver' ? L.tier_gold : L.tier_silver) - st.spend12m)} ke ${st.tier === 'Silver' ? 'Gold' : 'Silver'}`}</div></div>
              <div className="stat"><span>Kunjungan</span><b>{st.last ? fmtShort(st.last).split(' ')[0] : '-'}</b><div className="muted small">pertama {st.first ? fmtShort(st.first).split(' ')[0] : '-'}</div></div>
            </div>
            {st.due > 0 && <div className="note warn">Sisa tagihan {rp(st.due)}</div>}
            <div className="two">
              <div>
                <h3>Produk favorit</h3>
                {st.favorites.map((f) => <div key={f.name} className="row"><span>{f.name}</span><b>{f.qty}×</b></div>)}
                {!st.favorites.length && <div className="muted">Belum ada</div>}
              </div>
              <div>
                <h3>Acara</h3>
                {st.occasions.map((o) => <div key={o.label} className="row"><span>{o.label}</span><b>{o.n}×</b></div>)}
                {!st.occasions.length && <div className="muted">Dari survei di kasir</div>}
              </div>
            </div>
            <h3>Riwayat</h3>
            <div>
              {history.map((o) => (
                <div key={o.id} className={`row ${o.void ? 'strike' : ''}`}>
                  <span className="grow"><b>{o.no}</b> <span className="muted">{fmtShort(o.created_at)}</span><div className="muted small">{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</div></span>
                  <span className="right">{rp(o.total)}<div className="muted small">{o.points_earned ? `+${o.points_earned}` : ''}{o.points_redeemed ? ` −${o.points_redeemed}` : ''} poin</div></span>
                  <button className="icon-btn" aria-label="Cetak ulang struk" onClick={async () => { const r = await printOrder(o, ['kasir'], { copyLabel: 'CETAK ULANG' }); toast(r[0].ok ? 'Dikirim ke printer' : `Gagal: ${r[0].error}`, r[0].ok ? 'ok' : 'err'); }}><Icon name="print" /></button>
                </div>
              ))}
            </div>
            {cur.note && <><h3>Catatan</h3><p className="muted">{cur.note}</p></>}
          </section>
        ) : (
          <section className="card hide-sm"><div className="empty">Pilih pelanggan untuk melihat profil, poin, dan kebiasaan belanjanya.</div></section>
        )}
      </div>
      {edit && <CustomerForm c={edit} onClose={() => setEdit(null)} onSaved={(id) => setSel(id)} />}
    </div>
  );
}

function CustomerForm({ c, onClose, onSaved }: { c: Customer; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState(c);
  return (
    <Modal title={c.id ? 'Ubah pelanggan' : 'Pelanggan baru'} onClose={onClose}
      footer={<button className="btn primary grow" disabled={!f.name} onClick={async () => {
        const { id, created_at, updated_at, ...patch } = f;
        const nid = c.id || newId('c');
        await save<Customer>('customers', nid, { ...patch, phone: (f.phone || '').replace(/[^\d+]/g, '') });
        onSaved(nid);
        onClose();
      }}>Simpan</button>}>
      <div className="stack">
        <Field label="Nama"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="cols">
          <Field label="Nomor HP/WA"><input inputMode="tel" value={f.phone || ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Instagram"><input value={f.instagram || ''} onChange={(e) => setF({ ...f, instagram: e.target.value })} placeholder="@nama" /></Field>
        </div>
        <Field label="Tanggal lahir" hint="Untuk ucapan dan promo ulang tahun"><input type="date" value={f.birthday || ''} onChange={(e) => setF({ ...f, birthday: e.target.value })} /></Field>
        <Field label="Alamat"><textarea rows={2} value={f.address || ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Catatan" hint="Mis. tanggal penting, warna favorit"><textarea rows={2} value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
