import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { buildAnalysis, buildReport, scheduledQtyOn } from '../lib/calc';
import { addDays, dayKey, endOfDay, fmtDate, num, rp, startOfDay } from '../lib/format';
import { Field, Seg } from '../components/ui';
import { storeCfg } from '../lib/settings';
import type { Order } from '../lib/types';

type Preset = 'hari' | 'kemarin' | '7' | 'bulan' | 'custom';

function rangeOf(p: Preset, a: string, b: string): [Date, Date] {
  const now = new Date();
  if (p === 'hari') return [startOfDay(now), endOfDay(now)];
  if (p === 'kemarin') { const y = addDays(now, -1); return [startOfDay(y), endOfDay(y)]; }
  if (p === '7') return [startOfDay(addDays(now, -6)), endOfDay(now)];
  if (p === 'bulan') return [new Date(now.getFullYear(), now.getMonth(), 1), endOfDay(now)];
  return [startOfDay(new Date(a)), endOfDay(new Date(b))];
}

function csv(name: string, rows: (string | number)[][]) {
  const text = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export default function Laporan() {
  const [preset, setPreset] = useState<Preset>('hari');
  const [a, setA] = useState(dayKey(addDays(new Date(), -30)));
  const [b, setB] = useState(dayKey(new Date()));
  const [outlet, setOutlet] = useState('');
  const [view, setView] = useState<'labarugi' | 'analisis'>('labarugi');
  const orders = useLiveQuery(() => db.orders.toArray(), []) || [];
  const payments = useLiveQuery(() => db.payments.toArray(), []) || [];
  const cashMoves = useLiveQuery(() => db.cash_moves.toArray(), []) || [];
  const outlets = useLiveQuery(() => db.outlets.toArray(), []) || [];
  const settings = useLiveQuery(() => db.settings.get('toko'));
  const [from, to] = rangeOf(preset, a, b);
  const r = useMemo(() => buildReport({ orders, payments, cashMoves, from, to, outletId: outlet || undefined }), [orders, payments, cashMoves, from.getTime(), to.getTime(), outlet]);
  const piutangAll = useMemo(() => {
    const paid = new Map<string, number>();
    for (const p of payments) if (!p.void) paid.set(p.order_id, (paid.get(p.order_id) || 0) + p.amount);
    return orders.filter((o) => !o.void).reduce((s, o) => s + Math.max(0, o.total - (paid.get(o.id) || 0)), 0);
  }, [orders, payments]);
  const cap = settings?.daily_capacity || 0;
  const next14 = Array.from({ length: 14 }, (_, i) => addDays(new Date(), i));
  const recon = r.paidForPeriodOrders + r.outstandingForPeriodOrders;

  function exportCsv() {
    const xs = orders.filter((o) => { const t = new Date(o.created_at!).getTime(); return t >= from.getTime() && t <= to.getTime() && (!outlet || o.outlet_id === outlet); });
    const rows: (string | number)[][] = [['No', 'Waktu', 'Kasir', 'Pelanggan', 'Item', 'Qty', 'Harga', 'Potongan', 'HPP', 'Total transaksi', 'Status', 'Pengambilan', 'Jadwal']];
    for (const o of xs) for (const it of o.items) rows.push([o.no, o.created_at!, o.cashier_name || '', o.customer_name || '', it.name, it.qty, it.price, it.discount, it.cost, o.total, o.void ? 'BATAL' : o.production_status, o.fulfillment, o.due_at || '']);
    csv(`penjualan-${dayKey(from)}_${dayKey(to)}.csv`, rows);
  }

  return (
    <div className="page">
      <div className="toolbar">
        <Seg value={view} onChange={setView} options={[{ value: 'labarugi', label: 'Laba rugi' }, { value: 'analisis', label: 'Analisis penjualan' }]} />
        <span className="grow" />
        <button className="btn" onClick={exportCsv}>Ekspor CSV</button>
      </div>
      <div className="toolbar filters">
        <Seg value={preset} onChange={setPreset} options={[{ value: 'hari', label: 'Hari ini' }, { value: 'kemarin', label: 'Kemarin' }, { value: '7', label: '7 hari' }, { value: 'bulan', label: 'Bulan ini' }, { value: 'custom', label: 'Pilih' }]} />
        {preset === 'custom' && <span className="daterange"><input type="date" value={a} onChange={(e) => setA(e.target.value)} aria-label="Dari tanggal" /><span>s.d.</span><input type="date" value={b} onChange={(e) => setB(e.target.value)} aria-label="Sampai tanggal" /></span>}
        {outlets.length > 1 && <select value={outlet} onChange={(e) => setOutlet(e.target.value)} aria-label="Cabang"><option value="">Semua cabang</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
        <span className="muted">{fmtDate(from.toISOString())} s.d. {fmtDate(to.toISOString())}{r.voided ? ` · ${r.voided} transaksi batal tidak dihitung` : ''}</span>
      </div>
      {view === 'analisis' ? <Analisis orders={orders} from={from} to={to} outletId={outlet || undefined} /> : <>

      <div className="kpis" data-testid="kpis">
        <div className="kpi"><span>Transaksi</span><b>{num(r.count)}</b><i>{num(r.qty)} item</i></div>
        <div className="kpi"><span>Penjualan bersih</span><b>{rp(r.netSales)}</b><i>rata-rata {rp(r.count ? r.netSales / r.count : 0)}/trx</i></div>
        <div className="kpi"><span>Laba kotor</span><b>{rp(r.grossProfit)}</b><i>margin {r.netSales ? ((r.grossProfit / r.netSales) * 100).toFixed(1) : 0}%</i></div>
        <div className="kpi"><span>Laba bersih</span><b className={r.netProfit < 0 ? 'red' : ''}>{rp(r.netProfit)}</b><i>setelah beban {rp(r.expenses)}</i></div>
      </div>

      <div className="two">
        <section className="card">
          <h3>Laba rugi</h3>
          <div className="row"><span>Penjualan kotor (Σ qty × harga)</span><b>{rp(r.gross)}</b></div>
          <div className="row"><span>− Diskon</span><b>{rp(r.discount)}</b></div>
          <div className="row"><span>+ Ongkir/biaya tambahan</span><b>{rp(r.extraFee)}</b></div>
          <div className="row strong"><span>= Penjualan bersih</span><b>{rp(r.netSales)}</b></div>
          <div className="row"><span>− HPP (Σ qty × modal)</span><b>{rp(r.cogs)}</b></div>
          <div className="row strong"><span>= Laba kotor</span><b>{rp(r.grossProfit)}</b></div>
          <div className="row"><span>− Beban operasional</span><b>{rp(r.expenses)}</b></div>
          <div className="row strong"><span>= Laba bersih</span><b>{rp(r.netProfit)}</b></div>
          {r.salesNoCost > 0 && r.netSales > 0 && (
            <div className="note warn small" data-testid="hpp-kosong">{rp(r.salesNoCost)} ({((r.salesNoCost / r.netSales) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}% penjualan) berasal dari item ber-HPP Rp 0, sehingga laba kotor tercatat lebih tinggi dari kenyataan. Isi HPP di menu Produk; transaksi baru memakai HPP terbaru.</div>
          )}
          <h3>Rekonsiliasi</h3>
          <div className="row"><span>Sudah dibayar (transaksi periode ini)</span><b>{rp(r.paidForPeriodOrders)}</b></div>
          <div className="row"><span>+ Sisa tagihan (DP/belum bayar)</span><b>{rp(r.outstandingForPeriodOrders)}</b></div>
          <div className={`row strong ${recon === r.netSales ? 'ok' : 'red'}`}><span>= Penjualan bersih {recon === r.netSales ? '✓ cocok' : '✗ selisih'}</span><b>{rp(recon)}</b></div>
          <div className="row"><span>Total piutang semua periode</span><b>{rp(piutangAll)}</b></div>
        </section>
        <section className="card">
          <h3>Kas masuk per metode (basis tanggal bayar)</h3>
          {r.cashIn.map((m) => <div key={m.method} className="row"><span>{m.method} <span className="muted">({num(m.count)}×)</span></span><b>{rp(m.amount)}</b></div>)}
          <div className="row strong"><span>Jumlah</span><b>{rp(r.cashInTotal)}</b></div>
          <p className="muted small">Kas masuk menghitung DP dan pelunasan pada tanggal uang diterima, sehingga bisa berbeda dari penjualan bersih.</p>
          <h3>Per kasir</h3>
          {r.byCashier.map((c) => <div key={c.name} className="row"><span>{c.name} <span className="muted">({num(c.count)} trx)</span></span><b>{rp(c.sales)}</b></div>)}
        </section>
      </div>

      <section className="card">
        <h3>Per produk <span className="muted">· {num(r.byProduct.length)} produk{r.byProduct.length > 50 ? ', 50 teratas' : ''}</span></h3>
        <div className="table flat" style={{ ['--cols' as string]: 'minmax(0,1fr) 72px 150px 150px 150px 72px', ['--cols-sm' as string]: 'minmax(0,1fr) 44px 104px 104px' }}>
          <div className="thead"><div>Produk</div><div className="right">Qty</div><div className="right">Penjualan</div><div className="right hide-sm">HPP</div><div className="right">Laba</div><div className="right hide-sm">Porsi</div></div>
          {r.byProduct.slice(0, 50).map((p) => (
            <div key={p.name} className="trow">
              <div className="clip">{p.name}</div>
              <div className="right">{num(p.qty)}</div>
              <div className="right">{rp(p.sales)}</div>
              <div className={`right hide-sm ${p.cogs ? '' : 'muted'}`}>{p.cogs ? rp(p.cogs) : 'HPP 0'}</div>
              <div className="right">{rp(p.profit)}</div>
              <div className="right hide-sm muted">{r.netSales ? ((p.sales / r.netSales) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 }) : 0}%</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Jadwal pesanan 14 hari ke depan {cap ? `(kapasitas ${cap} buket/hari)` : ''}</h3>
        <div className="capacity">
          {next14.map((d) => {
            const n = scheduledQtyOn(orders, dayKey(d), dayKey);
            const pct = cap ? Math.min(100, (n / cap) * 100) : 0;
            return <div key={dayKey(d)} className={cap && n > cap ? 'over' : ''}><span>{fmtDate(d.toISOString()).replace(/ \d{4}$/, '')}</span><b>{n}</b>{cap > 0 && <i style={{ width: `${pct}%` }} />}</div>;
          })}
        </div>
        {!cap && <Field label="" hint="Atur kapasitas harian di Pengaturan › Toko untuk peringatan hari ramai (Valentine, wisuda)."><span /></Field>}
      </section>
      </>}
    </div>
  );
}

const HARI_PENDEK = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const juta = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt` : n >= 1e3 ? `${Math.round(n / 1e3)} rb` : String(n));

/** Batang satu seri (satu warna, tanpa legenda); nilai tampil saat disentuh/diarahkan. */
function Bars({ data, label }: { data: { key: string; label: string; value: number; sub?: string }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const [hover, setHover] = useState<number | null>(null);
  const h = hover !== null ? data[hover] : null;
  const every = Math.ceil(data.length / 12);
  return (
    <div>
      <div className="row muted small" style={{ minHeight: 22 }}>{h ? <span><b style={{ color: 'var(--ink)' }}>{h.label}</b> · {rp(h.value)}{h.sub ? ` · ${h.sub}` : ''}</span> : <span>{label}</span>}</div>
      <div className="bars" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => (
          <div key={d.key} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} title={`${d.label}: ${rp(d.value)}`}>
            <i style={{ height: `${(d.value / max) * 100}%`, background: hover === i ? 'var(--peony)' : undefined }} />
            <span>{i % every === 0 ? d.label : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HBars({ items }: { items: { label: string; n: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  const total = items.reduce((s, i) => s + i.n, 0);
  if (!items.length) return <div className="muted">Belum ada jawaban pada periode ini.</div>;
  return (
    <div>
      {items.map((i) => (
        <div key={i.label} className="hbar"><span>{i.label}</span><div className="track"><i style={{ width: `${(i.n / max) * 100}%` }} /></div><span className="right">{i.n} · {Math.round((i.n / total) * 100)}%</span></div>
      ))}
    </div>
  );
}

function Analisis({ orders, from, to, outletId }: { orders: Order[]; from: Date; to: Date; outletId?: string }) {
  const settings = useLiveQuery(() => db.settings.get('toko'));
  const qs = storeCfg(settings).engage.survey;
  const an = useMemo(() => buildAnalysis(orders, from, to, (iso) => dayKey(iso), qs, outletId), [orders, from.getTime(), to.getTime(), qs.map((q) => q.id + q.q).join('|'), outletId]);
  const answered = an.survey.filter((s) => s.total > 0);
  const days = an.daily.length;
  const series = days > 62
    ? Object.values(an.daily.reduce<Record<string, { key: string; label: string; value: number; n: number }>>((acc, d) => {
        const k = d.day.slice(0, 7);
        const m = acc[k] || (acc[k] = { key: k, label: `${BULAN_PENDEK[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}`, value: 0, n: 0 });
        m.value += d.sales; m.n += d.count;
        return acc;
      }, {})).map((m) => ({ key: m.key, label: m.label, value: m.value, sub: `${m.n} transaksi` }))
    : an.daily.map((d) => ({ key: d.day, label: `${Number(d.day.slice(8))}/${Number(d.day.slice(5, 7))}`, value: d.sales, sub: `${d.count} transaksi` }));
  return (
    <div className="page" data-testid="analisis">
      <div className="kpis">
        <div className="kpi"><span>Rata-rata per transaksi</span><b>{rp(an.avgBasket)}</b><i>{an.daily.reduce((s, d) => s + d.count, 0)} transaksi</i></div>
        <div className="kpi"><span>Pelanggan kembali</span><b>{an.repeatRate.toFixed(0)}%</b><i>dari {an.customersKnown} pelanggan bernama</i></div>
        <div className="kpi"><span>Pengantaran</span><b>{an.delivery.count}</b><i>ongkir {rp(an.delivery.fees)} · rata-rata {an.delivery.avgKm.toLocaleString('id-ID')} km</i></div>
        <div className="kpi"><span>Promo ulasan & poin</span><b>{an.review.count}</b><i>diskon ulasan {rp(an.review.discount)} · poin {rp(an.pointsDiscount)}</i></div>
      </div>
      <section className="card">
        <h3>Penjualan {days > 62 ? 'per bulan' : 'per hari'}</h3>
        <Bars data={series} label={`Arahkan atau sentuh batang untuk melihat nilai. Tertinggi ${juta(Math.max(0, ...series.map((x) => x.value)))}`} />
      </section>
      <div className="two">
        <section className="card">
          <h3>Per hari dalam seminggu</h3>
          <Bars data={an.weekday.map((w) => ({ key: String(w.day), label: HARI_PENDEK[w.day], value: w.sales, sub: `${w.count} transaksi` }))} label="Hari ramai untuk mengatur jadwal perangkai" />
        </section>
        <section className="card">
          <h3>Beban kerja perangkai</h3>
          {an.florists.map((f) => <div key={f.name} className="row"><span>{f.name}</span><span>{f.orders} pesanan · {f.items} item</span></div>)}
          {!an.florists.length && <div className="muted">Belum ada pesanan dengan perangkai yang ditunjuk.</div>}
        </section>
      </div>
      <h3 className="section-h">Survei pelanggan <span className="muted">· {answered.length} dari {an.survey.length} pertanyaan sudah terjawab pada periode ini</span></h3>
      <div className="two">
        {answered.map((s) => (
          <section key={s.id} className="card">
            <h3>{s.q} <span className="muted">· {num(s.total)} jawaban</span></h3>
            <HBars items={s.answers} />
          </section>
        ))}
      </div>
    </div>
  );
}
