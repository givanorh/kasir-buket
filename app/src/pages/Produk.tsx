import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { num, rp } from '../lib/format';
import { getDeviceConfig, newId, save, saveMany, stockLevels } from '../lib/store';
import { Empty, Field, Modal, MoneyInput, Seg, toast } from '../components/ui';
import type { Category, Product, ProductType, StockMove } from '../lib/types';

const TYPE_LABEL: Record<ProductType, string> = { buket: 'Buket', addon: 'Add-on', jasa: 'Jasa', bahan: 'Bahan baku' };

export default function Produk() {
  const products = useLiveQuery(() => db.products.toArray(), []) || [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) || [];
  const stock = useLiveQuery(() => stockLevels(), []) || new Map<string, number>();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Product | null>(null);
  const [adj, setAdj] = useState<Product | null>(null);
  const [cats, setCats] = useState(false);
  const catName = (id?: string) => categories.find((c) => c.id === id)?.name || '-';
  const list = useMemo(() => {
    const s = q.toLowerCase();
    return products.filter((p) => !p.deleted && (!s || p.name.toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s))).sort((a, b) => a.name.localeCompare(b.name));
  }, [products, q]);
  // Impor v1.0–1.2 membaca "harga_modal" Kasir Pintar yang ternyata = HPP satuan × stok. HPP asli = nilai itu ÷ stok awal impor.
  const importMoves = useLiveQuery(() => db.stock_moves.filter((m) => m.reason === 'impor').toArray(), []) || [];
  const fixes = useMemo(() => products.flatMap((p) => {
    if (!p.id.startsWith('kp-') || !(p.cost > p.price) || p.price <= 0) return [];
    const m = importMoves.find((x) => x.product_id === p.id);
    if (!m || m.qty <= 1 || p.cost % m.qty !== 0) return [];
    const unit = p.cost / m.qty;
    return unit <= p.price ? [{ p, stok: m.qty, unit }] : [];
  }), [products, importMoves]);
  async function applyFixes() {
    await saveMany(fixes.map((f) => ({ c: 'products' as const, id: f.p.id, patch: { cost: f.unit } })));
    toast(`HPP ${fixes.length} produk diperbaiki`);
  }

  return (
    <div className="page">
      <div className="toolbar">
        <input className="grow" placeholder="Cari produk" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" onClick={() => setCats(true)}>Kategori</button>
        <button className="btn primary" onClick={() => setEdit({ id: '', name: '', type: 'buket', price: 0, cost: 0, active: true, category_id: categories[0]?.id })} data-testid="btn-produk-baru">＋ Produk</button>
      </div>
      {fixes.length > 0 && (
        <div className="note warn" data-testid="fix-hpp">
          <b>{fixes.length} produk hasil impor punya HPP lebih besar dari harga jual.</b> Penyebab: impor lama membaca nilai modal total (HPP × stok) dari Kasir Pintar. Contoh: {fixes[0].p.name}: {rp(fixes[0].p.cost)} ÷ stok {num(fixes[0].stok)} = {rp(fixes[0].unit)} per unit.
          <div style={{ marginTop: 8 }}><button className="btn small primary" onClick={applyFixes}>Perbaiki HPP {fixes.length} produk</button></div>
        </div>
      )}
      <div className="table" style={{ ['--cols' as string]: 'minmax(0,1fr) 150px 120px 170px 80px 90px', ['--cols-sm' as string]: 'minmax(0,1fr) auto 64px' }}>
        <div className="thead"><div>Nama</div><div className="hide-sm">Kategori</div><div className="right">Harga</div><div className="right hide-sm">HPP</div><div className="right hide-sm">Margin</div><div className="right">Stok</div></div>
        {list.map((p) => {
          const bad = p.cost > p.price && p.price > 0;
          const margin = p.price ? ((p.price - p.cost) / p.price) * 100 : 0;
          const st = stock.get(p.id) || 0;
          return (
            <div key={p.id} className={`trow ${p.active === false ? 'void' : ''}`}>
              <button className="linkish" onClick={() => setEdit(p)}><b>{p.name}</b><div className="muted">{TYPE_LABEL[p.type]}{p.sku ? ` · ${p.sku}` : ''}</div></button>
              <div className="hide-sm muted">{catName(p.category_id)}</div>
              <div className="right">{rp(p.price)}</div>
              <div className={`right hide-sm ${bad ? 'red' : p.cost ? '' : 'muted'}`}>{p.cost ? rp(p.cost) : 'belum diisi'}</div>
              <div className={`right hide-sm ${bad || margin < 30 ? 'red' : ''}`}>{bad ? 'cek HPP' : p.cost ? `${margin.toFixed(0)}%` : '—'}</div>
              <div className="right">{p.track_stock ? <button className={`btn small ${st <= (p.min_stock || 0) ? 'danger' : ''}`} onClick={() => setAdj(p)}>{num(st)}</button> : <span className="muted">—</span>}</div>
            </div>
          );
        })}
        {!list.length && <Empty>Belum ada produk.</Empty>}
      </div>
      <p className="muted small">Margin = (harga − HPP) ÷ harga. Merah bila di bawah 30% atau HPP lebih besar dari harga jual.</p>
      {edit && <ProductForm p={edit} categories={categories} onClose={() => setEdit(null)} />}
      {adj && <StockAdjust p={adj} current={stock.get(adj.id) || 0} onClose={() => setAdj(null)} />}
      {cats && <CategoryManager categories={categories} onClose={() => setCats(false)} />}
    </div>
  );
}

