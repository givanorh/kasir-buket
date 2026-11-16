import { useEffect, useMemo, useState } from 'react';
import { saveMany, newId } from '../lib/store';
import { num, rp } from '../lib/format';
import type { Report } from '../lib/calc';
import { FREQ_LABEL, GROUP_LABEL, ROLE_LABEL_STAFF, hppPerBuket, monthlyOf, thrOf } from '../lib/costs';
import { Badge, Field, MoneyInput, Seg, toast } from '../components/ui';
import { Icon } from '../components/icons';
import Belanja from './Belanja';
import type { CostFreq, CostGroup, CostItem, HppMethod, StaffRole } from '../lib/types';

type Sub = 'ringkasan' | 'belanja' | 'biaya';
const HPP_LABEL: Record<HppMethod, string> = { gabungan: 'modal produk + belanja bahan', belanja: 'belanja bahan', produk: 'modal produk' };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const f1 = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 1 });

/** Laporan › Perhitungan HPP: ringkasan HPP penuh per buket, belanja bahan, serta gaji & biaya operasional (editable). */
export function HppView({ r, costs, from, to, hppMethod }: { r: Report; costs: CostItem[]; from: Date; to: Date; hppMethod: HppMethod }) {
  const [sub, setSub] = useState<Sub>(() => (/[?&]s=belanja/.test(location.hash) ? 'belanja' : /[?&]s=biaya/.test(location.hash) ? 'biaya' : 'ringkasan'));
  return (
    <div className="page" data-testid="hpp">
      <div className="toolbar">
        <Seg value={sub} onChange={setSub} options={[{ value: 'ringkasan', label: 'Ringkasan HPP' }, { value: 'belanja', label: 'Belanja bahan' }, { value: 'biaya', label: 'Gaji & biaya' }]} />
      </div>
      {sub === 'ringkasan' && <Ringkasan r={r} from={from} to={to} hppMethod={hppMethod} onEdit={() => setSub('biaya')} />}
      {sub === 'belanja' && <Belanja />}
      {sub === 'biaya' && <BiayaEditor costs={costs} />}
    </div>
  );
}

