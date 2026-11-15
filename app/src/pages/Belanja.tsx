import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { addDays, dayKey, num, rp } from '../lib/format';
import { getDeviceConfig, newId, save, saveMany } from '../lib/store';
import { readSheetFile, toCsv } from '../lib/sheet';
import { PURCHASE_CATEGORIES, TEMPLATE_ROWS, mapPurchaseRows, sumTotal, type PurchaseParse } from '../lib/purchases';
import { Badge, Empty, Field, Modal, MoneyInput, Seg, toast } from '../components/ui';
import { Icon } from '../components/icons';
import type { HppMethod, Purchase, Settings } from '../lib/types';

type Period = 'bulan' | 'lalu' | '3bulan' | 'tahun' | 'semua';
const HPP_LABEL: Record<HppMethod, string> = { produk: 'Modal produk', belanja: 'Belanja bahan', gabungan: 'Modal produk + belanja bahan' };

function range(p: Period): [string, string] {
  const now = new Date();
  const first = (y: number, m: number) => dayKey(new Date(y, m, 1));
  const last = (y: number, m: number) => dayKey(new Date(y, m + 1, 0));
  if (p === 'bulan') return [first(now.getFullYear(), now.getMonth()), dayKey(now)];
  if (p === 'lalu') return [first(now.getFullYear(), now.getMonth() - 1), last(now.getFullYear(), now.getMonth() - 1)];
  if (p === '3bulan') return [dayKey(addDays(now, -90)), dayKey(now)];
  if (p === 'tahun') return [`${now.getFullYear()}-01-01`, dayKey(now)];
  return ['0000-01-01', '9999-12-31'];
}

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Belanja bahan baku (owner): dicatat manual atau diunggah dari CSV/Excel; menjadi HPP di Laporan sesuai dasar HPP yang dipilih. */
export default function Belanja() {
  const all = useLiveQuery(() => db.purchases.toArray(), []) || [];
  const settings = useLiveQuery(() => db.settings.get('toko'));
  const [period, setPeriod] = useState<Period>('bulan');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<Purchase> | null>(null);
  const [upload, setUpload] = useState(false);
  const [a, b] = range(period);
  const list = useMemo(() => all
    .filter((x) => !x.deleted && x.date >= a && x.date <= b)
    .filter((x) => !q || `${x.item} ${x.category} ${x.supplier}`.toLowerCase().includes(q.toLowerCase()))
    .sort((x, y) => y.date.localeCompare(x.date) || x.item.localeCompare(y.item)), [all, a, b, q]);
  const total = sumTotal(list);
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of list) m.set(x.category || 'Lainnya', (m.get(x.category || 'Lainnya') || 0) + x.total);
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  }, [list]);
  const maxCat = Math.max(1, ...byCat.map(([, v]) => v));
  const method: HppMethod = settings?.hpp_method || 'gabungan';

  return (
    <div className="page" data-testid="belanja">
      <div className="toolbar">
        <Seg value={period} onChange={setPeriod} options={[{ value: 'bulan', label: 'Bulan ini' }, { value: 'lalu', label: 'Bulan lalu' }, { value: '3bulan', label: '90 hari' }, { value: 'tahun', label: 'Tahun ini' }, { value: 'semua', label: 'Semua' }]} />
        <input className="grow" placeholder="Cari bahan, kategori, pemasok" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="toolbar">
        <button className="btn primary" onClick={() => setEdit({ date: dayKey(new Date()), qty: 1, price: 0, category: PURCHASE_CATEGORIES[0] })} data-testid="belanja-baru"><Icon name="plus" size={18} />Belanja</button>
        <button className="btn" onClick={() => setUpload(true)} data-testid="unggah"><Icon name="upload" size={18} />Unggah CSV/Excel</button>
        <button className="btn ghost" onClick={() => download('template-belanja-bahan.csv', toCsv(TEMPLATE_ROWS))}><Icon name="download" size={18} />Template</button>
        <span className="grow" />
        <button className="btn ghost" disabled={!list.length} onClick={() => download(`belanja-${a}_${b}.csv`, toCsv([TEMPLATE_ROWS[0], ...list.map((x) => [x.date, x.item, x.category || '', x.qty, x.unit || '', x.price, x.total, x.supplier || '', x.note || ''])]))}>Ekspor CSV</button>
      </div>

      <div className="kpis">
        <div className="kpi"><span>Total belanja</span><b data-testid="total-belanja">{rp(total)}</b><i>{num(list.length)} baris</i></div>
        <div className="kpi"><span>Kategori terbesar</span><b>{byCat[0]?.[0] || '-'}</b><i>{byCat[0] ? `${rp(byCat[0][1])} · ${total ? Math.round((byCat[0][1] / total) * 100) : 0}%` : ''}</i></div>
        <div className="kpi"><span>Rata-rata per hari</span><b>{rp(period === 'semua' || !list.length ? 0 : total / Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400e3) + 1))}</b><i>{a === '0000-01-01' ? 'semua periode' : `${a} s.d. ${b}`}</i></div>
        <div className="kpi"><span>Dasar HPP di Laporan</span><b style={{ fontSize: 16 }}>{HPP_LABEL[method]}</b><i>{method === 'produk' ? 'belanja belum dihitung sebagai HPP' : 'belanja periode dihitung sebagai HPP'}</i></div>
      </div>

      <div className="split">
        <section className="card">
          <h3>Daftar belanja</h3>
          <div className="table flat" style={{ ['--cols' as string]: '96px minmax(0,1fr) 150px 120px 130px 40px', ['--cols-sm' as string]: 'minmax(0,1fr) auto 36px' }}>
            <div className="thead"><div className="hide-sm">Tanggal</div><div>Bahan</div><div className="hide-sm">Kategori</div><div className="right hide-sm">Qty × harga</div><div className="right">Total</div><div /></div>
            {list.map((x) => (
              <div key={x.id} className="trow" data-testid="belanja-row">
                <div className="hide-sm muted">{x.date.split('-').reverse().join('/')}</div>
                <div className="clip"><b>{x.item}</b><div className="muted clip">{x.supplier || '—'}{x.note ? ` · ${x.note}` : ''}{x.source === 'impor' ? ' · impor' : ''}</div></div>
                <div className="hide-sm"><Badge>{x.category || 'Lainnya'}</Badge></div>
                <div className="right hide-sm muted">{num(x.qty)}{x.unit ? ` ${x.unit}` : ''} × {num(x.price)}</div>
                <div className="right"><b>{rp(x.total)}</b></div>
                <button className="icon-btn" onClick={() => setEdit(x)} aria-label={`Ubah ${x.item}`}><Icon name="pengaturan" size={18} /></button>
              </div>
            ))}
            {!list.length && <Empty>Belum ada belanja pada periode ini. Tambah manual atau unggah dari spreadsheet.</Empty>}
          </div>
        </section>
        <section className="card">
          <h3>Per kategori</h3>
          {byCat.map(([k, v]) => (
            <div key={k} className="hbar"><span className="clip">{k}</span><div className="track"><i style={{ width: `${(v / maxCat) * 100}%` }} /></div><span className="right">{total ? Math.round((v / total) * 100) : 0}%</span></div>
          ))}
          {!byCat.length && <div className="muted">-</div>}
          <h3>Dasar HPP laba rugi</h3>
          <Seg value={method} onChange={(v) => save<Settings>('settings', 'toko', { hpp_method: v })} options={[{ value: 'gabungan', label: 'Gabungan' }, { value: 'belanja', label: 'Belanja' }, { value: 'produk', label: 'Modal produk' }]} />
          <p className="muted small">Gabungan = Σ modal produk terjual + Σ belanja bahan periode. Pilih <b>Belanja</b> bila HPP produk belum diisi (modal Rp 0) agar biaya bahan tidak hilang; pilih <b>Modal produk</b> bila HPP produk sudah dihitung dari bahan yang sama, supaya tidak terhitung dua kali.</p>
        </section>
      </div>
      {edit && <PurchaseForm p={edit} onClose={() => setEdit(null)} suggestions={[...new Set(all.map((x) => x.item))].slice(0, 200)} suppliers={[...new Set(all.map((x) => x.supplier).filter(Boolean) as string[])]} />}
      {upload && <UploadModal existing={new Set(all.map((x) => x.id))} onClose={() => setUpload(false)} />}
    </div>
  );
}

