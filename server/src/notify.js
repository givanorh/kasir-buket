// Notifikasi perangkai: saat pesanan ditunjuk ke perangkai, server mengirim email berisi undangan kalender (ICS)
// ke Gmail perangkai, sehingga tugas muncul di Google Calendar miliknya. Pesanan batal / dipindah perangkai /
// perangkai dilepas => undangan dibatalkan (METHOD:CANCEL) dan acara hilang dari kalendernya.
//
// Alur: push sinkron -> reconcile(order) -> antrean notify_jobs -> tick() mengirim lewat SMTP dengan coba ulang.
// Semua keputusan berbasis tabel cal_events (keadaan undangan per pesanan & email), sehingga idempoten:
// perubahan yang tidak memengaruhi isi undangan (mis. status produksi, pembayaran) tidak mengirim email apa pun.
import crypto from 'node:crypto';
import { buildIcs } from './ics.js';

export const DEFAULT_NOTIFY = { enabled: true, leadMinutes: 60, contacts: {} };
const HISTORIC_MS = 6 * 3600e3; // pesanan yang tenggatnya lewat > 6 jam tidak diberi undangan baru
const MAX_ATTEMPTS = 8;
const BACKOFF = [30, 120, 600, 1800, 3600, 3600, 3600, 3600]; // detik
const EXPIRE_MS = 48 * 3600e3;

const norm = (s) => String(s || '').trim().toLowerCase();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const WIB = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function fmtWib(d) {
  const p = Object.fromEntries(WIB.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.day} ${p.month} ${p.year} ${p.hour}:${p.minute} WIB`;
}

/** Rentang acara: berakhir di tenggat, mulai `leadMinutes` sebelumnya. Pesanan "ditunggu": 30 menit sejak dibuat. */
export function eventWindow(order, leadMinutes) {
  const created = new Date(order.created_at || Date.now()).getTime();
  if (order.fulfillment === 'sekarang' || !order.due_at) return { start: created, end: created + 30 * 60e3 };
  const end = new Date(order.due_at).getTime();
  return { start: end - Math.max(15, leadMinutes) * 60e3, end };
}

const shortNo = (o) => String(o.no || '').split('-').pop();
const fulfillLabel = (o) => (o.fulfillment === 'antar' ? 'Diantar' : o.fulfillment === 'ambil' ? 'Diambil' : 'Ditunggu di toko');

/** Isi yang memengaruhi undangan; bila hash sama, tidak ada email baru. */
export function contentHash(order, leadMinutes) {
  const items = (order.items || []).map((i) => [i.qty, i.name, i.note || '']);
  return sha(JSON.stringify([order.no, order.fulfillment, order.due_at || '', order.customer_name || '', order.notes || '', order.card_message || '', order.florist || '', items, leadMinutes])).slice(0, 20);
}

export function describe(order, { storeName, address, leadMinutes }) {
  const items = order.items || [];
  const first = items[0] ? `${items[0].qty}× ${items[0].name}` : 'Pesanan';
  const more = items.length > 1 ? ` +${items.length - 1} item` : '';
  const { end } = eventWindow(order, leadMinutes);
  const summary = `Rangkai #${shortNo(order)} · ${first}${more}`;
  const lines = [
    `Pesanan ${order.no} · ${fulfillLabel(order)}`,
    `Tenggat siap: ${fmtWib(end)}`,
    `Pelanggan: ${order.customer_name || 'Umum'}`,
    `Perangkai: ${order.florist}`,
    '',
    'Item:',
    ...items.map((i) => `- ${i.qty}× ${i.name}${i.note ? ` (${i.note})` : ''}`),
  ];
  if (order.notes) lines.push('', `Catatan rangkaian: ${order.notes}`);
  if (order.card_message) lines.push('', `Kartu ucapan: "${order.card_message}"`);
  lines.push('', `Dikirim otomatis oleh ${storeName}. Bila pesanan dibatalkan atau dipindah ke perangkai lain, acara ini dihapus otomatis dari kalender.`);
  return { summary, description: lines.join('\n'), location: [storeName, address].filter(Boolean).join(', ') };
}

/**
 * @param {{store:any, sendMail:Function, smtpConfig:()=>any, storeInfo:(order:any)=>{storeName:string,address:string},
 *   now?:()=>number, delayMs?:number, log?:(...a:any[])=>void}} deps
 */
