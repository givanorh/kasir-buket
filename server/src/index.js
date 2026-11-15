// Server Kasir Buket
// - POST /api/setup, /api/auth/login, GET /api/auth/me
// - GET /api/sync/pull?since=N, POST /api/sync/push   (sinkron berbasis nomor urut/seq server)
// - GET /api/events?token=...                          (SSE: memberi tahu perangkat ada perubahan)
// - GET/POST/PATCH /api/users                          (khusus owner)
// - GET/POST /api/notify, POST /api/notify/test         (notifikasi & kalender perangkai, khusus owner)
// - GET/POST /api/geo-config, POST /api/geo/route       (ongkir: OpenRouteService, cadangan OSRM)
// - POST /api/devices/code                             (ubah jenis/fungsi perangkat -> kode nomor struk)
// - selain /api: menyajikan aplikasi web (folder app/dist)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, backup } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken, createLimiter } from './auth.js';
import { sendMail } from './smtp.js';
import { expandMapsUrl, roadDistanceKm, orsDistanceKm } from './geo.js';
import { createNotifier } from './notify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const VERSION = '1.3.0';

const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const ROLES = ['owner', 'kasir', 'perangkai'];
// Kode perangkat = jenis + fungsi, mis. KK = Komputer Kasir. Bila sudah dipakai perangkat lain: KK2, KK3, ...
export const DEVICE_KIND = { K: 'Komputer', H: 'HP', T: 'Tablet' };
export const DEVICE_FN = { K: 'Kasir', R: 'Ruang Rangkai', O: 'Owner' };

// Aturan tulis per koleksi. `fields` membatasi kolom yang boleh diubah peran tertentu.
const RULES = {
  outlets: { write: ['owner'] },
  settings: { write: ['owner'] },
  categories: { write: ['owner'] },
  products: { write: ['owner'] },
  customers: { write: ['owner', 'kasir'] },
  orders: {
    write: ['owner', 'kasir', 'perangkai'],
    fields: { perangkai: ['production_status', 'production_note', 'assigned_to', 'production_at', 'ready_at', 'done_at'] },
  },
  payments: { write: ['owner', 'kasir'] },
  stock_moves: { write: ['owner', 'kasir', 'perangkai'] },
  shifts: { write: ['owner', 'kasir'] },
  cash_moves: { write: ['owner', 'kasir'] },
  print_jobs: { write: ['owner', 'kasir', 'perangkai'] },
};
const SERVER_FIELDS = new Set(['id', 'updated_at', 'updated_by']);