function PurchaseForm({ p, onClose, suggestions, suppliers }: { p: Partial<Purchase>; onClose: () => void; suggestions: string[]; suppliers: string[] }) {
  const [f, setF] = useState<Partial<Purchase>>(p);
  const [totalManual, setTotalManual] = useState(!!p.id && p.total !== Math.round((p.qty || 0) * (p.price || 0)));
  const total = totalManual ? f.total || 0 : Math.round((f.qty || 0) * (f.price || 0));
  async function submit() {
    const id = f.id || newId('bl');
    const cfg = await getDeviceConfig();
    const { id: _, created_at, updated_at, ...rest } = f as Purchase;
    await save<Purchase>('purchases', id, { ...rest, item: (f.item || '').trim(), total, outlet_id: f.outlet_id || cfg.outletId, source: f.source || 'manual' });
    toast('Belanja disimpan');
    onClose();
  }
  return (
    <Modal title={p.id ? 'Ubah belanja' : 'Belanja bahan'} onClose={onClose}
      footer={<>
        {p.id && <button className="btn danger" onClick={async () => { if (confirm('Hapus baris belanja ini?')) { await save<Purchase>('purchases', p.id!, { deleted: true }); onClose(); } }}>Hapus</button>}
        <button className="btn primary grow" disabled={!f.item?.trim() || !f.date || !(f.qty! > 0)} onClick={submit} data-testid="simpan-belanja">Simpan · {rp(total)}</button>
      </>}>
      <div className="stack">
        <div className="cols">
          <Field label="Tanggal"><input type="date" value={f.date || ''} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Kategori"><input list="kategori-bahan" value={f.category || ''} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        </div>
        <Field label="Bahan"><input list="nama-bahan" value={f.item || ''} onChange={(e) => setF({ ...f, item: e.target.value })} placeholder="Mawar merah" data-testid="bahan" /></Field>
        <div className="cols">
          <Field label="Jumlah"><input inputMode="decimal" value={f.qty ?? ''} onChange={(e) => setF({ ...f, qty: Number(e.target.value.replace(',', '.')) || 0 })} aria-label="Jumlah" /></Field>
          <Field label="Satuan"><input value={f.unit || ''} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="tangkai, pak, meter" /></Field>
        </div>
        <div className="cols">
          <Field label="Harga satuan"><MoneyInput value={f.price || 0} onChange={(price) => setF({ ...f, price })} ariaLabel="Harga satuan" /></Field>
          <Field label="Total" hint={totalManual ? <button className="linkish small" onClick={() => setTotalManual(false)}>Hitung otomatis</button> : `${num(f.qty || 0)} × ${num(f.price || 0)}`}>
            <MoneyInput value={total} onChange={(t) => { setTotalManual(true); setF({ ...f, total: t }); }} ariaLabel="Total belanja" />
          </Field>
        </div>
        <Field label="Pemasok"><input list="pemasok" value={f.supplier || ''} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></Field>
        <Field label="Catatan"><input value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <datalist id="kategori-bahan">{PURCHASE_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        <datalist id="nama-bahan">{suggestions.map((c) => <option key={c} value={c} />)}</datalist>
        <datalist id="pemasok">{suppliers.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
    </Modal>
  );
}

function UploadModal({ existing, onClose }: { existing: Set<string>; onClose: () => void }) {
  const [res, setRes] = useState<PurchaseParse | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  async function pick(file?: File) {
    if (!file) return;
    setName(file.name);
    try {
      const cfg = await getDeviceConfig();
      setRes(mapPurchaseRows(await readSheetFile(file), dayKey(new Date()), cfg.outletId));
    } catch (e) { setRes(null); toast((e as Error).message, 'err'); }
  }
  const rows = res?.rows || [];
  const dup = rows.filter((r) => existing.has(r.id)).length;
  async function run() {
    setBusy(true);
    try {
      await saveMany(rows.map(({ line, id, ...p }) => ({ c: 'purchases' as const, id, patch: p })));
      toast(`${rows.length} baris belanja diimpor`);
      onClose();
    } finally { setBusy(false); }
  }
  return (
    <Modal title="Unggah daftar belanja" onClose={onClose} wide
      footer={<button className="btn primary grow" disabled={!rows.length || busy} onClick={run} data-testid="impor-belanja">{rows.length ? `Impor ${rows.length} baris · ${rp(sumTotal(rows))}` : 'Pilih berkas dulu'}</button>}>
      <div className="stack">
        <p className="muted">Format: <b>.xlsx</b> (Excel/Google Sheets › Unduh › Microsoft Excel) atau <b>.csv</b>. Baris pertama berisi judul kolom: Tanggal, Bahan, Kategori, Jumlah, Satuan, Harga satuan, Total, Pemasok, Catatan. Wajib: Bahan dan Harga satuan atau Total. Unggah ulang berkas yang sama tidak menggandakan data.</p>
        <input type="file" accept=".csv,.txt,.xlsx" onChange={(e) => pick(e.target.files?.[0])} data-testid="berkas-belanja" />
        {res && (
          <>
            <dl className="dl">
              <dt>Berkas</dt><dd>{name}</dd>
              <dt>Kolom terbaca</dt><dd>{Object.keys(res.header).join(', ') || '-'}</dd>
              <dt>Baris siap impor</dt><dd data-testid="baris-siap">{rows.length}{dup ? ` (${dup} sudah ada, akan diperbarui)` : ''}</dd>
              <dt>Total</dt><dd>{rp(sumTotal(rows))}</dd>
            </dl>
            {res.errors.length > 0 && <div className="note warn small">{res.errors.length} baris dilewati: {res.errors.slice(0, 5).map((x) => `baris ${x.line}: ${x.msg}`).join('; ')}{res.errors.length > 5 ? '; …' : ''}</div>}
            <div className="table flat" style={{ ['--cols' as string]: '96px minmax(0,1fr) 130px 110px 120px' }}>
              <div className="thead"><div>Tanggal</div><div>Bahan</div><div>Kategori</div><div className="right">Qty × harga</div><div className="right">Total</div></div>
              {rows.slice(0, 8).map((r) => (
                <div key={r.id} className="trow"><div className="muted">{r.date}</div><div className="clip">{r.item}</div><div className="clip">{r.category}</div><div className="right muted">{num(r.qty)} × {num(r.price)}</div><div className="right">{rp(r.total)}</div></div>
              ))}
              {rows.length > 8 && <div className="trow muted"><div /><div>… {rows.length - 8} baris lagi</div></div>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
