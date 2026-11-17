// Dua laci kas (v1.9):
//  - Laci kasir: modal kembalian (bawaan 1.000.000) + penjualan tunai. Tidak untuk biaya; direkap saat tutup shift.
//  - Laci meja kamar (kas kecil, bawaan 500.000): satu-satunya sumber kas keluar/masuk (uang sampah, sumbangan,
//    pembelian darurat). Saldonya berjalan terus, tidak ikut shift.
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { pettySummary, shiftSummary } from '../lib/calc';
import { fmtShort, rp } from '../lib/format';
import { activeShift, addCashMove, getDeviceConfig, openShift, save } from '../lib/store';
import { useSession } from '../lib/session';
import { PETTY_CATEGORIES, PETTY_TOPUP, storeCfg } from '../lib/settings';
import { Empty, Field, Modal, MoneyInput, Seg, toast } from '../components/ui';
import type { Settings, Shift } from '../lib/types';

export default function ShiftPage() {
  const shift = useLiveQuery(() => activeShift(), []);
  const payments = useLiveQuery(() => db.payments.toArray(), []) || [];
  const moves = useLiveQuery(() => db.cash_moves.toArray(), []) || [];
  const history = useLiveQuery(() => db.shifts.orderBy('opened_at').reverse().limit(30).toArray(), []) || [];
  const settings = useLiveQuery(() => db.settings.get('toko'));
  const cfg = storeCfg(settings);
  const [opening, setOpening] = useState<number | null>(null);
  const [actual, setActual] = useState(0);
  const [note, setNote] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  async function open() {
    await openShift(opening ?? cfg.drawerFloat);
    setOpening(null);
    toast('Shift dibuka');
  }
  async function close(sh: Shift) {
    const sum = shiftSummary(sh, payments, moves);
    await save<Shift>('shifts', sh.id, { closed_at: new Date().toISOString(), expected_cash: sum.expected, actual_cash: actual, note });
    toast(`Shift ditutup. Selisih ${rp(actual - sum.expected)}`);
    setActual(0); setNote(''); setConfirmClose(false);
  }

  const sum = shift ? shiftSummary(shift, payments, moves) : null;
  const diff = sum ? actual - sum.expected : 0;
  return (
    <div className="page">
      <div className="two">
        {!shift ? (
          <section className="card">
            <h3>Buka shift · laci kasir</h3>
            <Field label="Kas awal di laci kasir" hint={`Modal kembalian, biasanya ${rp(cfg.drawerFloat)}`}><MoneyInput value={opening ?? cfg.drawerFloat} onChange={setOpening} ariaLabel="Kas awal" /></Field>
            <button className="btn primary big" onClick={open} data-testid="btn-buka-shift">Buka shift</button>
          </section>
        ) : (
          <section className="card" data-testid="shift-aktif">
            <h3>Shift aktif · {shift.user_name} · sejak {fmtShort(shift.opened_at)}</h3>
            <p className="muted small">Laci kasir hanya untuk kembalian pelanggan. Kas keluar untuk biaya diambil dari laci meja kamar.</p>
            <div className="row"><span>Kas awal (modal kembalian)</span><b>{rp(sum!.opening)}</b></div>
            <div className="row"><span>+ Penjualan tunai</span><b>{rp(sum!.cashSales)}</b></div>
            {sum!.cashIn > 0 && <div className="row muted"><span>+ Kas masuk tunai (catatan lama)</span><b>{rp(sum!.cashIn)}</b></div>}
            {sum!.cashOut > 0 && <div className="row muted"><span>− Kas keluar tunai (catatan lama)</span><b>{rp(sum!.cashOut)}</b></div>}
            <div className="row strong"><span>= Kas seharusnya di laci kasir</span><b data-testid="expected">{rp(sum!.expected)}</b></div>
            {sum!.nonCash.map((n) => <div key={n.method} className="row muted"><span>Non-tunai {n.method}</span><span>{rp(n.amount)}</span></div>)}
            <h3>Tutup shift</h3>
            <Field label="Kas aktual di laci kasir (hasil hitung)" hint={actual ? `Selisih ${rp(diff)}` : undefined}><MoneyInput value={actual} onChange={setActual} ariaLabel="Kas aktual" /></Field>
            <Field label="Catatan"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <button className="btn danger" onClick={() => setConfirmClose(true)} data-testid="btn-tutup-shift">Tutup shift</button>
          </section>
        )}
        <PettyCash settings={settings} />
      </div>
      {confirmClose && shift && sum && (
        <Modal title="Tutup shift sekarang?" onClose={() => setConfirmClose(false)}
          footer={<>
            <button className="btn grow" onClick={() => setConfirmClose(false)}>Batal</button>
            <button className="btn danger grow" onClick={() => close(shift)} data-testid="konfirmasi-tutup-shift">Ya, tutup shift</button>
          </>}>
          <div className="stack" data-testid="ringkasan-tutup-shift">
            <p>Shift {shift.user_name} sejak {fmtShort(shift.opened_at)} akan ditutup. Setelah ditutup, Admin perlu membuka shift baru untuk berjualan.</p>
            <div className="sum">
              <div className="row"><span>Kas seharusnya di laci kasir</span><b>{rp(sum.expected)}</b></div>
              <div className="row"><span>Kas aktual (hasil hitung)</span><b>{rp(actual)}</b></div>
              <div className="row total"><span>Selisih</span><span className={diff ? 'red' : 'ok'}>{diff > 0 ? '+' : ''}{rp(diff)}</span></div>
            </div>
            {!actual && <div className="note warn">Kas aktual belum diisi (Rp 0). Hitung uang di laci kasir dulu bila ingin selisihnya akurat.</div>}
          </div>
        </Modal>
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

/** Laci meja kamar (kas kecil): saldo berjalan, kas keluar/masuk, isi ulang ke jumlah tetap, hitung ulang (owner). */
function PettyCash({ settings }: { settings?: Settings }) {
  const s = useSession();
  const owner = s.user?.role === 'owner';
  const outletId = useLiveQuery(async () => (await getDeviceConfig()).outletId, []) || 'outlet-utama';
  const moves = useLiveQuery(() => db.cash_moves.toArray(), []) || [];
  const cfg = storeCfg(settings);
  const anchor = settings?.petty?.anchors?.[outletId] || null;
  const ps = pettySummary(moves, outletId, cfg.pettyTarget, anchor);
  const cats = [...new Set([...PETTY_CATEGORIES, ...(settings?.expense_categories || []).filter((c) => c.biaya).map((c) => c.name)])];
  const [mv, setMv] = useState({ type: 'keluar' as 'masuk' | 'keluar', category: PETTY_CATEGORIES[0], amount: 0, note: '' });
  const [count, setCount] = useState<number | null>(null);
  const over = mv.type === 'keluar' && mv.amount > ps.balance;

  async function addMove() {
    if (over) return;
    const cat = mv.type === 'masuk' ? (mv.category || PETTY_TOPUP) : (mv.category || PETTY_CATEGORIES[0]);
    const biaya = mv.type === 'keluar' && (settings?.expense_categories?.find((c) => c.name === cat)?.biaya ?? true);
    await addCashMove({ type: mv.type, category: cat, biaya, method: 'Tunai', amount: mv.amount, note: mv.note.trim() });
    toast(`${mv.type === 'keluar' ? 'Kas keluar' : 'Kas masuk'} ${rp(mv.amount)} dicatat. Saldo laci meja kamar ${rp(ps.balance + (mv.type === 'keluar' ? -mv.amount : mv.amount))}`);
    setMv({ ...mv, amount: 0, note: '' });
  }
  async function topUp() {
    if (!ps.shortfall) return;
    await addCashMove({ type: 'masuk', category: PETTY_TOPUP, biaya: false, method: 'Tunai', amount: ps.shortfall, note: `Isi ulang ke ${rp(ps.target)}` });
    toast(`Isi ulang ${rp(ps.shortfall)} dicatat. Saldo kembali ${rp(ps.target)}`);
  }
  async function setCounted() {
    if (count === null) return;
    const anchors = { ...(settings?.petty?.anchors || {}), [outletId]: { opening: count, at: new Date().toISOString(), by: s.user?.name } };
    await save<Settings>('settings', 'toko', { petty: { ...(settings?.petty || {}), anchors } });
    toast(`Saldo laci meja kamar disetel ${rp(count)} (selisih ${rp(count - ps.balance)} dari catatan)`);
    setCount(null);
  }

  return (
    <section className="card" data-testid="kas-kecil">
      <h3>Laci meja kamar (kas kecil)</h3>
      <div className="petty">
        <div><span className="muted small">Saldo seharusnya</span><b data-testid="saldo-kas-kecil">{rp(ps.balance)}</b></div>
        <div className="petty-bar" aria-hidden="true"><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, ps.balance / ps.target))})` }} /></div>
        <div className="muted small">Jumlah tetap {rp(ps.target)}{ps.shortfall ? ` · kurang ${rp(ps.shortfall)}` : ''}{anchor ? ` · dihitung ${anchor.by || 'owner'} ${fmtShort(anchor.at)}` : ''}</div>
      </div>
      {ps.shortfall > 0 && <button className="btn" onClick={topUp} data-testid="isi-ulang">Isi ulang {rp(ps.shortfall)} ke {rp(ps.target)}</button>}
      <p className="muted small">Untuk uang sampah, sumbangan, atau pembelian darurat. Uang di laci kasir hanya untuk kembalian pelanggan.</p>
      <Seg value={mv.type} onChange={(type) => setMv({ ...mv, type, category: type === 'masuk' ? PETTY_TOPUP : PETTY_CATEGORIES[0] })} options={[{ value: 'keluar', label: 'Keluar (biaya)' }, { value: 'masuk', label: 'Masuk' }]} />
      {mv.type === 'keluar' ? (
        <Field label="Kategori"><select value={mv.category} onChange={(e) => setMv({ ...mv, category: e.target.value })} aria-label="Kategori kas kecil">{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
      ) : (
        <Field label="Asal uang"><select value={mv.category} onChange={(e) => setMv({ ...mv, category: e.target.value })} aria-label="Asal kas masuk"><option value={PETTY_TOPUP}>{PETTY_TOPUP} (dari owner)</option><option value="Pengembalian sisa belanja">Pengembalian sisa belanja</option></select></Field>
      )}
      <Field label="Nominal" hint={over ? <span className="red">Melebihi saldo laci meja kamar ({rp(ps.balance)}). Isi ulang dulu.</span> : undefined}><MoneyInput value={mv.amount} onChange={(amount) => setMv({ ...mv, amount })} ariaLabel="Nominal kas kecil" /></Field>
      <Field label="Keterangan"><input value={mv.note} onChange={(e) => setMv({ ...mv, note: e.target.value })} placeholder={mv.type === 'keluar' ? 'mis. iuran sampah November' : ''} /></Field>
      <button className="btn primary" disabled={!mv.amount || over} onClick={addMove} data-testid="catat-kas-kecil">Catat</button>
      {owner && (
        <details className="petty-count">
          <summary>Hitung ulang saldo (owner)</summary>
          <Field label="Uang di laci meja kamar saat ini" hint="Saldo dihitung ulang mulai sekarang; catatan sebelumnya tetap tersimpan."><MoneyInput value={count ?? ps.balance} onChange={setCount} ariaLabel="Saldo hasil hitung" /></Field>
          <button className="btn small" disabled={count === null} onClick={setCounted}>Simpan saldo hasil hitung</button>
        </details>
      )}
      <h3>Riwayat laci meja kamar</h3>
      {ps.moves.slice(0, 20).map((m) => (
        <div key={m.id} className="row small" data-testid="kas-kecil-row"><span>{fmtShort(m.created_at)} · {m.category}{m.note ? ` · ${m.note}` : ''}{m.user_name ? ` · ${m.user_name}` : ''}</span><b className={m.type === 'keluar' ? 'red' : 'ok'}>{m.type === 'keluar' ? '−' : '+'}{rp(m.amount)}</b></div>
      ))}
      {!ps.moves.length && <p className="muted small">Belum ada catatan{anchor ? ' sejak saldo dihitung' : ''}.</p>}
    </section>
  );
}
