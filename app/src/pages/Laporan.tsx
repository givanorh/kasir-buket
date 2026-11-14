import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { buildReport, scheduledQtyOn } from '../lib/calc';
import { addDays, dayKey, endOfDay, fmtDate, num, rp, startOfDay } from '../lib/format';
import { Field, Seg } from '../components/ui';

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
      <div className="toolbar wrap">
        <Seg value={preset} onChange={setPreset} options={[{ value: 'hari', label: 'Hari ini' }, { value: 'kemarin', label: 'Kemarin' }, { value: '7', label: '7 hari' }, { value: 'bulan', label: 'Bulan ini' }, { value: 'custom', label: 'Pilih' }]} />
        {preset === 'custom' && <><input type="date" value={a} onChange={(e) => setA(e.target.value)} /><input type="date" value={b} onChange={(e) => setB(e.target.value)} /></>}
        {outlets.length > 1 && <select value={outlet} onChange={(e) => setOutlet(e.target.value)}><option value="">Semua cabang</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
        <button className="btn" onClick={exportCsv}>Ekspor CSV</button>
      </div>
      <p className="muted">{fmtDate(from.toISOString())} s.d. {fmtDate(to.toISOString())}{r.voided ? ` · ${r.voided} transaksi batal tidak dihitung` : ''}</p>

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
          <h3>Rekonsiliasi</h3>
          <div className="row"><span>Sudah dibayar (transaksi periode ini)</span><b>{rp(r.paidForPeriodOrders)}</b></div>
          <div className="row"><span>+ Sisa tagihan (DP/belum bayar)</span><b>{rp(r.outstandingForPeriodOrders)}</b></div>
          <div className={`row strong ${recon === r.netSales ? 'ok' : 'red'}`}><span>= Penjualan bersih {recon === r.netSales ? '✓ cocok' : '✗ selisih'}</span><b>{rp(recon)}</b></div>
          <div className="row"><span>Total piutang semua periode</span><b>{rp(piutangAll)}</b></div>
        </section>
        <section className="card">
          <h3>Kas masuk per metode (basis tanggal bayar)</h3>
          {r.cashIn.map((m) => <div key={m.method} className="row"><span>{m.method} ({m.count}×)</span><b>{rp(m.amount)}</b></div>)}
          <div className="row strong"><span>Jumlah</span><b>{rp(r.cashInTotal)}</b></div>
          <p className="muted small">Kas masuk menghitung DP dan pelunasan pada tanggal uang diterima, sehingga bisa berbeda dari penjualan bersih.</p>
          <h3>Per kasir</h3>
          {r.byCashier.map((c) => <div key={c.name} className="row"><span>{c.name} ({c.count} trx)</span><b>{rp(c.sales)}</b></div>)}
          <h3>Per jam</h3>
          <div className="hours">{r.byHour.map((h) => <div key={h.hour} title={`${h.count} trx · ${rp(h.sales)}`}><i style={{ height: `${Math.max(6, (h.count / Math.max(...r.byHour.map((x) => x.count))) * 60)}px` }} /><span>{h.hour}</span></div>)}</div>
        </section>
      </div>

      <section className="card">
        <h3>Per produk</h3>
        <div className="table">
          <div className="thead"><div className="grow">Produk</div><div className="right">Qty</div><div className="right">Penjualan</div><div className="right hide-sm">HPP</div><div className="right">Laba</div></div>
          {r.byProduct.slice(0, 50).map((p) => (
            <div key={p.name} className="trow"><div className="grow">{p.name}</div><div className="right">{p.qty}</div><div className="right">{rp(p.sales)}</div><div className="right hide-sm">{rp(p.cogs)}</div><div className="right">{rp(p.profit)}</div></div>
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
    </div>
  );
}