export function createServer(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || path.resolve(__dirname, '../data');
  const staticDir = opts.staticDir || process.env.STATIC_DIR || path.resolve(__dirname, '../../app/dist');
  const tokenDays = Number(process.env.TOKEN_DAYS || 180);
  const store = opts.store || openDb(dataDir);
  const { db } = store;
  const limiter = createLimiter();
  const forgotLimiter = createLimiter(3, 15 * 60 * 1000);
  const sendMailFn = opts.sendMail || sendMail;
  const fetchFn = opts.fetch || fetch;
  const osrmBase = opts.osrmUrl || process.env.OSRM_URL || 'https://router.project-osrm.org';
  const orsBase = opts.orsUrl || process.env.ORS_URL || 'https://api.openrouteservice.org';
  const sseClients = new Set();

  const q = {
    getRec: db.prepare('SELECT data, del FROM records WHERE c = ? AND id = ?'),
    upsert: db.prepare(`INSERT INTO records (c, id, data, seq, del, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(c, id) DO UPDATE SET data = excluded.data, seq = excluded.seq, del = excluded.del,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by`),
    pull: db.prepare('SELECT c, id, data, seq, del FROM records WHERE seq > ? ORDER BY seq LIMIT ?'),
    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    listUsers: db.prepare('SELECT id, username, name, email, role, active, outlet_id, created_at FROM users ORDER BY created_at'),
    insertUser: db.prepare('INSERT INTO users (id, username, name, role, pass, active, outlet_id, created_at, email) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)'),
    userByEmail: db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)'),
    getCode: db.prepare('SELECT * FROM reset_codes WHERE user_id = ?'),
    putCode: db.prepare('INSERT INTO reset_codes (user_id, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0) ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0'),
    bumpCode: db.prepare('UPDATE reset_codes SET attempts = attempts + 1 WHERE user_id = ?'),
    delCode: db.prepare('DELETE FROM reset_codes WHERE user_id = ?'),
    deviceById: db.prepare('SELECT * FROM devices WHERE id = ?'),
    codeOwner: db.prepare('SELECT device_id FROM device_codes WHERE code = ?'),
    codeOnDevice: db.prepare('SELECT id FROM devices WHERE code = ?'),
    reserveCode: db.prepare('INSERT OR IGNORE INTO device_codes (code, device_id, created_at) VALUES (?, ?, ?)'),
    setDeviceCode: db.prepare('UPDATE devices SET code = ?, name = ? WHERE id = ?'),
    insertDevice: db.prepare('INSERT INTO devices (id, code, name, user_id, outlet_id, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    touchDevice: db.prepare('UPDATE devices SET last_seen = ?, user_id = ?, name = COALESCE(?, name) WHERE id = ?'),
  };

  const now = () => new Date().toISOString();
  const newId = () => crypto.randomBytes(8).toString('hex');

  /** Tulis satu rekaman (gabung dangkal/shallow merge) dan beri nomor urut baru. Panggil di dalam transaksi. */
  function writeRecord(c, id, patch, userId, del = false) {
    const row = q.getRec.get(c, id);
    const cur = row ? JSON.parse(row.data) : {};
    const ts = now();
    const data = { ...cur, ...patch, id, updated_at: ts, updated_by: userId || null };
    if (!row) {
      data.created_at = patch.created_at || ts;
      data.created_by = patch.created_by || userId || null;
    }
    const seq = ++store.state.seq;
    q.upsert.run(c, id, JSON.stringify(data), seq, del ? 1 : 0, ts, userId || null);
    return seq;
  }

  function mirrorUser(u) {
    writeRecord('staff', u.id, { name: u.name, username: u.username, role: u.role, active: !!u.active, outlet_id: u.outlet_id || null }, null);
  }

  /** Jenis & fungsi dari pilihan layar masuk; perangkat versi lama ditebak dari namanya. */
  function deviceBase(body) {
    let kind = String(body.deviceKind || '').toUpperCase();
    let fn = String(body.deviceFn || '').toUpperCase();
    const name = String(body.deviceName || '');
    if (!DEVICE_KIND[kind]) kind = /tablet|tab\b/i.test(name) ? 'T' : /\bhp\b|handphone|android|ponsel/i.test(name) ? 'H' : 'K';
    if (!DEVICE_FN[fn]) fn = /rangkai|produksi|florist/i.test(name) ? 'R' : /owner|pemilik/i.test(name) ? 'O' : 'K';
    return { base: kind + fn, label: `${DEVICE_KIND[kind]} ${DEVICE_FN[fn]}` };
  }
  /** Kode bebas pertama: KK, KK2, KK3, ... Kode yang pernah dipakai perangkat lain tidak diberikan lagi. */
  function allocCode(base, deviceId) {
    for (let i = 1; i < 1000; i++) {
      const code = i === 1 ? base : `${base}${i}`;
      const owner = q.codeOwner.get(code)?.device_id;
      const holder = q.codeOnDevice.get(code)?.id;
      if ((!owner || owner === deviceId) && (!holder || holder === deviceId)) return code;
    }
    throw new HttpError(409, 'Kode perangkat habis');
  }
  const sameBase = (code, base) => new RegExp(`^${base}\\d*$`).test(code || '');
  /** Pasang kode baru (bila jenis/fungsi berubah) dan cerminkan ke koleksi `devices`. Panggil di dalam transaksi. */
  function applyDeviceCode(dev, base, label, userId) {
    if (!sameBase(dev.code, base)) {
      const code = allocCode(base, dev.id);
      q.setDeviceCode.run(code, label, dev.id);
      q.reserveCode.run(code, dev.id, now());
    } else if (dev.name !== label) {
      q.setDeviceCode.run(dev.code, label, dev.id);
    }
    const d = q.deviceById.get(dev.id);
    writeRecord('devices', d.id, { code: d.code, name: d.name, user_id: userId, outlet_id: d.outlet_id, last_seen: d.last_seen }, userId);
    return d;
  }

  function broadcast() {
    const msg = `event: seq\ndata: ${JSON.stringify({ seq: store.state.seq })}\n\n`;
    for (const res of sseClients) res.write(msg);
  }

  // ---------- util HTTP ----------
  function send(res, status, body) {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(json);
  }
  class HttpError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  async function readJson(req, limit = 8 * 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const ch of req) {
      size += ch.length;
      if (size > limit) throw new HttpError(413, 'Data terlalu besar');
      chunks.push(ch);
    }
    if (!size) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(400, 'JSON tidak valid');
    }
  }
  function authUser(req, url) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
    const p = verifyToken(store.secret, token);
    if (!p) throw new HttpError(401, 'Sesi tidak valid, silakan masuk lagi');
    const u = q.userById.get(p.u);
    if (!u || !u.active) throw new HttpError(401, 'Akun tidak aktif');
    return { ...u, deviceId: p.d };
  }

  function normEmail(e) {
    const v = String(e || '').trim().toLowerCase();
    if (!v) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new HttpError(400, 'Format email tidak valid');
    return v;
  }
  const maskEmail = (e) => e.replace(/^(.{1,2})[^@]*(@.*)$/, '$1***$2');

  // ---------- konfigurasi email (SMTP), disimpan di server saja, tidak ikut sinkron ----------
  function emailConfig() {
    try { return JSON.parse(store.kvGet('smtp') || 'null'); } catch { return null; }
  }
  function publicEmailConfig() {
    const c = emailConfig();
    return c ? { host: c.host, port: c.port, user: c.user, from: c.from, fromName: c.fromName, hasPassword: !!c.pass, configured: !!(c.host && c.from) } : { configured: false };
  }
  function storeName() {
    const r = q.getRec.get('settings', 'toko');
    return r ? JSON.parse(r.data).store_name || 'Kasir Buket' : 'Kasir Buket';
  }

  function storeInfo(order) {
    const st = q.getRec.get('settings', 'toko');
    const s = st ? JSON.parse(st.data) : {};
    const out = order?.outlet_id ? q.getRec.get('outlets', order.outlet_id) : null;
    const o = out ? JSON.parse(out.data) : {};
    return { storeName: s.store_name || 'Kasir Buket', address: o.address || s.address || '' };
  }
  const notifier = createNotifier({
    store, sendMail: (cfg, msg) => sendMailFn(cfg, msg), smtpConfig: emailConfig, storeInfo,
    now: opts.now, delayMs: opts.notifyDelayMs ?? Number(process.env.NOTIFY_DELAY_MS ?? 15000),
  });

  function handleNotify(user, method, parts, body) {
    if (user.role !== 'owner') throw new HttpError(403, 'Khusus owner');
    const view = () => {
      const c = notifier.config();
      const smtp = emailConfig();
      return {
        enabled: c.enabled, leadMinutes: c.leadMinutes,
        contacts: Object.entries(c.contacts).map(([name, email]) => ({ name, email })),
        smtp: { configured: !!smtp?.host, from: smtp?.from || null },
        jobs: notifier.recent(30),
      };
    };
    if (method === 'GET') return view();
    if (method === 'POST' && parts[2] === 'test') return notifier.test(String(body.name || ''), !!body.cancel).catch((e) => { throw new HttpError(e.status || 502, e.status ? e.message : `Gagal mengirim: ${e.message}`); });
    if (method === 'POST') {
      const cur = notifier.config();
      const contacts = {};
      for (const c of Array.isArray(body.contacts) ? body.contacts : []) {
        const name = String(c?.name || '').trim();
        if (!name) continue;
        const email = normEmail(c.email);
        if (email) contacts[name] = email;
      }
      const lead = Number(body.leadMinutes ?? cur.leadMinutes);
      notifier.setConfig({
        enabled: typeof body.enabled === 'boolean' ? body.enabled : cur.enabled,
        leadMinutes: Number.isFinite(lead) ? Math.min(24 * 60, Math.max(15, Math.round(lead))) : 60,
        contacts,
      });
      notifier.reconcileAll();
      return view();
    }
    throw new HttpError(405, 'Metode tidak didukung');
  }

  // ---------- ongkir: kunci OpenRouteService disimpan di server saja ----------
  function geoConfig() {
    try { return JSON.parse(store.kvGet('geo') || 'null') || {}; } catch { return {}; }
  }
  async function routeKm(from, to) {
    const key = geoConfig().orsKey;
    const errors = [];
    if (key) {
      try { return { ...(await orsDistanceKm(from, to, { fetchFn, key, base: orsBase })), source: 'ors' }; }
      catch (e) { if (e.status === 400) throw e; errors.push(e.message); }
    }
    try { return { km: await roadDistanceKm(from, to, { fetchFn, base: osrmBase }), source: 'osrm' }; }
    catch (e) { if (e.status === 400) throw e; errors.push(`OSRM: ${e.message}`); }
    throw new HttpError(502, `Rute jalan tidak dapat dihitung (${errors.join('; ')}). Isi jarak km secara manual.`);
  }
  async function handleGeoConfig(user, method, parts, body) {
    if (user.role !== 'owner') throw new HttpError(403, 'Khusus owner');
    const view = () => { const k = geoConfig().orsKey || ''; return { hasOrsKey: !!k, keyHint: k ? `…${k.slice(-4)}` : '' }; };
    if (method === 'GET') return view();
    if (method === 'POST' && parts[2] === 'test') {
      const from = body.from;
      if (!from) throw new HttpError(400, 'Simpan lokasi toko dulu');
      const r = await routeKm(from, { lat: Number(from.lat) + 0.02, lng: Number(from.lng) + 0.02 });
      return { ok: true, ...r };
    }
    if (method === 'POST') {
      const k = String(body.orsKey ?? '').trim();
      if (k && !/^[A-Za-z0-9=_.-]{20,400}$/.test(k)) throw new HttpError(400, 'Format kunci OpenRouteService tidak dikenali');
      store.kvSet('geo', JSON.stringify({ ...geoConfig(), orsKey: k }));
      return view();
    }
    throw new HttpError(405, 'Metode tidak didukung');
  }

  function handleDeviceCode(user, body) {
    const dev = q.deviceById.get(user.deviceId);
    if (!dev) throw new HttpError(404, 'Perangkat tidak dikenal, silakan masuk ulang');
    const kind = String(body.kind || '').toUpperCase(), fn = String(body.fn || '').toUpperCase();
    if (!DEVICE_KIND[kind] || !DEVICE_FN[fn]) throw new HttpError(400, 'Jenis atau fungsi perangkat tidak dikenal');
    let d;
    store.tx(() => { d = applyDeviceCode(dev, kind + fn, `${DEVICE_KIND[kind]} ${DEVICE_FN[fn]}`, user.id); });
    broadcast();
    return { device: { id: d.id, code: d.code, name: d.name, outlet_id: d.outlet_id } };
  }

  async function handleForgot(body, req) {
    const ident = String(body.username || '').trim().toLowerCase();
    if (!ident) throw new HttpError(400, 'Isi username atau email');
    const cfg = emailConfig();
    if (!cfg?.host) throw new HttpError(503, 'Reset lewat email belum diaktifkan. Minta owner mengatur email di Pengaturan › Email, atau pakai skrip reset-password di komputer server.');
    const key = `${req.socket.remoteAddress}|${ident}`;
    if (forgotLimiter.blocked(key)) throw new HttpError(429, 'Terlalu sering meminta kode. Coba lagi 15 menit lagi.');
    forgotLimiter.fail(key);
    const u = ident.includes('@') ? q.userByEmail.get(ident) : q.userByName.get(ident);
    const generic = { ok: true, message: 'Jika akun terdaftar dan punya email, kode 6 digit sudah dikirim. Periksa juga folder Spam.' };
    if (!u || !u.active || !u.email) return generic;
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    q.putCode.run(u.id, crypto.createHash('sha256').update(code).digest('hex'), Date.now() + 15 * 60 * 1000);
    try {
      await sendMailFn(cfg, {
        to: u.email,
        subject: `Kode reset kata sandi ${storeName()}: ${code}`,
        text: `Halo ${u.name},\n\nKode untuk mengganti kata sandi akun "${u.username}" di ${storeName()}:\n\n    ${code}\n\nKode berlaku 15 menit. Jika Anda tidak meminta reset, abaikan email ini; kata sandi lama tetap berlaku.\n`,
      });
    } catch (e) {
      q.delCode.run(u.id);
      console.error('Kirim email reset gagal:', e.message);
      throw new HttpError(502, 'Email gagal dikirim. Owner perlu memeriksa Pengaturan › Email.');
    }
    return { ...generic, to: maskEmail(u.email) };
  }

  function handleReset(body) {
    const ident = String(body.username || '').trim().toLowerCase();
    const code = String(body.code || '').replace(/\D/g, '');
    const pw = String(body.password || '');
    if (pw.length < 6) throw new HttpError(400, 'Kata sandi baru minimal 6 karakter');
    const u = ident.includes('@') ? q.userByEmail.get(ident) : q.userByName.get(ident);
    const rec = u && q.getCode.get(u.id);
    const bad = new HttpError(400, 'Kode salah atau kedaluwarsa. Minta kode baru.');
    if (!rec || rec.expires_at < Date.now() || rec.attempts >= 5) { if (rec) q.delCode.run(u.id); throw bad; }
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(rec.code_hash))) { q.bumpCode.run(u.id); throw bad; }
    store.tx(() => {
      db.prepare('UPDATE users SET pass = ?, active = 1 WHERE id = ?').run(hashPassword(pw), u.id);
      q.delCode.run(u.id);
    });
    return { ok: true, username: u.username };
  }

  async function handleEmailConfig(user, method, parts, body) {
    if (user.role !== 'owner') throw new HttpError(403, 'Khusus owner');
    if (method === 'GET') return publicEmailConfig();
    if (method === 'POST' && parts[2] === 'test') {
      const cfg = emailConfig();
      if (!cfg?.host) throw new HttpError(400, 'Simpan pengaturan email dulu');
      const to = normEmail(body.to) || q.userById.get(user.id).email;
      if (!to) throw new HttpError(400, 'Isi email tujuan uji atau email akun owner');
      try {
        await sendMailFn(cfg, { to, subject: `Uji email ${storeName()}`, text: 'Pengaturan email Kasir Buket berhasil. Reset kata sandi lewat email sudah aktif.\n' });
      } catch (e) { throw new HttpError(502, `Gagal: ${e.message}`); }
      return { ok: true, to };
    }
    if (method === 'POST' || method === 'PATCH') {
      const cur = emailConfig() || {};
      const host = String(body.host ?? cur.host ?? '').trim();
      const next = {
        host,
        port: Number(body.port ?? cur.port ?? 465),
        user: String(body.user ?? cur.user ?? '').trim(),
        pass: body.pass ? String(body.pass).replace(/\s+/g, '') : cur.pass || '',
        from: normEmail(body.from ?? cur.from ?? body.user ?? '') || '',
        fromName: String(body.fromName ?? cur.fromName ?? storeName()).trim(),
      };
      if (!host) { store.kvSet('smtp', 'null'); return { configured: false }; }
      if (!next.from) throw new HttpError(400, 'Isi email pengirim');
      store.kvSet('smtp', JSON.stringify(next));
      return publicEmailConfig();
    }
    throw new HttpError(405, 'Metode tidak didukung');
  }

  // ---------- handler ----------
  function handleSetup(body) {
    if (q.countUsers.get().n > 0) throw new HttpError(409, 'Server sudah disiapkan');
    const { storeName, address = '', phone = '', ownerName, username, password, email = '' } = body;
    if (!storeName || !ownerName || !username || !password) throw new HttpError(400, 'Nama toko, nama pemilik, username, dan kata sandi wajib diisi');
    if (String(password).length < 6) throw new HttpError(400, 'Kata sandi minimal 6 karakter');
    const uname = String(username).trim().toLowerCase();
    store.tx(() => {
      const outletId = 'outlet-utama';
      writeRecord('outlets', outletId, { name: storeName, address, phone, code: 'U', active: true }, null);
      writeRecord('settings', 'toko', {
        store_name: storeName,
        address,
        phone,
        instagram: '',
        receipt_footer: 'Terima kasih telah berbelanja.\nSimpan struk ini untuk pengambilan pesanan.',
        payment_methods: ['Tunai', 'QRIS', 'Transfer', 'Debit', 'GoPay', 'OVO', 'Dana', 'ShopeePay'],
        expense_categories: [
          { name: 'Biaya operasional', biaya: true },
          { name: 'Ongkir kurir', biaya: true },
          { name: 'Gaji/upah', biaya: true },
          { name: 'Belanja bahan', biaya: false },
          { name: 'Setor ke pemilik', biaya: false },
        ],
        daily_capacity: 0,
        dp_min_percent: 50,
      }, null);
      const cats = ['Buket Bunga', 'Buket Uang', 'Buket Snack', 'Buket Wisuda', 'Bunga Papan', 'Add-on', 'Jasa'];
      cats.forEach((name, i) => writeRecord('categories', `cat-${i + 1}`, { name, sort: i + 1 }, null));
      const id = newId();
      q.insertUser.run(id, uname, ownerName, 'owner', hashPassword(password), outletId, now(), normEmail(email));
      mirrorUser(q.userById.get(id));
    });
    broadcast();
    return { ok: true };
  }

  function handleLogin(body, req) {
    const uname = String(body.username || '').trim().toLowerCase();
    const key = `${req.socket.remoteAddress}|${uname}`;
    if (limiter.blocked(key)) throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi 10 menit lagi.');
    const u = q.userByName.get(uname);
    if (!u || !u.active || !verifyPassword(body.password || '', u.pass)) {
      limiter.fail(key);
      throw new HttpError(401, 'Username atau kata sandi salah');
    }
    limiter.reset(key);
    let deviceId = ID_RE.test(body.deviceId || '') ? body.deviceId : newId();
    let dev = q.deviceById.get(deviceId);
    const { base, label } = deviceBase(body);
    const explicit = !!(body.deviceKind && body.deviceFn);
    store.tx(() => {
      if (!dev) {
        const code = allocCode(base, deviceId);
        q.insertDevice.run(deviceId, code, label, u.id, u.outlet_id, now(), now());
        q.reserveCode.run(code, deviceId, now());
      } else {
        q.touchDevice.run(now(), u.id, null, deviceId);
      }
      dev = q.deviceById.get(deviceId);
      // jenis/fungsi dipilih di layar masuk: kode ikut berubah bila berbeda (kode lama tetap dicadangkan)
      dev = explicit ? applyDeviceCode(dev, base, label, u.id) : dev;
      if (!explicit) writeRecord('devices', dev.id, { code: dev.code, name: dev.name, user_id: u.id, outlet_id: dev.outlet_id, last_seen: dev.last_seen }, u.id);
    });
    broadcast();
    const token = signToken(store.secret, { u: u.id, d: deviceId, r: u.role }, tokenDays);
    return {
      token,
      instanceId: store.instanceId,
      user: { id: u.id, name: u.name, username: u.username, role: u.role, outlet_id: u.outlet_id },
      device: { id: dev.id, code: dev.code, name: dev.name, outlet_id: dev.outlet_id },
    };
  }

  function handlePull(url) {
    const since = Math.max(0, Number(url.searchParams.get('since') || 0));
    const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit') || 500)));
    const rows = q.pull.all(since, limit);
    const changes = rows.map((r) => ({ c: r.c, id: r.id, seq: r.seq, del: !!r.del, data: JSON.parse(r.data) }));
    const cursor = changes.length ? changes[changes.length - 1].seq : since;
    return { changes, cursor, more: rows.length === limit, head: store.state.seq, instanceId: store.instanceId, serverTime: now() };
  }

  function handlePush(user, body) {
    const changes = Array.isArray(body.changes) ? body.changes : null;
    if (!changes) throw new HttpError(400, 'Format push salah');
    if (changes.length > 1000) throw new HttpError(413, 'Maksimal 1000 perubahan per kiriman');
    const results = [];
    store.tx(() => {
      for (const ch of changes) {
        const { c, id } = ch || {};
        const rule = RULES[c];
        if (!rule) { results.push({ c, id, error: 'Koleksi tidak dikenal' }); continue; }
        if (!ID_RE.test(String(id || ''))) { results.push({ c, id, error: 'ID tidak valid' }); continue; }
        if (!rule.write.includes(user.role)) { results.push({ c, id, error: 'Tidak punya izin' }); continue; }
        if (ch.del) {
          if (user.role !== 'owner') { results.push({ c, id, error: 'Hanya owner yang boleh menghapus' }); continue; }
          results.push({ c, id, seq: writeRecord(c, id, {}, user.id, true) });
          continue;
        }
        if (!ch.patch || typeof ch.patch !== 'object' || Array.isArray(ch.patch)) { results.push({ c, id, error: 'Patch tidak valid' }); continue; }
        let patch = Object.fromEntries(Object.entries(ch.patch).filter(([k]) => !SERVER_FIELDS.has(k)));
        const allowed = rule.fields?.[user.role];
        if (allowed) {
          if (!q.getRec.get(c, id)) { results.push({ c, id, error: 'Tidak punya izin membuat data ini' }); continue; }
          patch = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
        }
        results.push({ c, id, seq: writeRecord(c, id, patch, user.id) });
      }
    });
    if (results.some((r) => r.seq)) broadcast();
    for (const r of results) {
      if (r.c !== 'orders' || !r.seq) continue;
      try { notifier.reconcileById(r.id); } catch (e) { console.error('Notifikasi perangkai:', e.message); }
    }
    return { results, head: store.state.seq };
  }

  function handleUsers(user, method, parts, body) {
    if (user.role !== 'owner') throw new HttpError(403, 'Khusus owner');
    if (method === 'GET') return { users: q.listUsers.all() };
    if (method === 'POST') {
      const { name, username, password, role = 'kasir', outlet_id, email = '' } = body;
      if (!name || !username || !password) throw new HttpError(400, 'Nama, username, dan kata sandi wajib diisi');
      if (!ROLES.includes(role)) throw new HttpError(400, 'Peran tidak dikenal');
      if (String(password).length < 6) throw new HttpError(400, 'Kata sandi minimal 6 karakter');
      const uname = String(username).trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,32}$/.test(uname)) throw new HttpError(400, 'Username 3–32 karakter: huruf kecil, angka, titik, garis');
      if (q.userByName.get(uname)) throw new HttpError(409, 'Username sudah dipakai');
      const id = newId();
      store.tx(() => {
        q.insertUser.run(id, uname, name, role, hashPassword(password), outlet_id || 'outlet-utama', now(), normEmail(email));
        mirrorUser(q.userById.get(id));
      });
      broadcast();
      return { ok: true, id };
    }
    if (method === 'PATCH' && parts[2]) {
      const target = q.userById.get(parts[2]);
      if (!target) throw new HttpError(404, 'Pengguna tidak ditemukan');
      const sets = [];
      const vals = [];
      if (body.name) { sets.push('name = ?'); vals.push(String(body.name)); }
      if (body.role) {
        if (!ROLES.includes(body.role)) throw new HttpError(400, 'Peran tidak dikenal');
        if (target.id === user.id && body.role !== 'owner') throw new HttpError(400, 'Owner tidak bisa menurunkan perannya sendiri');
        sets.push('role = ?'); vals.push(body.role);
      }
      if (typeof body.active === 'boolean') {
        if (target.id === user.id && !body.active) throw new HttpError(400, 'Owner tidak bisa menonaktifkan dirinya sendiri');
        sets.push('active = ?'); vals.push(body.active ? 1 : 0);
      }
      if (body.password) {
        if (String(body.password).length < 6) throw new HttpError(400, 'Kata sandi minimal 6 karakter');
        sets.push('pass = ?'); vals.push(hashPassword(body.password));
      }
      if (body.outlet_id) { sets.push('outlet_id = ?'); vals.push(String(body.outlet_id)); }
      if (typeof body.email === 'string') { sets.push('email = ?'); vals.push(normEmail(body.email)); }
      if (!sets.length) return { ok: true };
      store.tx(() => {
        db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, target.id);
        mirrorUser(q.userById.get(target.id));
      });
      broadcast();
      return { ok: true };
    }
    throw new HttpError(405, 'Metode tidak didukung');
  }

  // ---------- file statis (aplikasi web) ----------
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  };
  function serveStatic(req, res, url) {
    const root = path.resolve(staticDir);
    let rel = decodeURIComponent(url.pathname);
    let file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(rel)) { res.writeHead(404); return res.end('Not found'); }
      file = path.join(root, 'index.html'); // SPA fallback
      if (!fs.existsSync(file)) { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Server Kasir Buket aktif. Aplikasi web belum dibangun (app/dist).'); }
    }
    const ext = path.extname(file);
    const immutable = rel.startsWith('/assets/');
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    try {
      const route = `${req.method} /${parts.slice(0, 3).join('/')}`;
      if (route === 'GET /api/health') return send(res, 200, { ok: true, version: VERSION, instanceId: store.instanceId, needsSetup: q.countUsers.get().n === 0, serverTime: now() });
      if (route === 'POST /api/setup') return send(res, 200, handleSetup(await readJson(req)));
      if (route === 'POST /api/auth/login') return send(res, 200, handleLogin(await readJson(req), req));
      if (route === 'POST /api/auth/forgot') return send(res, 200, await handleForgot(await readJson(req), req));
      if (route === 'POST /api/auth/reset') return send(res, 200, handleReset(await readJson(req)));
      const user = authUser(req, url);
      if (route === 'GET /api/auth/me') return send(res, 200, { user: { id: user.id, name: user.name, username: user.username, role: user.role, outlet_id: user.outlet_id }, device: q.deviceById.get(user.deviceId) || null });
      if (route === 'GET /api/sync/pull') return send(res, 200, handlePull(url));
      if (route === 'POST /api/sync/push') return send(res, 200, handlePush(user, await readJson(req)));
      if (route === 'GET /api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`retry: 3000\nevent: seq\ndata: ${JSON.stringify({ seq: store.state.seq })}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }
      if (route === 'POST /api/geo/expand') {
        const b = await readJson(req);
        try { return send(res, 200, await expandMapsUrl(b.url, fetchFn)); } catch (e) { throw new HttpError(e.status || 502, e.status ? e.message : 'Google Maps tidak dapat dihubungi dari server'); }
      }
      if (route === 'POST /api/geo/route') {
        const b = await readJson(req);
        try { return send(res, 200, await routeKm(b.from, b.to)); }
        catch (e) { throw e instanceof HttpError ? e : new HttpError(e.status === 400 ? 400 : 502, e.message || 'Layanan rute tidak dapat dihubungi'); }
      }
      if (parts[1] === 'geo-config') {
        try { return send(res, 200, await handleGeoConfig(user, req.method, parts, req.method === 'GET' ? {} : await readJson(req))); }
        catch (e) { throw e instanceof HttpError ? e : new HttpError(e.status === 400 ? 400 : 502, e.message); }
      }
      if (parts[1] === 'notify') return send(res, 200, await handleNotify(user, req.method, parts, req.method === 'GET' ? {} : await readJson(req)));
      if (route === 'POST /api/devices/code') return send(res, 200, handleDeviceCode(user, await readJson(req)));
      if (parts[1] === 'email-config') return send(res, 200, await handleEmailConfig(user, req.method, parts, req.method === 'GET' ? {} : await readJson(req)));
      if (parts[1] === 'users') return send(res, 200, handleUsers(user, req.method, parts, req.method === 'GET' ? {} : await readJson(req)));
      throw new HttpError(404, 'Endpoint tidak ditemukan');
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      return send(res, status, { error: status === 500 ? 'Kesalahan server' : e.message });
    }
  });

  const heartbeat = setInterval(() => { for (const r of sseClients) r.write(': ping\n\n'); }, 25000);
  const notifyTimer = opts.noNotifyTimer ? null : setInterval(() => { notifier.tick().catch((e) => console.error('Notifikasi:', e.message)); }, Number(process.env.NOTIFY_INTERVAL_MS || 5000));
  const runBackup = () => { try { backup(store, dataDir); } catch (e) { console.error('Backup gagal:', e.message); } };
  const backupTimer = opts.noBackup ? null : setInterval(runBackup, 24 * 3600 * 1000);
  if (!opts.noBackup) runBackup();
  server.on('close', () => { clearInterval(heartbeat); if (notifyTimer) clearInterval(notifyTimer); if (backupTimer) clearInterval(backupTimer); for (const r of sseClients) r.end(); });
  return { server, store, notifier };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || '0.0.0.0';
  const { server } = createServer();
  server.listen(port, host, () => console.log(`Kasir Buket server v${VERSION} berjalan di http://${host}:${port}`));
}