function Ringkasan({ r, from, to, hppMethod, onEdit }: { r: Report; from: Date; to: Date; hppMethod: HppMethod; onEdit: () => void }) {
  const labor = r.labor + r.benefits;
  const overhead = r.opex + r.expenses;
  const h = hppPerBuket({ buketQty: r.buketQty, buketSales: r.buketSales, cogs: r.cogs, labor, overhead, monthlyFixed: r.costs.monthlyFixed });
  const days = Math.round((to.getTime() - from.getTime()) / 86400e3);
  const q = r.buketQty;
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; amount: number; n: number }>();
    const lab: Record<string, string> = { gaji: 'Gaji pegawai', thr: 'THR', bonus: 'Bonus tahunan', ...GROUP_LABEL, tunjangan: 'Bonus tambahan & tunjangan' };
    for (const l of r.costs.lines) {
      if (!l.pl) continue;
      const g = m.get(l.cat) || { label: lab[l.cat] || l.cat, amount: 0, n: 0 };
      g.amount += l.amount; g.n++;
      m.set(l.cat, g);
    }
    return [...m.values()].filter((g) => g.amount > 0);
  }, [r.costs]);
  const standby = r.costs.lines.filter((l) => l.cat === 'kas');
  return (
    <>
      <div className="kpis" data-testid="hpp-kpis">
        <div className="kpi"><span>Buket terjual</span><b>{num(q)}</b><i>{days ? `${f1(q / days)} buket/hari` : 'hari ini'}</i></div>
        <div className="kpi"><span>HPP penuh per buket</span><b data-testid="hpp-per-buket">{q ? rp(Math.round(h.full)) : '–'}</b><i>bahan + tenaga kerja + overhead</i></div>
        <div className="kpi"><span>Harga rata-rata per buket</span><b>{q ? rp(Math.round(h.price)) : '–'}</b><i>margin {q ? `${rp(Math.round(h.margin))} (${f1(h.marginPct)}%)` : '–'}</i></div>
        <div className="kpi"><span>Titik impas</span><b>{h.bep !== null ? `${num(h.bep)} buket` : '–'}</b><i>per bulan · ≈ {h.bep !== null ? f1(h.bep / 30) : '–'} buket/hari</i></div>
      </div>
      <div className="two">
        <section className="card">
          <h3>HPP penuh per buket</h3>
          <div className="row"><span>HPP bahan ({HPP_LABEL[hppMethod]})</span><b>{rp(r.cogs)}</b></div>
          <div className="row"><span>+ Tenaga kerja (gaji, THR, bonus)</span><b>{rp(labor)}</b></div>
          <div className="row"><span>+ Overhead (biaya operasional + kas keluar biaya)</span><b>{rp(overhead)}</b></div>
          <div className="row strong"><span>= Biaya total periode</span><b>{rp(r.cogs + labor + overhead)}</b></div>
          <div className="calc" data-testid="hpp-rumus">
            {q ? <>
              Bahan {rp(r.cogs)} ÷ {num(q)} buket = {rp(Math.round(h.bahan))}<br />
              Tenaga kerja {rp(labor)} ÷ {num(q)} = {rp(Math.round(h.tk))}<br />
              Overhead {rp(overhead)} ÷ {num(q)} = {rp(Math.round(h.oh))}<br />
              <b>HPP penuh = {rp(Math.round(h.bahan))} + {rp(Math.round(h.tk))} + {rp(Math.round(h.oh))} = {rp(Math.round(h.full))} per buket</b><br />
              Harga rata-rata {rp(r.buketSales)} ÷ {num(q)} = {rp(Math.round(h.price))} → margin {rp(Math.round(h.margin))} ({f1(h.marginPct)}%)
            </> : 'Belum ada buket terjual pada periode ini.'}
          </div>
          {r.netSales > 0 && r.salesNoCost / r.netSales > 0.1 && hppMethod !== 'belanja' && (
            <div className="note warn small" data-testid="hpp-bahan-rendah">{f1((r.salesNoCost / r.netSales) * 100)}% penjualan periode ini berasal dari produk ber-HPP Rp 0 (umumnya hasil impor Kasir Pintar), jadi HPP bahan dan HPP penuh di atas terlalu rendah. Isi HPP di menu Produk, catat belanja bahan, atau pilih dasar HPP “Belanja bahan” di Laba rugi.</div>
          )}
          <p className="muted small">Laba rugi tetap memakai HPP bahan; gaji dan biaya masuk ke beban. HPP penuh dipakai untuk menentukan harga minimal agar tidak rugi.</p>
        </section>
        <section className="card">
          <h3>Biaya tetap & titik impas</h3>
          <div className="row"><span>Biaya tetap per bulan</span><b data-testid="biaya-tetap">{rp(r.costs.monthlyFixed)}</b></div>
          <div className="row"><span>Margin kontribusi per buket (harga − bahan)</span><b>{q ? rp(Math.round(h.price - h.bahan)) : '–'}</b></div>
          <div className="row strong"><span>Titik impas</span><b>{h.bep !== null ? `${num(h.bep)} buket/bulan` : '–'}</b></div>
          <div className="calc">{h.bep !== null ? <>⌈{rp(r.costs.monthlyFixed)} ÷ {rp(Math.round(h.price - h.bahan))}⌉ = {num(h.bep)} buket per bulan ≈ {f1(h.bep / 30)} buket per hari (30 hari).</> : 'Titik impas muncul setelah ada penjualan buket dan harga rata-rata di atas biaya bahan.'}</div>
          <h3>Beban periode ini</h3>
          {groups.map((g) => <div key={g.label} className="row"><span>{g.label} <span className="muted">({g.n})</span></span><b>{rp(g.amount)}</b></div>)}
          {r.expenses > 0 && <div className="row"><span>Kas keluar berjenis biaya (Shift)</span><b>{rp(r.expenses)}</b></div>}
          {!groups.length && <p className="muted small">Belum ada gaji atau biaya. <button className="linkish" onClick={onEdit}>Isi gaji & biaya</button></p>}
          {standby.some((s) => s.amount > 0) && <div className="row muted"><span>Uang standby di laci (modal kerja, tidak mengurangi laba)</span><b>{rp(standby.reduce((s, x) => s + x.amount, 0))}</b></div>}
          <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={onEdit}><Icon name="pengaturan" size={16} />Ubah gaji & biaya</button>
        </section>
      </div>
    </>
  );
}

