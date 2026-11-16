import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { shiftSummary } from '../lib/calc';
import { fmtShort, rp } from '../lib/format';
import { activeShift, addCashMove, openShift, save } from '../lib/store';
import { Empty, Field, MoneyInput, Seg, toast } from '../components/ui';
import type { Shift } from '../lib/types';

export default function ShiftPage() {
  const shift = useLiveQuery(() => activeShift(), []);
  const payments = useLiveQuery(() => db.payments.toArray(), []) || [];
  const moves = useLiveQuery(() => db.cash_moves.toArray(), []) || [];
  const history = useLiveQuery(() => db.shifts.orderBy('opened_at').reverse().limit(30).toArray(), []) || [];
  const settings = useLiveQuery(() => db.settings.get('toko'));
  const [opening, setOpening] = useState(0);
  const [actual, setActual] = useState(0);
  const [note, setNote] = useState('');
  const [mv, setMv] = useState({ type: 'keluar' as 'masuk' | 'keluar', category: '', amount: 0, method: 'Tunai', note: '' });
  const cats = settings?.expense_categories || [];

  async function open() {
    await openShift(opening);
    toast('Shift dibuka');
  }
  async function close(sh: Shift) {
    const sum = shiftSummary(sh, payments, moves);
    await save<Shift>('shifts', sh.id, { closed_at: new Date().toISOString(), expected_cash: sum.expected, actual_cash: actual, note });
    toast(`Shift ditutup. Selisih ${rp(actual - sum.expected)}`);
    setActual(0); setNote('');
  }
  async function addMove() {
    const cat = mv.type === 'masuk' ? (mv.category || 'Tambahan kas') : (mv.category || cats[0]?.name || 'Biaya operasional');
    const biaya = mv.type === 'keluar' && (cats.find((c) => c.name === cat)?.biaya ?? true);
    await addCashMove({ type: mv.type, category: cat, biaya, method: mv.method, amount: mv.amount, note: mv.note });
    toast('Kas dicatat');
    setMv({ ...mv, amount: 0, note: '' });
  }

  const sum = shift ? shiftSummary(shift, payments, moves) : null;
  return (
    <div className="page">
      {!shift ? (
        <section className="card narrow">
          <h3>Buka shift</h3>
          <Field label="Kas awal di laci"><MoneyInput value={opening} onChange={setOpening} /></Field>
          <button className="btn primary big" onClick={open} data-testid="btn-buka-shift">Buka shift</button>
        </section>
      ) : (
        <div className="two">
          <section className="card">
            <h3>Shift aktif · {shift.user_name} · sejak {fmtShort(shift.opened_at)}</h3>
            <div className="row"><span>Kas awal</span><b>{rp(sum!.opening)}</b></div>
            <div className="row"><span>+ Penjualan tunai</span><b>{rp(sum!.cashSales)}</b></div>
            <div className="row"><span>+ Kas masuk tunai</span><b>{rp(sum!.cashIn)}</b></div>
            <div className="row"><span>− Kas keluar tunai</span><b>{rp(sum!.cashOut)}</b></div>
            <div className="row strong"><span>= Kas seharusnya di laci</span><b data-testid="expected">{rp(sum!.expected)}</b></div>
            {sum!.nonCash.map((n) => <div key={n.method} className="row muted"><span>Non-tunai {n.method}</span><span>{rp(n.amount)}</span></div>)}
            <h3>Tutup shift</h3>
            <Field label="Kas aktual (hasil hitung)" hint={actual ? `Selisih ${rp(actual - sum!.expected)}` : undefined}><MoneyInput value={actual} onChange={setActual} /></Field>
            <Field label="Catatan"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <button className="btn danger" onClick={() => close(shift)}>Tutup shift</button>
          </section>
          <section className="card">
            <h3>Kas masuk / keluar</h3>
            <Seg value={mv.type} onChange={(type) => setMv({ ...mv, type, category: '' })} options={[{ value: 'keluar', label: 'Keluar (biaya)' }, { value: 'masuk', label: 'Masuk' }]} />
            {mv.type === 'keluar' && (
              <Field label="Kategori"><select value={mv.category} onChange={(e) => setMv({ ...mv, category: e.target.value })}>{cats.map((c) => <option key={c.name} value={c.name}>{c.name}{c.biaya ? '' : ' (bukan beban)'}</option>)}</select></Field>
            )}
            <div className="cols">
              <Field label="Nominal"><MoneyInput value={mv.amount} onChange={(amount) => setMv({ ...mv, amount })} /></Field>
              <Field label="Dari/ke"><select value={mv.method} onChange={(e) => setMv({ ...mv, method: e.target.value })}><option>Tunai</option><option>Transfer</option></select></Field>
            </div>
            <Field label="Keterangan"><input value={mv.note} onChange={(e) => setMv({ ...mv, note: e.target.value })} /></Field>
            <button className="btn primary" disabled={!mv.amount} onClick={addMove}>Catat</button>
            <h3>Riwayat kas shift ini</h3>
            {moves.filter((m) => m.shift_id === shift.id && !m.deleted).map((m) => (
              <div key={m.id} className="row"><span>{fmtShort(m.created_at)} · {m.category} {m.note && `· ${m.note}`}</span><b className={m.type === 'keluar' ? 'red' : ''}>{m.type === 'keluar' ? '−' : '+'}{rp(m.amount)}</b></div>
            ))}
          </section>
        </div>
      )}
      <section className="card">
        <h3>Riwayat shift</h3>
        <div className="table" style={{ ['--cols' as string]: 'minmax(0,1fr) auto auto auto', ['--cols-sm' as string]: 'minmax(0,1fr) auto' }}>
          {history.filter((h) => h.closed_at).map((h) => (
            <div key={h.id} className="trow">
              <div className="grow"><b>{h.user_name}</b><div className="muted">{fmtShort(h.opened_at)} – {fmtShort(h.closed_at)}</div></div>
              <div className="right hide-sm">Seharusnya {rp(h.expected_cash)}</div>
              <div className="right hide-sm">Aktual {rp(h.actual_cash)}</div>
              <div className={`right ${(h.actual_cash || 0) - (h.expected_cash || 0) ? 'red' : ''}`}>Selisih {rp((h.actual_cash || 0) - (h.expected_cash || 0))}</div>
            </div>
          ))}
          {!history.some((h) => h.closed_at) && <Empty>Belum ada shift yang ditutup.</Empty>}
        </div>
      </section>
    </div>
  );
}
