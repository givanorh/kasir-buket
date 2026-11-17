import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { useSyncStatus } from '../lib/sync';
import { api } from '../lib/session';
import { saveMany, save, newId } from '../lib/store';
import { rp } from '../lib/format';
import { DEFAULT_EVENTS_2026, KIND_LABEL, KIND_LIST, migrateMusim, omzetRank, baselineAround, covers, dailySales, eventStat, localDay, occurrences, shiftDay, spikeDays, suggestRecurring, type Daily, type EventStat } from '../lib/events';
import { Badge, Empty, Field, Modal, Seg, toast } from '../components/ui';
import { Icon } from '../components/icons';
import type { CalEvent, EventKind } from '../lib/types';

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const TONE: Record<EventKind, 'gray' | 'rose' | 'amber' | 'blue' | 'green' | 'red'> = { libur: 'gray', momen: 'rose', musim: 'amber', lokal: 'blue', data: 'red', toko: 'green' };
const jt = (n: number) => (n >= 1e6 ? `Rp ${(n / 1e6).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} jt` : rp(n));
const x1 = (r: number) => `${r.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`;
const dShort = (k: string) => { const d = new Date(k + 'T12:00:00'); return `${HARI[d.getDay()]}, ${d.getDate()} ${BLN[d.getMonth()]}`; };
const range = (e: Pick<CalEvent, 'date' | 'end'>) => (e.end && e.end !== e.date ? `${dShort(e.date)} – ${dShort(e.end)}` : dShort(e.date));
const minusYear = (k?: string) => (k ? `${Number(k.slice(0, 4)) - 1}${k.slice(4)}` : k);
// skala berurutan satu warna (plum), terang → gelap
const STEPS = [{ max: 0.75, c: '#f3ebf1', l: '< 0,75×' }, { max: 1.25, c: '#e3cfde', l: '0,75–1,25×' }, { max: 2, c: '#c39bb9', l: '1,25–2×' }, { max: 4, c: '#8f5585', l: '2–4×' }, { max: Infinity, c: '#4a2545', l: '≥ 4×' }];
const colorOf = (r: number) => STEPS.find((s) => r < s.max)!.c;

function statText(s: EventStat) {
  if (!s.covered) return '';
  if (s.avgRatio !== undefined) return `${jt(s.sales)} · ${s.count} trx · rata-rata ${jt(s.sales / s.days)}/hari (${x1(s.avgRatio)} 28 hari sebelumnya)`;
  return `${jt(s.sales)} · ${s.count} trx${s.peak ? ` · puncak ${dShort(s.peak.day)} ${jt(s.peak.sales)} (${x1(s.peak.ratio)})` : ''}`;
}