async function resizePhoto(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const size = 320;
  const scale = Math.min(1, size / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}

function ProductForm({ p, categories, onClose }: { p: Product; categories: Category[]; onClose: () => void }) {
  const [f, setF] = useState(p);
  async function submit() {
    const id = f.id || newId('pr');
    const { id: _, created_at, updated_at, ...patch } = f;
    await save<Product>('products', id, patch);
    toast('Produk disimpan');
    onClose();
  }
  return (
    <Modal title={p.id ? 'Ubah produk' : 'Produk baru'} onClose={onClose}
      footer={<>
        {p.id && <button className="btn danger" onClick={async () => { if (confirm('Hapus produk ini?')) { await save<Product>('products', p.id, { deleted: true, active: false }); onClose(); } }}>Hapus</button>}
        <button className="btn primary grow" disabled={!f.name} onClick={submit} data-testid="btn-simpan-produk">Simpan</button>
      </>}>
      <div className="stack">
        <div className="photo-row">
          <label className="photo" style={{ backgroundImage: f.photo ? `url(${f.photo})` : undefined }}>
            {!f.photo && 'Foto'}
            <input type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (file) setF({ ...f, photo: await resizePhoto(file) }); }} />
          </label>
          <div className="grow stack">
            <Field label="Nama produk"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="produk-nama" /></Field>
            <Field label="Kode/SKU"><input value={f.sku || ''} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
          </div>
        </div>
        <Seg value={f.type} onChange={(type) => setF({ ...f, type })} options={(Object.keys(TYPE_LABEL) as ProductType[]).map((value) => ({ value, label: TYPE_LABEL[value] }))} />
        <Field label="Kategori">
          <select value={f.category_id || ''} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
            {categories.filter((c) => !c.deleted).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <div className="cols">
          <Field label="Harga jual"><MoneyInput value={f.price} onChange={(price) => setF({ ...f, price })} ariaLabel="Harga jual" /></Field>
          <Field label="HPP/modal" hint={f.price ? `Laba per unit ${rp(f.price - f.cost)} (${(((f.price - f.cost) / f.price) * 100).toFixed(0)}%)` : undefined}><MoneyInput value={f.cost} onChange={(cost) => setF({ ...f, cost })} ariaLabel="HPP" /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={!!f.track_stock} onChange={(e) => setF({ ...f, track_stock: e.target.checked })} /> Lacak stok (untuk buket siap jual, add-on, bahan)</label>
        {f.track_stock && <Field label="Stok minimum (peringatan)"><input type="number" value={f.min_stock || 0} onChange={(e) => setF({ ...f, min_stock: Number(e.target.value) })} /></Field>}
        <label className="check"><input type="checkbox" checked={f.active !== false} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Aktif (tampil di kasir)</label>
        <Field label="Deskripsi"><textarea rows={2} value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function StockAdjust({ p, current, onClose }: { p: Product; current: number; onClose: () => void }) {
  const [mode, setMode] = useState<'stok_masuk' | 'opname' | 'rusak'>('stok_masuk');
  const [qty, setQty] = useState(0);
  const [note, setNote] = useState('');
  const delta = mode === 'stok_masuk' ? qty : mode === 'rusak' ? -qty : qty - current;
  async function submit() {
    if (!delta) return onClose();
    const cfg = await getDeviceConfig();
    await save<StockMove>('stock_moves', newId('m'), { product_id: p.id, outlet_id: cfg.outletId, qty: delta, reason: mode, note });
    toast(`Stok ${p.name}: ${current} → ${current + delta}`);
    onClose();
  }
  return (
    <Modal title={`Stok · ${p.name}`} onClose={onClose} footer={<button className="btn primary grow" onClick={submit}>Simpan ({delta >= 0 ? '+' : ''}{delta})</button>}>
      <div className="stack">
        <div className="muted">Stok sekarang: <b>{current}</b></div>
        <Seg value={mode} onChange={setMode} options={[{ value: 'stok_masuk', label: 'Stok masuk' }, { value: 'opname', label: 'Opname (hitung fisik)' }, { value: 'rusak', label: 'Rusak/layu' }]} />
        <Field label={mode === 'opname' ? 'Jumlah fisik' : 'Jumlah'}><input type="number" min={0} value={qty} onChange={(e) => setQty(Math.max(0, Number(e.target.value)))} /></Field>
        <Field label="Catatan"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function CategoryManager({ categories, onClose }: { categories: Category[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const list = categories.filter((c) => !c.deleted).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  return (
    <Modal title="Kategori" onClose={onClose}>
      <div className="stack">
        {list.map((c) => (
          <div key={c.id} className="row">
            <input defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && save<Category>('categories', c.id, { name: e.target.value })} />
            <button className="btn small danger" onClick={() => save<Category>('categories', c.id, { deleted: true })}>Hapus</button>
          </div>
        ))}
        <div className="row">
          <input placeholder="Kategori baru" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" disabled={!name} onClick={async () => { await save<Category>('categories', newId('cat'), { name, sort: list.length + 1 }); setName(''); }}>Tambah</button>
        </div>
      </div>
    </Modal>
  );
}