type Draft = CostItem & { _dirty?: boolean; _new?: boolean };

function BiayaEditor({ costs }: { costs: CostItem[] }) {
  const [draft, setDraft] = useState<Draft[] | null>(null);
  useEffect(() => { if (!draft && costs.length) setDraft(costs.filter((c) => !c.deleted).sort((a, b) => (a.sort || 0) - (b.sort || 0))); }, [costs]); // eslint-disable-line
  if (!draft) return <div className="muted">Menyiapkan data gaji & biaya…</div>;
  const today = ymd(new Date());
  const upd = (id: string, p: Partial<CostItem>) => setDraft(draft.map((c) => (c.id === id ? { ...c, ...p, _dirty: true } : c)));
  const staff = draft.filter((c) => c.kind === 'pegawai' && !c.deleted);
  const thr = draft.find((c) => c.kind === 'thr');
  const items = draft.filter((c) => c.kind === 'biaya' && !c.deleted);
  const dirty = draft.filter((c) => c._dirty && !(c._new && c.deleted));
  const activeStaff = staff.filter((p) => p.active !== false);
  const gajiBulan = activeStaff.reduce((s, p) => s + (p.salary || 0), 0);
  const thrTahun = thr && thr.active !== false ? activeStaff.reduce((s, p) => s + thrOf(p, today, thr.mult ?? 1), 0) : 0;
  const bonusTahun = activeStaff.reduce((s, p) => s + (p.bonus_year || 0), 0);
  const rutin = items.filter((c) => c.active !== false && c.pl !== false && c.group !== 'kas').reduce((s, c) => s + monthlyOf(c), 0);
  const tetap = gajiBulan + thrTahun / 12 + bonusTahun / 12 + rutin;
  const maxSort = Math.max(0, ...draft.map((c) => c.sort || 0));

  async function simpan() {
    await saveMany(dirty.map(({ _dirty, _new, id, created_at, updated_at, ...p }) => ({ c: 'costs' as const, id, patch: p })));
    setDraft(draft!.filter((c) => !(c.deleted && c._new)).map(({ _dirty, _new, ...c }) => c));
    toast(`${dirty.length} perubahan gaji & biaya disimpan`);
  }
  const addStaff = () => setDraft([...draft, { id: newId('cost'), kind: 'pegawai', name: '', role: 'admin', salary: 0, bonus_year: 0, active: true, sort: maxSort + 1, _dirty: true, _new: true }]);
  const addItem = () => setDraft([...draft, { id: newId('cost'), kind: 'biaya', name: '', group: 'operasional', freq: 'bulan', amount: 0, pl: true, active: true, sort: maxSort + 1, _dirty: true, _new: true }]);

  return (
    <div className="stack" data-testid="biaya-editor">
      <div className="kpis">
        <div className="kpi"><span>Gaji per bulan</span><b data-testid="total-gaji">{rp(gajiBulan)}</b><i>{activeStaff.length} pegawai aktif</i></div>
        <div className="kpi"><span>THR setahun</span><b>{rp(thrTahun)}</b><i>≈ {rp(Math.round(thrTahun / 12))}/bulan</i></div>
        <div className="kpi"><span>Biaya rutin per bulan</span><b>{rp(Math.round(rutin))}</b><i>{items.filter((c) => c.pl !== false && c.group !== 'kas' && (c.amount || c.pct)).length} biaya terisi</i></div>
        <div className="kpi"><span>Biaya tetap per bulan</span><b>{rp(Math.round(tetap))}</b><i>gaji + THR/12 + bonus/12 + rutin</i></div>
      </div>

      <section className="card">
        <h3>Gaji pegawai</h3>
        <div className="ctable" role="table" aria-label="Gaji pegawai">
          <div className="crow head staff" role="row"><span>Aktif</span><span>Nama</span><span>Peran</span><span>Gaji/bulan</span><span>Bonus tahunan</span><span>Mulai kerja</span><span>THR</span><span /></div>
          {staff.map((p) => (
            <div key={p.id} className={`crow staff ${p.active === false ? 'off' : ''}`} role="row" data-testid="pegawai-row">
              <label className="check"><input type="checkbox" checked={p.active !== false} onChange={(e) => upd(p.id, { active: e.target.checked })} aria-label={`Aktif: ${p.name}`} /></label>
              <input value={p.name} onChange={(e) => upd(p.id, { name: e.target.value })} aria-label="Nama pegawai" placeholder="Nama" />
              <select value={p.role || 'admin'} onChange={(e) => upd(p.id, { role: e.target.value as StaffRole })} aria-label={`Peran ${p.name}`}>{(Object.keys(ROLE_LABEL_STAFF) as StaffRole[]).map((k) => <option key={k} value={k}>{ROLE_LABEL_STAFF[k]}</option>)}</select>
              <MoneyInput value={p.salary || 0} onChange={(salary) => upd(p.id, { salary })} ariaLabel={`Gaji ${p.name}`} />
              <MoneyInput value={p.bonus_year || 0} onChange={(bonus_year) => upd(p.id, { bonus_year })} ariaLabel={`Bonus tahunan ${p.name}`} />
              <input type="date" value={p.start || ''} onChange={(e) => upd(p.id, { start: e.target.value || undefined })} aria-label={`Mulai kerja ${p.name}`} />
              <span className="c-num">{thr && thr.active !== false ? rp(thrOf(p, today, thr.mult ?? 1)) : '–'}</span>
              <button className="icon-btn" onClick={() => upd(p.id, { deleted: true })} aria-label={`Hapus ${p.name}`}><Icon name="close" size={18} /></button>
            </div>
          ))}
          <div className="crow foot staff"><span /><b>Jumlah</b><span /><b data-testid="jumlah-gaji">{rp(gajiBulan)}</b><b>{rp(bonusTahun)}</b><span /><b>{rp(thrTahun)}</b><span /></div>
        </div>
        <button className="btn small rv-add" onClick={addStaff} data-testid="tambah-pegawai"><Icon name="plus" size={16} />Tambah pegawai</button>
        {thr && (
          <div className="thr-box">
            <label className="check"><input type="checkbox" checked={thr.active !== false} onChange={(e) => upd(thr.id, { active: e.target.checked })} />Hitung THR</label>
            <Field label="Pengali THR (× gaji)"><input type="number" min={0} step={0.5} value={thr.mult ?? 1} onChange={(e) => upd(thr.id, { mult: Math.max(0, Number(e.target.value)) })} aria-label="Pengali THR" /></Field>
            <p className="muted small">THR setahun per pegawai = gaji × pengali; masa kerja 1–11 bulan dihitung proporsional (masa kerja ÷ 12), di bawah 1 bulan Rp 0 (Permenaker 6/2016, dibayar paling lambat H-7 hari raya). Tanpa tanggal mulai kerja dianggap ≥ 12 bulan. THR dan bonus tahunan dibagi rata ke 12 bulan di laporan.</p>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Biaya operasional</h3>
        <div className="ctable" role="table" aria-label="Biaya operasional">
          <div className="crow head cost" role="row"><span>Aktif</span><span>Nama biaya</span><span>Kelompok</span><span>Frekuensi</span><span>Nilai</span><span>Per bulan</span><span>Laba rugi</span><span /></div>
          {items.map((c) => (
            <div key={c.id} className={`crow cost ${c.active === false ? 'off' : ''}`} role="row" data-testid="biaya-row">
              <label className="check"><input type="checkbox" checked={c.active !== false} onChange={(e) => upd(c.id, { active: e.target.checked })} aria-label={`Aktif: ${c.name}`} /></label>
              <div className="c-name"><input value={c.name} onChange={(e) => upd(c.id, { name: e.target.value })} aria-label="Nama biaya" placeholder="mis. Gas elpiji" />{c.note && <span className="muted small">{c.note}</span>}</div>
              <select value={c.group || 'operasional'} onChange={(e) => { const group = e.target.value as CostGroup; upd(c.id, { group, pl: group === 'kas' ? false : c.pl === false && c.group === 'kas' ? true : c.pl }); }} aria-label={`Kelompok ${c.name}`}>
                {(Object.keys(GROUP_LABEL) as CostGroup[]).map((k) => <option key={k} value={k}>{GROUP_LABEL[k]}</option>)}
              </select>
              <div className="c-freq">
                {c.group === 'kas' ? <span className="muted small">saldo</span> : (
                  <select value={c.freq || 'bulan'} onChange={(e) => upd(c.id, { freq: e.target.value as CostFreq, every: e.target.value === 'n_bulan' ? c.every || 3 : c.every, date: e.target.value === 'sekali' ? c.date || today : c.date })} aria-label={`Frekuensi ${c.name}`}>
                    {(Object.keys(FREQ_LABEL) as CostFreq[]).map((k) => <option key={k} value={k}>{FREQ_LABEL[k]}</option>)}
                  </select>
                )}
                {c.group !== 'kas' && c.freq === 'n_bulan' && <label className="c-every">tiap <input type="number" min={1} max={60} value={c.every || 1} onChange={(e) => upd(c.id, { every: Math.max(1, Number(e.target.value)) })} aria-label={`Tiap berapa bulan ${c.name}`} /> bln</label>}
                {c.group !== 'kas' && c.freq === 'sekali' && <input type="date" value={c.date || ''} onChange={(e) => upd(c.id, { date: e.target.value })} aria-label={`Tanggal ${c.name}`} />}
              </div>
              {c.freq === 'persen' && c.group !== 'kas'
                ? <div className="money pct"><input type="number" min={0} max={100} step={0.1} value={c.pct || 0} onChange={(e) => upd(c.id, { pct: Math.max(0, Math.min(100, Number(e.target.value))) })} aria-label={`Persen ${c.name}`} /><span>%</span></div>
                : <MoneyInput value={c.amount || 0} onChange={(amount) => upd(c.id, { amount })} ariaLabel={`Nilai ${c.name}`} />}
              <span className="c-num">{c.group === 'kas' ? <Badge>modal kerja</Badge> : c.freq === 'persen' ? `${f1(c.pct || 0)}% penjualan` : c.freq === 'sekali' ? 'sekali' : rp(Math.round(monthlyOf(c)))}</span>
              <label className="check" title="Masuk laba rugi sebagai beban"><input type="checkbox" checked={c.pl !== false && c.group !== 'kas'} disabled={c.group === 'kas'} onChange={(e) => upd(c.id, { pl: e.target.checked })} aria-label={`Masuk laba rugi: ${c.name}`} /></label>
              <button className="icon-btn" onClick={() => upd(c.id, { deleted: true })} aria-label={`Hapus ${c.name}`}><Icon name="close" size={18} /></button>
            </div>
          ))}
        </div>
        <button className="btn small rv-add" onClick={addItem} data-testid="tambah-biaya"><Icon name="plus" size={16} />Tambah biaya</button>
        <p className="muted small">Per bulan: nilai bulanan; tiap N bulan = nilai ÷ N; per tahun = nilai ÷ 12. Biaya "sekali" masuk ke tanggalnya, biaya persen dihitung dari penjualan bersih periode. Uang standby di laci adalah modal kerja yang berputar, jadi tidak mengurangi laba.</p>
      </section>

      <div className={`savebar ${dirty.length ? 'on' : ''}`}>
        <span className="muted">{dirty.length ? `${dirty.length} perubahan belum disimpan` : 'Semua tersimpan'}</span>
        <button className="btn primary" disabled={!dirty.length || dirty.some((c) => !c.deleted && !c.name.trim())} onClick={simpan} data-testid="simpan-biaya">Simpan gaji & biaya</button>
      </div>
    </div>
  );
}
