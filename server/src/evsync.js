// Sinkron kalender event toko (menu Kalender, owner) ke Google Calendar owner + email tambahan.
// Setiap event dikirim sebagai undangan iCalendar sepanjang hari (event rutin memakai RRULE tahunan).
// Google Calendar mengabaikan VALARM dari undangan email, jadi pengingat H-7 dan H-3 (08.00 WIB) juga dikirim
// sebagai email biasa oleh server. VALARM tetap disertakan untuk Apple Calendar/Outlook.
//
// Memakai tabel yang sama dengan notifikasi perangkai: cal_events (keadaan undangan per event & email, kunci "ev-<id>")
// dan notify_jobs (antrean kirim + coba ulang, diproses notifier.tick()). Pengingat tercatat di ev_reminders agar tidak ganda.
import crypto from 'node:crypto';
import { buildIcs } from './ics.js';

export const KINDS = ['libur', 'lokal', 'momen', 'data', 'toko'];
export const KIND_LABEL = { libur: 'Libur Nasional', lokal: 'Lokal', momen: 'Puncak Penjualan', musim: 'Puncak Penjualan', data: 'Lonjakan data', toko: 'Toko' };
export const DEFAULT_CALSYNC = { enabled: false, emails: [], kinds: KINDS, remind: [7, 3] };
const REMIND_HOUR_UTC = 1; // 08.00 WIB
const DAY = 86400e3;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const pad = (n) => String(n).padStart(2, '0');
/** Tanggal kalender WIB (YYYY-MM-DD) dari epoch ms. */
export const wibDate = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10);
const addDays = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const toYear = (k, y) => (k.slice(5) === '02-29' && !leap(y) ? `${y}-02-28` : `${y}${k.slice(4)}`);
const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const dayText = (k) => { const d = new Date(k + 'T00:00:00Z'); return `${HARI[d.getUTCDay()]}, ${d.getUTCDate()} ${BLN[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const kindOf = (k) => (k === 'musim' ? 'momen' : k);

/** Rentang tanggal event dalam teks, mis. "Sen, 23 Nov 2026 – Rab, 25 Nov 2026". */
export function rangeText(ev) {
  const end = ev.end && ev.end > ev.date ? ev.end : null;
  return `${dayText(ev.date)}${end ? ` – ${dayText(end)}` : ''}${ev.recurring ? ' (setiap tahun)' : ''}`;
}

/**
 * @param {{store:any, smtpConfig:()=>any, storeName:()=>string, now?:()=>number}} deps
 */
export function createEventSync(deps) {
  const { store, smtpConfig, storeName } = deps;
  const { db } = store;
  const now = deps.now || (() => Date.now());
  const q = {
    rows: db.prepare('SELECT * FROM cal_events WHERE order_id = ?'),
    upsert: db.prepare(`INSERT INTO cal_events (order_id, email, florist, uid, seq, hash, active, sent, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(order_id, email) DO UPDATE SET florist = excluded.florist, seq = excluded.seq, hash = excluded.hash, active = 1, updated_at = excluded.updated_at`),
    deactivate: db.prepare('UPDATE cal_events SET active = 0, seq = ?, hash = NULL, updated_at = ? WHERE order_id = ? AND email = ?'),
    dropPending: db.prepare("DELETE FROM notify_jobs WHERE order_id = ? AND email = ? AND status = 'pending'"),
    enqueue: db.prepare("INSERT INTO notify_jobs (order_id, email, florist, label, kind, seq, payload, status, attempts, next_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)"),
    events: db.prepare("SELECT id, data, del FROM records WHERE c = 'events'"),
    event: db.prepare("SELECT id, data, del FROM records WHERE c = 'events' AND id = ?"),
    owners: db.prepare("SELECT name, email FROM users WHERE role = 'owner' AND active = 1 AND email IS NOT NULL AND email != '' ORDER BY created_at"),
    activeCount: db.prepare("SELECT COUNT(DISTINCT order_id) AS n FROM cal_events WHERE order_id LIKE 'ev-%' AND active = 1"),
    recent: db.prepare("SELECT id, order_id, email, florist, label, kind, seq, status, attempts, last_error, created_at, sent_at FROM notify_jobs WHERE order_id LIKE 'ev-%' ORDER BY id DESC LIMIT ?"),
    remindHas: db.prepare('SELECT 1 FROM ev_reminders WHERE key = ?'),
    remindAdd: db.prepare('INSERT OR IGNORE INTO ev_reminders (key, created_at) VALUES (?, ?)'),
  };

  function config() {
    let c = null;
    try { c = JSON.parse(store.kvGet('calsync') || 'null'); } catch { /* rusak: pakai bawaan */ }
    const m = { ...DEFAULT_CALSYNC, ...(c || {}) };
    return { ...m, emails: [...(m.emails || [])], kinds: (m.kinds || KINDS).filter((k) => KINDS.includes(k)), remind: DEFAULT_CALSYNC.remind };
  }
  const setConfig = (c) => store.kvSet('calsync', JSON.stringify(c));
  const owners = () => q.owners.all().map((o) => ({ name: o.name, email: String(o.email).toLowerCase() }));
  function recipients(cfg = config()) {
    const set = new Set([...owners().map((o) => o.email), ...cfg.emails.map((e) => String(e).toLowerCase())]);
    return [...set].filter(Boolean);
  }
  const key = (id) => `ev-${id}`;
  const uidFor = (id, email) => `kb-ev-${id}-${sha(email).slice(0, 10)}@kasir-buket`;
  const hashOf = (ev) => sha(JSON.stringify([ev.name, ev.date, ev.end || '', kindOf(ev.kind), ev.note || '', !!ev.recurring])).slice(0, 20);
  const isPast = (ev, today) => !ev.recurring && (ev.end || ev.date) < today;
  const wanted = (ev, cfg) => cfg.enabled && !ev.deleted && cfg.kinds.includes(kindOf(ev.kind)) && !!ev.date && !!ev.name;

  function payload(kind, ev, email, seq) {
    const smtp = smtpConfig() || {};
    const toko = storeName();
    const label = KIND_LABEL[ev.kind] || 'Event';
    const desc = [
      `${label} · ${rangeText(ev)}`,
      ...(ev.note ? ['', ev.note] : []),
      '', 'Pengingat email otomatis: H-7 dan H-3 pukul 08.00 WIB.',
      `Dikirim otomatis dari Kalender ${toko}. Ubah atau hapus event di aplikasi; kalender ini ikut berubah.`,
    ].join('\n');
    const end = ev.end && ev.end > ev.date ? ev.end : ev.date;
    const method = kind === 'cancel' ? 'CANCEL' : 'REQUEST';
    const ics = buildIcs({
      method, uid: uidFor(ev.id, email), sequence: seq, stamp: new Date(now()),
      allDay: { start: ev.date, end: addDays(end, 1) }, rrule: ev.recurring ? 'FREQ=YEARLY' : undefined,
      summary: ev.name, description: desc, location: toko, transparent: true,
      organizer: { email: smtp.from || 'kasir-buket@localhost', name: smtp.fromName || toko }, attendee: { email },
      alarms: ['-P6DT16H', '-P2DT16H'], // 08.00 pada H-7 dan H-3 (Apple Calendar/Outlook; Google memakai email pengingat)
      prodid: '-//Kasir Buket//Kalender Event Toko//ID',
    });
    const subject = kind === 'cancel' ? `Dihapus dari kalender toko: ${ev.name}`
      : `${seq > 0 ? 'Diperbarui' : 'Kalender toko'}: ${ev.name} · ${dayText(ev.date)}`;
    const text = kind === 'cancel'
      ? `Event "${ev.name}" dihapus dari kalender ${toko} (atau sinkron dimatikan). Acara di Google Calendar ikut dihapus.\n`
      : `${ev.name}\n${desc}\n`;
    return { subject, text, method, ics, filename: 'kalender-toko.ics' };
  }
  function enqueue(kind, ev, email, seq) {
    q.enqueue.run(key(ev.id), email, '', ev.name.slice(0, 60), kind, seq, JSON.stringify(payload(kind, ev, email, seq)), now(), new Date(now()).toISOString());
  }

  /** Samakan undangan satu event dengan keadaan terkini (dipanggil setelah event diubah atau pengaturan berubah). */
  function reconcile(ev, cfg = config(), emails = recipients(cfg)) {
    if (!ev?.id) return;
    const today = wibDate(now());
    if (isPast(ev, today)) return; // event lampau dibiarkan apa adanya di kalender
    const targets = wanted(ev, cfg) ? emails : [];
    const rows = q.rows.all(key(ev.id));
    const ts = new Date(now()).toISOString();
    const hash = hashOf(ev);
    store.tx(() => {
      for (const r of rows) {
        if (!r.active || targets.includes(r.email)) continue;
        q.dropPending.run(r.order_id, r.email);
        if (r.sent) { enqueue('cancel', ev, r.email, r.seq + 1); q.deactivate.run(r.seq + 1, ts, r.order_id, r.email); }
        else q.deactivate.run(r.seq, ts, r.order_id, r.email);
      }
      for (const email of targets) {
        const r = rows.find((x) => x.email === email);
        if (r && r.active && r.hash === hash) continue;
        const seq = r ? r.seq + 1 : 0;
        q.dropPending.run(key(ev.id), email);
        q.upsert.run(key(ev.id), email, '', uidFor(ev.id, email), seq, hash, r ? r.sent : 0, ts);
        enqueue('request', ev, email, seq);
      }
    });
  }
  const parse = (r) => ({ ...JSON.parse(r.data), id: r.id, ...(r.del ? { deleted: true } : {}) });
  function reconcileById(id) {
    const r = q.event.get(id);
    if (r) reconcile(parse(r));
  }
  function reconcileAll() {
    const cfg = config();
    const emails = recipients(cfg);
    let n = 0;
    for (const r of q.events.all()) { reconcile(parse(r), cfg, emails); n++; }
    return n;
  }

  /** Email pengingat H-7 dan H-3 pukul 08.00 WIB. Dikirim bila waktunya sudah lewat ≤ 24 jam dan belum pernah dikirim. */
  function remind() {
    const cfg = config();
    if (!cfg.enabled || !smtpConfig()?.host) return 0;
    const emails = recipients(cfg);
    if (!emails.length) return 0;
    const t = now();
    const today = wibDate(t);
    const year = Number(today.slice(0, 4));
    const toko = storeName();
    let n = 0;
    for (const r of q.events.all()) {
      const ev = parse(r);
      if (!wanted(ev, cfg)) continue;
      const starts = ev.recurring ? [toYear(ev.date, year), toYear(ev.date, year + 1)] : [ev.date];
      for (const start of starts) {
        if (start < today || start > addDays(today, 8)) continue;
        for (const d of cfg.remind) {
          const day = addDays(start, -d);
          const fire = Date.parse(`${day}T${pad(REMIND_HOUR_UTC)}:00:00Z`);
          if (t < fire || t >= fire + DAY) continue;
          const occ = { ...ev, date: start, end: ev.end && ev.end > ev.date ? addDays(start, Math.round((Date.parse(ev.end) - Date.parse(ev.date)) / DAY)) : undefined };
          for (const email of emails) {
            const k = `${ev.id}|${start}|${d}|${email}`;
            if (q.remindHas.get(k)) continue;
            q.remindAdd.run(k, new Date(t).toISOString());
            const subject = `Pengingat H-${d}: ${ev.name} (${dayText(start)})`;
            const text = [
              `${d} hari lagi: ${ev.name}`,
              `${KIND_LABEL[ev.kind] || 'Event'} · ${rangeText({ ...occ, recurring: false })}`,
              ...(ev.note ? ['', ev.note] : []),
              '', `Siapkan stok bahan, jadwal perangkai, dan promosi sejak sekarang.`,
              `Pengingat otomatis dari Kalender ${toko}.`,
            ].join('\n');
            q.enqueue.run(key(ev.id), email, '', `H-${d} ${ev.name}`.slice(0, 60), 'reminder', 0, JSON.stringify({ subject, text }), t, new Date(t).toISOString());
            n++;
          }
        }
      }
    }
    return n;
  }

  return {
    config, setConfig, owners, recipients, reconcile, reconcileById, reconcileAll, remind,
    activeCount: () => q.activeCount.get().n, recent: (n = 30) => q.recent.all(n),
  };
}