/** Kalender event (owner): event bawaan 2026, dapat diubah; setiap event disandingkan dengan omzet harian toko. */
export default function Kalender() {
  const events = useLiveQuery(() => db.events.toArray(), []);
  const orders = useLiveQuery(() => db.orders.toArray(), []) || [];
  const st = useSyncStatus();
  const [year, setYear] = useState(new Date().getFullYear());
  const [kind, setKind] = useState<EventKind | ''>('');
  const [sort, setSort] = useState<'tanggal' | 'omzet'>('tanggal');
  // arah urutan: tanggal bawaan naik (Jan → Des), omzet bawaan turun (terbesar dulu)
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const pickSort = (v: 'tanggal' | 'omzet') => { setSort(v); setDir(v === 'tanggal' ? 'asc' : 'desc'); };
  const [edit, setEdit] = useState<Partial<CalEvent> | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [gcal, setGcal] = useState(false);
  const [gcalOn, setGcalOn] = useState<boolean | null>(null);
  useEffect(() => { api<CalSync>('/api/calsync').then((c) => setGcalOn(c.enabled)).catch(() => setGcalOn(null)); }, [gcal]);
  const dl = useMemo(() => dailySales(orders), [orders]);

  // isi event bawaan 2026 sekali, setelah sinkron selesai (agar tidak menimpa event yang sudah ada di server)
  useEffect(() => {
    if (!events || !st.lastSync || st.syncing || st.pending) return;
    const have = new Set(events.map((e) => e.id));
    const missing = DEFAULT_EVENTS_2026.filter((e) => !have.has(e.id));
    if (missing.length === DEFAULT_EVENTS_2026.length) saveMany(missing.map(({ id, ...p }) => ({ c: 'events' as const, id, patch: p })));
    // v1.6: kategori Musim dihapus (Ramadan dihapus, sisanya menjadi Puncak Penjualan)
    const mig = migrateMusim(events);
    if (mig.length) saveMany(mig.map((m) => ({ c: 'events' as const, id: m.id, patch: m.patch })));
  }, [events, st.lastSync, st.syncing, st.pending]); // eslint-disable-line

  if (!events) return null;
  const live = events.filter((e) => !e.deleted);
  const ofYear = occurrences(live, year);
  const baseOf = (id: string) => live.find((x) => x.id === id)!;
  const kindOf = (k: EventKind): EventKind => (k === 'musim' ? 'momen' : k);
  const shown = ofYear.filter((e) => !kind || kindOf(e.kind) === kind);
  const countOf = (k: EventKind) => ofYear.filter((e) => kindOf(e.kind) === k && e.date.startsWith(String(year))).length;
  const ranked = sort === 'omzet' ? omzetRank(shown.filter((e) => e.date.startsWith(String(year))), dl).map((x, i) => ({ ...x, rank: i + 1 })) : [];
  const rankedView = dir === 'desc' ? ranked : [...ranked].reverse();
  const months = BULAN.map((m, i) => ({ m, i }));
  const monthsView = dir === 'asc' ? months : [...months].reverse();
  const byDate = (a: { date: string }, b: { date: string }) => (dir === 'asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
  const maxRank = Math.max(1, ...ranked.map((x) => x.sales));
  const today = localDay(new Date());
  const thisYear = Number(today.slice(0, 4));
  const soon = [...occurrences(live, thisYear), ...occurrences(live, thisYear + 1)]
    .filter((e) => (e.end || e.date) >= today && e.date <= shiftDay(today, 45))
    .filter((e, i, a) => a.findIndex((x) => x.baseId === e.baseId && x.date === e.date) === i)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
  const spikes = spikeDays(dl, year).filter((s) => !ofYear.some((e) => covers(e, s.day, 1)));
  const missingDefaults = DEFAULT_EVENTS_2026.filter((d) => !events.some((e) => e.id === d.id));
  const years = [...new Set([new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1, ...live.map((e) => Number(e.date.slice(0, 4)))])].sort();

  async function copyNextYear() {
    const fixed = ofYear.filter((e) => !e.recurring && (e.kind === 'momen' || e.kind === 'lokal' || e.kind === 'toko'));
    const ny = (k?: string) => (k ? `${Number(k.slice(0, 4)) + 1}${k.slice(4)}` : undefined);
    const exists = new Set(live.filter((e) => e.date.startsWith(String(year + 1))).map((e) => e.name));
    const add = fixed.filter((e) => !exists.has(e.name));
    await saveMany(add.map((e) => ({ c: 'events' as const, id: newId('ev'), patch: { date: ny(e.date)!, end: ny(e.end), name: e.name, kind: e.kind, note: `Disalin dari ${year}. Cek ulang tanggal bila jatuh di hari libur.` } })));
    toast(`${add.length} event tanggal tetap disalin ke ${year + 1}. Libur keagamaan ${year + 1} perlu diisi dari SKB terbaru.`);
  }

  return (
    <div className="page" data-testid="kalender">
      <div className="toolbar">
        <Seg value={String(year)} onChange={(v) => setYear(Number(v))} options={years.map((y) => ({ value: String(y), label: String(y) }))} />
        <Field group label="Urutkan"><Seg value={sort} onChange={pickSort} options={[{ value: 'tanggal', label: 'Tanggal' }, { value: 'omzet', label: 'Total omzet' }]} /></Field>
        <Field group label="Arah"><Seg value={dir} onChange={setDir} options={sort === 'tanggal'
          ? [{ value: 'asc', label: '↑ Jan → Des' }, { value: 'desc', label: '↓ Des → Jan' }]
          : [{ value: 'desc', label: '↓ Terbesar dulu' }, { value: 'asc', label: '↑ Terkecil dulu' }]} /></Field>
        <span className="grow" />
        {missingDefaults.length > 0 && missingDefaults.length < DEFAULT_EVENTS_2026.length && <button className="btn ghost" onClick={() => saveMany(missingDefaults.map(({ id, ...p }) => ({ c: 'events' as const, id, patch: p })))}>Pulihkan {missingDefaults.length} event bawaan</button>}
        {missingDefaults.length === DEFAULT_EVENTS_2026.length && <button className="btn" onClick={() => saveMany(missingDefaults.map(({ id, ...p }) => ({ c: 'events' as const, id, patch: p })))} data-testid="isi-2026">Isi event 2026</button>}
        <button className="btn ghost" onClick={copyNextYear}>Salin ke {year + 1}</button>
        <button className={`btn gcal-btn ${gcalOn ? 'on' : ''}`} onClick={() => setGcal(true)} data-testid="gcal-buka"><i />Google Calendar{gcalOn ? ' · aktif' : ''}</button>
        <button className="btn primary" onClick={() => setEdit({ date: `${year}-01-01`, kind: 'toko', name: '' })} data-testid="event-baru"><Icon name="plus" size={18} />Event</button>
      </div>

      <div className="kfilter" role="group" aria-label="Filter kategori event" data-testid="filter-kategori">
        <span className="muted small">Kategori</span>
        <button className={!kind ? 'on' : ''} onClick={() => setKind('')}>Semua <em>{ofYear.filter((e) => e.date.startsWith(String(year))).length}</em></button>
        {KIND_LIST.map((k) => <button key={k} className={`${kind === k ? 'on' : ''} k-${k}`} onClick={() => setKind(kind === k ? '' : k)}><i />{KIND_LABEL[k]} <em>{countOf(k)}</em></button>)}
      </div>

      {soon.length > 0 && (
        <div className="soon">
          {soon.map((e) => {
            const days = Math.round((new Date(e.date + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86400e3);
            const last = e.kind === 'momen' || e.kind === 'lokal' ? eventStat({ date: minusYear(e.date)!, end: minusYear(e.end) }, dl) : null;
            return (
              <button key={e.baseId + e.date} className="soon-card" onClick={() => setEdit(baseOf(e.baseId))}>
                <span className="soon-when">{days > 0 ? `${days} hari lagi` : days === 0 ? 'Hari ini' : 'Sedang berlangsung'}</span>
                <b>{e.name}</b>
                <span className="muted">{range(e)}</span>
                {last?.covered && last.peak ? <span className="soon-stat">Tahun lalu puncak {dShort(last.peak.day)}: {jt(last.peak.sales)} ({x1(last.peak.ratio)})</span> : e.note ? <span className="soon-stat">{e.note.split('. ')[0].replace(/\.?$/, '.')}</span> : null}
              </button>
            );
          })}
        </div>
      )}

      <section className="card">
        <h3>Omzet harian {year} dibanding median sekitarnya</h3>
        <Heatmap year={year} dl={dl} events={ofYear} />
      </section>

      {spikes.length > 0 && (
        <section className="card" data-testid="spikes">
          <h3>Lonjakan omzet tanpa event ({spikes.length})</h3>
          <p className="muted small">Hari dengan omzet ≥ 2,5× median ±14 hari dan belum dikaitkan ke event mana pun. Tandai agar tahun depan bisa disiapkan.</p>
          <div className="spk">
            {spikes.map((s) => (
              <div key={s.day} className="spk-row">
                <span><b>{dShort(s.day)}</b> <span className="muted">{s.day.slice(0, 4)}</span></span>
                <span>{jt(s.sales)} · {s.count} trx · <b>{x1(s.ratio)}</b></span>
                <button className="btn small" onClick={() => { const sg = suggestRecurring({ date: s.day, name: '' }); setEdit({ date: s.day, kind: sg.day ? 'momen' : 'data', recurring: !!sg.day, name: sg.name, note: `Omzet ${jt(s.sales)}, ${s.count} transaksi, ${x1(s.ratio)} median sekitarnya.` }); }}>Jadikan event</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {sort === 'omzet' && (
        <section className="card" data-testid="urut-omzet">
          <h3>Event {year} menurut total omzet{kind ? ` · ${KIND_LABEL[kind]}` : ''} · {dir === 'desc' ? 'terbesar dulu' : 'terkecil dulu'}</h3>
          <p className="muted small">Total omzet selama rentang event. Event yang belum terjadi memakai omzet tanggal yang sama tahun lalu.</p>
          {rankedView.map((x) => (
            <div key={x.e.baseId + x.e.date} className="ev rank" data-testid="rank-row">
              <div className="rank-no">{x.rank}</div>
              <div className="ev-main">
                <div><b>{x.e.name}</b> <Badge tone={TONE[x.e.kind]}>{KIND_LABEL[x.e.kind]}</Badge> <span className="muted small">{range(x.e)}</span></div>
                <div className="rank-bar"><i style={{ width: `${(x.sales / maxRank) * 100}%` }} /></div>
              </div>
              <div className="rank-val"><b>{x.sales ? jt(x.sales) : '–'}</b><span className="muted small">{x.sales ? `${x.count} trx${x.lastYear ? ' · tahun lalu' : ''}` : 'belum ada data'}</span></div>
            </div>
          ))}
          {!ranked.length && <Empty>Tidak ada event pada kategori ini.</Empty>}
        </section>
      )}

      {sort === 'tanggal' && monthsView.map(({ m, i }) => {
        const xs = shown.filter((e) => Number(e.date.slice(5, 7)) === i + 1 && e.date.startsWith(String(year))).sort(byDate);
        if (!xs.length) return null;
        return (
          <section key={m} className="card month">
            <h3>{m} {year}</h3>
            {xs.map((e) => {
              const s = eventStat(e, dl);
              const last = !s.covered && (e.kind === 'momen' || e.kind === 'lokal') ? eventStat({ date: minusYear(e.date)!, end: minusYear(e.end) }, dl) : null;
              return (
                <div key={e.baseId + e.date} className="ev" data-testid="event-row">
                  <div className="ev-date">{range(e)}</div>
                  <div className="ev-main">
                    <div><b>{e.name}</b> <Badge tone={TONE[e.kind]}>{KIND_LABEL[e.kind]}</Badge>{e.recurring && <span className="rutin" title="Berulang setiap tahun"><Icon name="repeat" size={14} />rutin</span>}</div>
                    {s.covered ? <div className="ev-stat">{statText(s)}</div> : last?.covered ? <div className="ev-stat muted">Tahun lalu: {statText(last)}</div> : null}
                    {e.note && <div className="muted small">{e.note}</div>}
                  </div>
                  <div className="ev-act">
                    {e.kind === 'data' && <button className="btn small" data-testid="jadikan-rutin" onClick={() => {
                      const b = baseOf(e.baseId); const sg = suggestRecurring(b);
                      const data = (b.note || '').replace(/(Kemungkinan|Ganti nama|Cek apakah|Tidak terjadi)[^.]*\.\s*/g, '').trim();
                      setEdit({ ...b, name: sg.name, kind: 'momen', recurring: true, note: `${sg.day ? `${sg.name.replace(/ \(.*/, '')} diperingati setiap ${Number(sg.day.slice(8))} ${BLN[Number(sg.day.slice(5, 7)) - 1]}. ` : ''}${data}`.trim() });
                      setFormTitle('Jadikan event rutin');
                    }}><Icon name="repeat" size={16} />Jadikan event rutin</button>}
                    <button className="icon-btn" onClick={() => setEdit(baseOf(e.baseId))} aria-label={`Ubah ${e.name}`}><Icon name="pengaturan" size={18} /></button>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
      {!shown.length && <Empty>Belum ada event untuk {year}.</Empty>}
      {edit && <EventForm e={edit} title={formTitle} onClose={() => { setEdit(null); setFormTitle(''); }} />}
      {gcal && <CalSyncModal onClose={() => setGcal(false)} />}
    </div>
  );
}

/** Peta panas 12 bulan × 31 hari: warna = omzet ÷ median ±14 hari; garis peony = hari event. */
function Heatmap({ year, dl, events }: { year: number; dl: Daily; events: CalEvent[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const cells = useMemo(() => {
    const out: Record<string, { sales: number; count: number; ratio: number } | null> = {};
    for (let m = 0; m < 12; m++) for (let d = 1; d <= 31; d++) {
      const dt = new Date(year, m, d);
      if (dt.getMonth() !== m) continue;
      const k = localDay(dt);
      if (!dl.first || k < dl.first || k > dl.last) { out[k] = null; continue; }
      const v = dl.days.get(k) || { sales: 0, count: 0 };
      const b = baselineAround(dl, k);
      out[k] = { ...v, ratio: b ? v.sales / b : 0 };
    }
    return out;
  }, [year, dl]);
  const evOf = (k: string) => events.find((e) => covers(e, k));
  const h = hover ? cells[hover] : null;
  const he = hover ? evOf(hover) : null;
  return (
    <div className="hm-wrap">
      <div className="hm-info muted small" aria-live="polite">
        {hover ? <span><b style={{ color: 'var(--ink)' }}>{dShort(hover)} {year}</b> · {h ? `${jt(h.sales)} · ${h.count} trx · ${x1(h.ratio)}` : 'di luar rentang data'}{he ? ` · ${he.name}` : ''}</span> : 'Arahkan atau sentuh kotak untuk melihat omzet harian.'}
      </div>
      <div className="hm" role="img" aria-label={`Peta panas omzet harian ${year}`} onMouseLeave={() => setHover(null)}>
        <span />
        {Array.from({ length: 31 }, (_, d) => <span key={d} className="hm-d">{(d + 1) % 5 === 1 || d === 30 ? d + 1 : ''}</span>)}
        {BLN.map((b, m) => (
          <div key={b} className="hm-row">
            <span className="hm-m">{b}</span>
            {Array.from({ length: 31 }, (_, d) => {
              const dt = new Date(year, m, d + 1);
              if (dt.getMonth() !== m) return <i key={d} className="hm-x" />;
              const k = localDay(dt);
              const c = cells[k];
              const ev = evOf(k);
              return <i key={d} className={`hm-c ${ev ? 'ev' : ''} ${c && c.count === 0 ? 'zero' : ''}`} style={{ background: c ? (c.count ? colorOf(c.ratio) : undefined) : 'transparent' }}
                onMouseEnter={() => setHover(k)} onTouchStart={() => setHover(k)} title={`${dShort(k)}${c ? `: ${jt(c.sales)} (${x1(c.ratio)})` : ''}${ev ? ` · ${ev.name}` : ''}`} />;
            })}
          </div>
        ))}
      </div>
      <div className="hm-legend small muted">
        {STEPS.map((s) => <span key={s.l}><i style={{ background: s.c }} />{s.l}</span>)}
        <span><i className="zero" />tutup / 0</span>
        <span><i className="ev-key" />hari event</span>
      </div>
    </div>
  );
}

function EventForm({ e, title, onClose }: { e: Partial<CalEvent>; title?: string; onClose: () => void }) {
  const [f, setF] = useState<Partial<CalEvent>>(e);
  const valid = !!f.name?.trim() && !!f.date && (!f.end || f.end >= f.date);
  async function submit() {
    const { id, created_at, updated_at, ...p } = f as CalEvent;
    await save<CalEvent>('events', id || newId('ev'), { ...p, name: f.name!.trim(), end: f.end && f.end !== f.date ? f.end : undefined, kind: f.kind || 'toko', recurring: !!f.recurring });
    toast('Event disimpan');
    onClose();
  }
  return (
    <Modal title={title || (e.id ? 'Ubah event' : 'Event baru')} onClose={onClose}
      footer={<>
        {e.id && <button className="btn danger" onClick={async () => { if (confirm(`Hapus event "${e.name}"?`)) { await save<CalEvent>('events', e.id!, { deleted: true }); onClose(); } }}>Hapus</button>}
        <button className="btn primary grow" disabled={!valid} onClick={submit} data-testid="simpan-event">Simpan</button>
      </>}>
      <div className="stack">
        <Field label="Nama event"><input value={f.name || ''} onChange={(x) => setF({ ...f, name: x.target.value })} placeholder="Wisuda USU periode III" data-testid="event-nama" /></Field>
        <div className="cols">
          <Field label="Mulai"><input type="date" value={f.date || ''} onChange={(x) => setF({ ...f, date: x.target.value })} data-testid="event-mulai" /></Field>
          <Field label="Sampai (opsional)"><input type="date" value={f.end || ''} min={f.date} onChange={(x) => setF({ ...f, end: x.target.value })} /></Field>
        </div>
        <Field group label="Kategori"><Seg value={(f.kind === 'musim' ? 'momen' : f.kind || 'toko') as EventKind} onChange={(kind) => setF({ ...f, kind })} options={KIND_LIST.map((k) => ({ value: k, label: KIND_LABEL[k] }))} /></Field>
        <label className="check"><input type="checkbox" checked={!!f.recurring} onChange={(x) => setF({ ...f, recurring: x.target.checked })} data-testid="event-rutin" />Event rutin: muncul otomatis setiap tahun pada tanggal yang sama</label>
        <Field label="Catatan" hint="Mis. produk yang laku, stok yang perlu disiapkan, jumlah perangkai"><textarea rows={4} value={f.note || ''} onChange={(x) => setF({ ...f, note: x.target.value })} /></Field>
      </div>
    </Modal>
  );
}

interface CalJob { id: number; email: string; label: string; kind: 'request' | 'cancel' | 'reminder'; seq: number; status: string; last_error?: string | null; created_at: string; sent_at?: string | null }
interface CalSync {
  enabled: boolean; emails: string[]; kinds: EventKind[]; remind: number[]; owners: { name: string; email: string }[]; recipients: string[];
  smtp: { configured: boolean; from: string | null }; active: number; jobs: CalJob[];
}

/** Sinkron kalender event ke Google Calendar owner + email tambahan (disimpan di server, tidak ikut sinkron ke perangkat). */
function CalSyncModal({ onClose }: { onClose: () => void }) {
  const [c, setC] = useState<CalSync | null>(null);
  const [f, setF] = useState<{ enabled: boolean; emails: string[]; kinds: EventKind[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<CalSync>('/api/calsync').then((x) => { setC(x); setF({ enabled: x.enabled, emails: x.emails.length ? x.emails : [''], kinds: x.kinds }); }).catch((e) => toast(e.message, 'err'));
  }, []);
  async function submit() {
    setBusy(true);
    try {
      const x = await api<CalSync>('/api/calsync', { body: { enabled: f!.enabled, emails: f!.emails.map((e) => e.trim()).filter(Boolean), kinds: f!.kinds } });
      setC(x);
      toast(x.enabled ? `Sinkron aktif: ${x.recipients.length} penerima, dikirim bertahap dalam 1–2 menit` : 'Sinkron dimatikan; event dihapus dari kalender penerima');
      onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  const setEmail = (i: number, v: string) => setF({ ...f!, emails: f!.emails.map((e, j) => (j === i ? v : e)) });
  const JOB: Record<string, string> = { request: 'Event', cancel: 'Hapus', reminder: 'Pengingat' };
  return (
    <Modal title="Sinkron ke Google Calendar" onClose={onClose} wide
      footer={<button className="btn primary grow" disabled={!f || busy} onClick={submit} data-testid="gcal-simpan">{busy ? 'Menyimpan…' : 'Simpan & sinkronkan'}</button>}>
      {!c || !f ? <div className="muted">Memuat…</div> : (
        <div className="gcal" data-testid="gcal">
          <div className="stack">
            <label className="check big"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} data-testid="gcal-aktif" />
              <span><b>Kirim kalender event ke Google Calendar</b><span className="muted small">Event masa depan dan event rutin dikirim sebagai acara sepanjang hari. Ubah/hapus event di sini, kalender penerima ikut berubah.</span></span></label>
            <div className="section-title">Penerima</div>
            {c.owners.map((o) => <div key={o.email} className="row small"><span>{o.name} <Badge tone="rose">owner</Badge></span><b>{o.email}</b></div>)}
            {!c.owners.length && <div className="note warn small">Akun owner belum punya email. Isi di Pengaturan › Pengguna › Email, atau tambahkan email di bawah.</div>}
            {f.emails.map((e, i) => (
              <div key={i} className="gcal-mail">
                <input type="email" value={e} onChange={(x) => setEmail(i, x.target.value)} placeholder="email@gmail.com" autoCapitalize="none" aria-label={`Email tambahan ${i + 1}`} data-testid="gcal-email" />
                <button className="icon-btn" onClick={() => setF({ ...f, emails: f.emails.length > 1 ? f.emails.filter((_, j) => j !== i) : [''] })} aria-label={`Hapus email ${i + 1}`}><Icon name="close" size={18} /></button>
              </div>
            ))}
            {f.emails.length < 10 && <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setF({ ...f, emails: [...f.emails, ''] })} data-testid="gcal-tambah-email"><Icon name="plus" size={16} />Email tambahan</button>}
            <div className="section-title">Kategori yang dikirim</div>
            <div className="kfilter">
              {KIND_LIST.map((k) => <button key={k} className={`${f.kinds.includes(k) ? 'on' : ''} k-${k}`} onClick={() => setF({ ...f, kinds: f.kinds.includes(k) ? f.kinds.filter((x) => x !== k) : [...f.kinds, k] })} aria-pressed={f.kinds.includes(k)}><i />{KIND_LABEL[k]}</button>)}
            </div>
          </div>
          <div className="stack">
            <div className="section-title">Pengingat</div>
            <div className="dl small">
              <dt>Email pengingat</dt><dd>H-7 dan H-3 pukul 08.00 WIB ke semua penerima, berisi catatan event (stok, perangkai).</dd>
              <dt>Alarm kalender</dt><dd>H-7 dan H-3 pukul 08.00 tertanam di acara (Apple Calendar, Outlook).</dd>
              <dt>Pengirim</dt><dd>{c.smtp.configured ? c.smtp.from : <span className="red">Belum diatur. Isi di Pengaturan › Reset Password.</span>}</dd>
              <dt>Status</dt><dd>{c.enabled ? `${c.active} event aktif di kalender penerima` : 'Nonaktif'}</dd>
            </div>
            <div className="note small">Google Calendar tidak memakai alarm dari undangan email, jadi pengingat H-7 dan H-3 dikirim server sebagai email. Agar juga muncul notifikasi di HP: Google Calendar › Setelan › pilih kalender › <b>Notifikasi acara sepanjang hari</b> › tambah “1 minggu sebelumnya” dan “3 hari sebelumnya”.</div>
            {c.jobs.length > 0 && (
              <>
                <div className="section-title">Riwayat pengiriman</div>
                <div className="gcal-log">
                  {c.jobs.slice(0, 8).map((j) => (
                    <div key={j.id} className="row small"><span className="clip">{JOB[j.kind] || j.kind} · {j.label}<span className="muted"> → {j.email}</span></span>
                      <Badge tone={j.status === 'sent' ? 'green' : j.status === 'failed' ? 'red' : 'amber'}>{j.status === 'sent' ? 'terkirim' : j.status === 'failed' ? 'gagal' : 'menunggu'}</Badge></div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