export function createNotifier(deps) {
  const { store, sendMail, smtpConfig, storeInfo } = deps;
  const { db } = store;
  const now = deps.now || (() => Date.now());
  const delayMs = deps.delayMs ?? 15000;
  const log = deps.log || ((...a) => console.log('[notifikasi]', ...a));
  const q = {
    events: db.prepare('SELECT * FROM cal_events WHERE order_id = ?'),
    upsertEv: db.prepare(`INSERT INTO cal_events (order_id, email, florist, uid, seq, hash, active, sent, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(order_id, email) DO UPDATE SET florist = excluded.florist, seq = excluded.seq, hash = excluded.hash, active = 1, updated_at = excluded.updated_at`),
    deactivate: db.prepare('UPDATE cal_events SET active = 0, seq = ?, hash = NULL, updated_at = ? WHERE order_id = ? AND email = ?'),
    markSent: db.prepare('UPDATE cal_events SET sent = 1 WHERE order_id = ? AND email = ?'),
    dropPending: db.prepare("DELETE FROM notify_jobs WHERE order_id = ? AND email = ? AND status = 'pending'"),
    enqueue: db.prepare("INSERT INTO notify_jobs (order_id, email, florist, label, kind, seq, payload, status, attempts, next_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)"),
    due: db.prepare("SELECT * FROM notify_jobs WHERE status = 'pending' AND next_at <= ? ORDER BY id LIMIT 5"),
    setJob: db.prepare('UPDATE notify_jobs SET status = ?, attempts = ?, next_at = ?, last_error = ?, sent_at = ? WHERE id = ?'),
    expire: db.prepare("UPDATE notify_jobs SET status = 'expired', last_error = 'Kedaluwarsa: email belum diatur > 48 jam' WHERE status = 'pending' AND created_at < ?"),
    recent: db.prepare("SELECT id, order_id, email, florist, label, kind, seq, status, attempts, last_error, created_at, sent_at FROM notify_jobs WHERE order_id NOT LIKE 'ev-%' ORDER BY id DESC LIMIT ?"),
    getOrder: db.prepare("SELECT data, del FROM records WHERE c = 'orders' AND id = ?"),
    candidates: db.prepare(`SELECT id FROM records WHERE c = 'orders' AND del = 0 AND json_extract(data, '$.florist') IS NOT NULL AND json_extract(data, '$.florist') != ''
      AND COALESCE(json_extract(data, '$.due_at'), json_extract(data, '$.created_at')) >= ?
      UNION SELECT order_id FROM cal_events WHERE active = 1`),
  };

  function config() {
    let c = null;
    try { c = JSON.parse(store.kvGet('notify') || 'null'); } catch { /* rusak: pakai bawaan */ }
    return { ...DEFAULT_NOTIFY, ...(c || {}), contacts: { ...((c && c.contacts) || {}) } };
  }
  function setConfig(next) {
    store.kvSet('notify', JSON.stringify(next));
  }
  function emailFor(cfg, florist) {
    const k = norm(florist);
    if (!k) return null;
    for (const [name, email] of Object.entries(cfg.contacts)) if (norm(name) === k && email) return String(email).toLowerCase();
    return null;
  }
  const uidFor = (orderId, email) => `kb-${orderId}-${sha(email).slice(0, 10)}@kasir-buket`;

  function payload(kind, order, email, seq, cfg) {
    const smtp = smtpConfig() || {};
    const info = storeInfo(order);
    const d = describe(order, { ...info, leadMinutes: cfg.leadMinutes });
    const win = eventWindow(order, cfg.leadMinutes);
    const method = kind === 'cancel' ? 'CANCEL' : 'REQUEST';
    const ics = buildIcs({
      method, uid: uidFor(order.id, email), sequence: seq, start: new Date(win.start), end: new Date(win.end), stamp: new Date(now()),
      summary: d.summary, description: d.description, location: d.location,
      organizer: { email: smtp.from || 'kasir-buket@localhost', name: smtp.fromName || info.storeName }, attendee: { email, name: order.florist },
      alarmMinutes: 30,
    });
    const subject = kind === 'cancel' ? `Dibatalkan: tugas rangkai #${shortNo(order)}`
      : `${seq > 0 ? 'Diperbarui' : 'Tugas rangkai'} #${shortNo(order)} · ${fulfillLabel(order)} ${fmtWib(win.end)}`;
    const text = kind === 'cancel'
      ? `Tugas rangkai pesanan ${order.no} untuk ${order.florist || 'Anda'} dibatalkan atau dipindahkan. Acara di Google Calendar ikut dihapus.\n\n${info.storeName}`
      : `Halo ${order.florist},\n\nAda tugas rangkai untuk Anda.\n\n${d.description}\n`;
    return { subject, text, method, ics };
  }

  function enqueue(kind, order, email, florist, seq, cfg) {
    q.enqueue.run(order.id, email, florist || '', `#${shortNo(order)}`, kind, seq, JSON.stringify(payload(kind, order, email, seq, { ...cfg })), now() + (kind === 'cancel' ? 0 : delayMs), new Date(now()).toISOString());
  }

  /** Samakan undangan dengan keadaan pesanan terkini. Dipanggil setelah setiap perubahan pesanan. */
  function reconcile(order) {
    if (!order?.id) return;
    const cfg = config();
    if (!cfg.enabled) return; // nonaktif = tidak ada email apa pun (undangan lama dibiarkan)
    const events = q.events.all(order.id);
    const live = !order.void && !order.deleted && order.production_status !== 'batal';
    const email = live && order.florist ? emailFor(cfg, order.florist) : null;
    const ts = new Date(now()).toISOString();
    store.tx(() => {
      for (const ev of events) {
        if (!ev.active || ev.email === email) continue;
        // perangkai berganti / pesanan batal / email dihapus: batalkan undangan lama
        q.dropPending.run(order.id, ev.email);
        if (ev.sent) {
          const seq = ev.seq + 1;
          enqueue('cancel', { ...order, florist: ev.florist }, ev.email, ev.florist, seq, cfg);
          q.deactivate.run(seq, ts, order.id, ev.email);
        } else {
          q.deactivate.run(ev.seq, ts, order.id, ev.email);
        }
      }
      if (!email) return;
      const ev = events.find((e) => e.email === email);
      const hash = contentHash(order, cfg.leadMinutes);
      const isNew = !ev || !ev.active;
      if (!isNew && ev.hash === hash) return; // isi sama: tidak perlu email
      if (order.production_status === 'selesai') return;
      if (isNew && eventWindow(order, cfg.leadMinutes).end < now() - HISTORIC_MS) return; // pesanan lama: lewati
      const seq = ev ? ev.seq + 1 : 0;
      q.dropPending.run(order.id, email);
      q.upsertEv.run(order.id, email, order.florist, uidFor(order.id, email), seq, hash, ev ? ev.sent : 0, ts);
      enqueue('request', order, email, order.florist, seq, cfg);
    });
  }

  function reconcileById(id) {
    const r = q.getOrder.get(id);
    if (!r) return;
    const o = JSON.parse(r.data);
    reconcile(r.del ? { ...o, deleted: true } : o);
  }

  /** Setelah daftar email perangkai berubah: periksa pesanan aktif 2 hari terakhir & yang punya undangan aktif. */
  function reconcileAll() {
    const since = new Date(now() - 2 * 86400e3).toISOString();
    let n = 0;
    for (const { id } of q.candidates.all(since)) { reconcileById(id); n++; }
    return n;
  }

  let running = false;
  async function tick() {
    if (running) return 0;
    running = true;
    let sent = 0;
    try {
      const smtp = smtpConfig();
      if (!smtp?.host) { q.expire.run(new Date(now() - EXPIRE_MS).toISOString()); return 0; }
      for (const job of q.due.all(now())) {
        const p = JSON.parse(job.payload);
        if (job.kind === 'request') q.markSent.run(job.order_id, job.email); // tandai sebelum kirim agar pembatalan berikutnya pasti terkirim (juga untuk event kalender "ev-…")
        try {
          await sendMail(smtp, { to: job.email, subject: p.subject, text: p.text, calendar: p.ics ? { method: p.method, ics: p.ics, filename: p.filename } : undefined });
          q.setJob.run('sent', job.attempts + 1, job.next_at, null, new Date(now()).toISOString(), job.id);
          sent++;
        } catch (e) {
          const attempts = job.attempts + 1;
          const failed = attempts >= MAX_ATTEMPTS;
          q.setJob.run(failed ? 'failed' : 'pending', attempts, now() + BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)] * 1000, String(e.message || e).slice(0, 300), null, job.id);
          log(`gagal kirim ${job.kind} ${job.label} ke ${job.email}: ${e.message}`);
        }
      }
    } finally {
      running = false;
    }
    return sent;
  }

  /** Undangan uji ke satu perangkai (langsung kirim, tanpa antrean): besok 09.00–10.00 WIB. */
  async function test(name, cancel = false) {
    const cfg = config();
    const email = emailFor(cfg, name);
    if (!email) throw Object.assign(new Error(`Email ${name} belum diisi`), { status: 400 });
    const smtp = smtpConfig();
    if (!smtp?.host) throw Object.assign(new Error('Atur Akun GMAIL Toko dulu di Pengaturan › Reset Password'), { status: 400 });
    const wibNow = new Date(now() + 7 * 3600e3);
    const start = Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate() + 1, 9 - 7, 0, 0);
    const info = storeInfo({});
    const uid = `kb-uji-${sha(email).slice(0, 10)}@kasir-buket`;
    const ics = buildIcs({
      method: cancel ? 'CANCEL' : 'REQUEST', uid, sequence: cancel ? 1 : 0, start: new Date(start), end: new Date(start + 3600e3), stamp: new Date(now()),
      summary: `[UJI] Kalender ${info.storeName}`, description: 'Acara uji dari Kasir Buket. Tekan "Batalkan uji" di aplikasi untuk memastikan acara ini hilang otomatis.',
      location: info.storeName, organizer: { email: smtp.from, name: smtp.fromName || info.storeName }, attendee: { email, name },
    });
    await sendMail(smtp, {
      to: email,
      subject: cancel ? `Dibatalkan: [UJI] Kalender ${info.storeName}` : `[UJI] Kalender ${info.storeName}`,
      text: cancel ? 'Tugas uji dibatalkan. Bila acara uji hilang dari Google Calendar, penghapusan otomatis berjalan.\n' : `Halo ${name},\n\nIni Tugas uji. Bila acara "[UJI] Kalender ${info.storeName}" muncul di Google Calendar besok pukul 09.00, notifikasi tugas rangkai sudah siap.\n`,
      calendar: { method: cancel ? 'CANCEL' : 'REQUEST', ics },
    });
    return { ok: true, email };
  }

  return { config, setConfig, reconcile, reconcileById, reconcileAll, tick, test, recent: (n = 30) => q.recent.all(n), emailFor };
}
