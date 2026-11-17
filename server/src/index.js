// Server Kasir Buket
// - POST /api/setup, /api/auth/login, GET /api/auth/me
// - GET /api/sync/pull?since=N, POST /api/sync/push   (sinkron berbasis nomor urut/seq server)
// - GET /api/events?token=...                          (SSE: memberi tahu perangkat ada perubahan)
// - GET/POST/PATCH /api/users                          (khusus owner)
// - GET/POST /api/notify, POST /api/notify/test         (notifikasi & kalender perangkai, khusus owner)
// - GET/POST /api/calsync                               (kalender event toko ke Google Calendar owner, khusus owner)
// - GET/POST /api/geo-config, POST /api/geo/route       (ongkir: OpenRouteService, cadangan OSRM)
// - POST /api/auth/self-reset                         (kasir/perangkai: verifikasi email + HP + tanggal lahir, sandi baru dikirim ke email)
// - GET /api/devices, PATCH /api/devices/:id            (owner: daftar perangkat + riwayat login, ganti nama & kategori)
// - POST /api/devices/code                             (versi lama: owner mengubah jenis/fungsi perangkatnya sendiri)
// - selain /api: menyajikan aplikasi web (folder app/dist)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, backup } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken, createLimiter, sealPassword, openPassword } from './auth.js';
import { sendMail } from './smtp.js';
import { expandMapsUrl, roadDistanceKm, orsDistanceKm } from './geo.js';
import { createNotifier } from './notify.js';
import { createEventSync, KINDS as EV_KINDS } from './evsync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const VERSION = '1.10.1';

const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const ROLES = ['owner', 'kasir', 'perangkai'];
/**
 * Peran efektif akun (v1.10). Owner selalu tunggal. Pegawai boleh punya beberapa peran (Admin = kasir, Perangkai).
 * Kolom `role` = peran utama untuk izin server: kasir bila punya peran kasir (izin kasir mencakup izin perangkai), selain itu perangkai.
 */
export function rolesOf(u) {
  if (!u) return [];
  if (u.role === 'owner') return ['owner'];
  const rs = String(u.roles || '').split(',').map((r) => r.trim()).filter((r) => r === 'kasir' || r === 'perangkai');
  return rs.length ? [...new Set(rs)] : [u.role];
}
export const primaryRole = (roles) => (roles.includes('owner') ? 'owner' : roles.includes('kasir') ? 'kasir' : 'perangkai');
/** Normalkan masukan peran dari owner: ['owner'] atau gabungan kasir/perangkai (minimal satu). */
function parseRoles(body) {
  const raw = Array.isArray(body.roles) ? body.roles : body.role ? [body.role] : ['kasir'];
  const rs = [...new Set(raw.map((r) => String(r)))];
  if (rs.some((r) => !ROLES.includes(r))) return { error: 'Peran tidak dikenal' };
  if (rs.includes('owner')) return rs.length === 1 ? { roles: ['owner'] } : { error: 'Owner tidak bisa digabung dengan peran lain' };
  if (!rs.length) return { error: 'Pilih minimal satu peran: Admin atau Perangkai' };
  return { roles: ['kasir', 'perangkai'].filter((r) => rs.includes(r)) };
}
/** Username dari nama: kata pertama, huruf kecil a–z/angka, minimal 3 karakter. */
export function usernameFrom(name) {
  const first = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\s+/).find(Boolean) || 'staf';
  const base = first.replace(/[^a-z0-9]/g, '') || 'staf';
  return base.length >= 3 ? base.slice(0, 28) : `${base}${'staf'.slice(0, 3 - base.length)}`;
}
const RANGKAI = ['antri', 'dirangkai', 'siap'];
// Kode perangkat = jenis + fungsi, mis. KK = Komputer Kasir. Bila sudah dipakai perangkat lain: KK2, KK3, ...
export const DEVICE_KIND = { K: 'Komputer', H: 'HP', T: 'Tablet' };
export const DEVICE_FN = { K: 'Kasir', R: 'Ruang Rangkai', O: 'Owner' };
/** Fungsi awal perangkat baru mengikuti peran akun yang pertama masuk; owner bisa mengubahnya di Pengaturan > Perangkat. */
const ROLE_FN = { kasir: 'K', perangkai: 'R', owner: 'O' };

/** Ringkasan User-Agent untuk daftar perangkat, mis. "Chrome · Windows" atau "Aplikasi Android · SM-A546E". */
export function uaInfo(ua) {
  const s = String(ua || '').slice(0, 400);
  if (!s) return '';
  const android = s.match(/Android [\d.]+;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/);
  const model = android && !/^(K|wv|Mobile|Tablet|Linux)$/i.test(android[1].trim()) ? android[1].trim() : '';
  const os = /Android/.test(s) ? 'Android' : /iPad/.test(s) ? 'iPad' : /iPhone/.test(s) ? 'iPhone' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /CrOS/.test(s) ? 'ChromeOS' : /Linux/.test(s) ? 'Linux' : '';
  const br = /; wv\)/.test(s) ? 'Aplikasi Android' : /Edg(?:e|A|iOS)?\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /SamsungBrowser\//.test(s) ? 'Samsung Internet' : /Firefox\/|FxiOS/.test(s) ? 'Firefox'
    : /Chrome\/|CriOS/.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  const sys = [os && !(br === 'Aplikasi Android' && os === 'Android') ? os : '', model].filter(Boolean).join(' ');
  return [br, sys].filter(Boolean).join(' · ').replace(/[^\x20-\x7E·]/g, '').slice(0, 80);
}
/** Jenis perangkat dari User-Agent bila klien tidak mengirim hasil deteksinya. */
const uaKind = (ua) => (/iPad|Tablet|Android(?!.*Mobile)/.test(String(ua || '')) ? 'T' : /Mobi|Android|iPhone/.test(String(ua || '')) ? 'H' : 'K');

// Aturan tulis per koleksi. `fields` membatasi kolom yang boleh diubah peran tertentu.
// `read` (opsional) membatasi peran yang boleh menarik koleksi itu saat sinkron (mis. gaji hanya untuk owner).
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
  purchases: { write: ['owner'] },
  events: { write: ['owner'] },
  costs: { write: ['owner'], read: ['owner'] }, // gaji, THR, bonus, biaya operasional
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
  const selfResetLimiter = createLimiter(5, 15 * 60 * 1000); // per akun: 5 kali salah → kunci 15 menit
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
    listUsers: db.prepare('SELECT id, username, name, email, phone, birth_date, role, roles, active, outlet_id, created_at, (pw_view IS NOT NULL) AS can_view FROM users ORDER BY created_at'),
    setPwView: db.prepare('UPDATE users SET pw_view = ? WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (id, username, name, role, pass, active, outlet_id, created_at, email) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)'),
    setPersonal: db.prepare('UPDATE users SET phone = ?, birth_date = ? WHERE id = ?'),
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
    insertDevice: db.prepare('INSERT INTO devices (id, code, name, user_id, outlet_id, created_at, last_seen, ua, logins) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'),
    touchDevice: db.prepare('UPDATE devices SET last_seen = ?, user_id = ?, ua = COALESCE(?, ua), logins = logins + 1 WHERE id = ?'),
    listDevices: db.prepare(`SELECT d.id, d.code, d.name, d.user_id, d.outlet_id, d.created_at, d.last_seen, d.ua, d.logins, u.name AS user_name, u.role AS user_role
      FROM devices d LEFT JOIN users u ON u.id = d.user_id ORDER BY d.last_seen DESC`),
    addLogin: db.prepare('INSERT INTO logins (device_id, user_id, at, ua) VALUES (?, ?, ?, ?)'),
    trimLogins: db.prepare('DELETE FROM logins WHERE id <= (SELECT MAX(id) FROM logins) - 500'),
    recentLogins: db.prepare(`SELECT l.at, l.ua, l.device_id, d.code, d.name AS device_name, u.name AS user_name, u.role AS user_role
      FROM logins l LEFT JOIN devices d ON d.id = l.device_id LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT ?`),
    paidSum: db.prepare(`SELECT COALESCE(SUM(json_extract(data, '$.amount')), 0) AS s FROM records WHERE c = 'payments' AND del = 0
      AND json_extract(data, '$.order_id') = ? AND COALESCE(json_extract(data, '$.void'), 0) = 0`),
    owners: db.prepare("SELECT name, email FROM users WHERE role = 'owner' AND active = 1 AND email IS NOT NULL AND email != ''"),
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
    writeRecord('staff', u.id, { name: u.name, username: u.username, role: u.role, roles: rolesOf(u), active: !!u.active, outlet_id: u.outlet_id || null }, null);
  }

  /**
   * Kategori awal perangkat BARU, tanpa pilihan di layar masuk (v1.8).
   * Jenis: hasil deteksi klien (`deviceKind`, dari layar sentuh + ukuran layar), lalu nama (klien lama), lalu User-Agent.
   * Fungsi: `deviceFn`/nama dari klien versi lama, selain itu mengikuti peran akun (kasir = K, perangkai = R, owner = O).
   * Setelah terdaftar, kategori hanya berubah lewat owner (PATCH /api/devices/:id).
   */
  function deviceBase(body, role, ua) {
    let kind = String(body.deviceKind || '').toUpperCase();
    let fn = String(body.deviceFn || '').toUpperCase();
    const name = String(body.deviceName || '');
    if (!DEVICE_KIND[kind]) kind = /tablet|tab\b/i.test(name) ? 'T' : /\bhp\b|handphone|android|ponsel/i.test(name) ? 'H' : /komputer|\bpc\b|laptop/i.test(name) ? 'K' : uaKind(ua);
    if (!DEVICE_FN[fn]) fn = /rangkai|produksi|florist/i.test(name) ? 'R' : /owner|pemilik/i.test(name) ? 'O' : /kasir/i.test(name) ? 'K' : ROLE_FN[role] || 'K';
    return { base: kind + fn, label: `${DEVICE_KIND[kind]} ${DEVICE_FN[fn]}` };
  }
  /** Nama bawaan = "<Jenis> <Fungsi>" dari kode; nama lain berarti sudah diganti owner dan tidak boleh ditimpa. */
  const autoLabel = (code) => { const m = String(code || '').match(/^([KHT])([KRO])\d*$/); return m ? `${DEVICE_KIND[m[1]]} ${DEVICE_FN[m[2]]}` : null; };
  const deviceRecord = (d) => ({ code: d.code, name: d.name, user_id: d.user_id, outlet_id: d.outlet_id, last_seen: d.last_seen, ua: d.ua || '' });
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
  /**
   * Pasang kode baru (bila jenis/fungsi berubah) dan/atau nama, lalu cerminkan ke koleksi `devices`. Panggil di dalam transaksi.
   * `name` kosong = pakai nama bawaan; nama yang sudah diganti owner dipertahankan saat kategori berubah.
   */
  function applyDeviceCode(dev, base, label, userId, name) {
    const custom = dev.name && dev.name !== autoLabel(dev.code) && autoLabel(dev.code) !== null ? dev.name : null;
    const finalName = name !== undefined ? (String(name).trim() || label) : (custom || label);
    if (!sameBase(dev.code, base)) {
      const code = allocCode(base, dev.id);
      q.setDeviceCode.run(code, finalName, dev.id);
      q.reserveCode.run(code, dev.id, now());
    } else if (dev.name !== finalName) {
      q.setDeviceCode.run(dev.code, finalName, dev.id);
    }
    const d = q.deviceById.get(dev.id);
    writeRecord('devices', d.id, deviceRecord(d), userId);
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
  /** Nomor HP dibandingkan dalam bentuk 08…: spasi/tanda dibuang, awalan 62 / +62 menjadi 0. */
  const normPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.startsWith('62') ? `0${d.slice(2)}` : d.startsWith('8') ? `0${d}` : d; };
  function cleanPhone(p) {
    const d = normPhone(p);
    if (!d) return null;
    if (!/^0\d{8,13}$/.test(d)) throw new HttpError(400, 'Nomor HP tidak valid (contoh 0812xxxxxxxx)');
    return d;
  }
  function cleanBirth(b) {
    const v = String(b || '').trim();
    if (!v) return null;
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const d = m && new Date(`${v}T00:00:00Z`);
    if (!m || isNaN(d) || d.toISOString().slice(0, 10) !== v || Number(m[1]) < 1930 || d > new Date()) throw new HttpError(400, 'Tanggal lahir tidak valid');
    return v;
  }
  /** Sandi acak 10 karakter tanpa huruf/angka yang mirip (0/O, 1/l/I) agar mudah diketik dari email. */
  function newPassword() {
    const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let s = '';
    while (!(/[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s))) s = Array.from({ length: 10 }, () => abc[crypto.randomInt(abc.length)]).join('');
    return s;
  }

  /**
   * Reset sandi mandiri (Pengaturan › Reset Password, akun kasir/perangkai yang sedang masuk).
   * Verifikasi: email pribadi + No HP + tanggal lahir harus sama dengan data yang diisi owner di Pengaturan › Pengguna.
   * Sandi baru dibuat server dan dikirim ke email pribadi; sandi hanya diganti bila email terkirim.
   */
  async function handleSelfReset(user, body) {
    if (!['kasir', 'perangkai'].includes(user.role)) throw new HttpError(403, 'Owner mengganti sandi lewat “Lupa kata sandi?” di halaman masuk');
    const key = `self|${user.id}`;
    if (selfResetLimiter.blocked(key)) throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.');
    const u = q.userById.get(user.id);
    if (!u.email || !u.phone || !u.birth_date) {
      throw new HttpError(409, 'Data verifikasi Anda belum lengkap. Minta owner mengisi email pribadi, No HP, dan tanggal lahir Anda di Pengaturan › Pengguna › Data.');
    }
    const cfg = emailConfig();
    if (!cfg?.host) throw new HttpError(503, 'Email toko belum diatur owner (Pengaturan › Reset Password), jadi sandi baru belum bisa dikirim.');
    const email = String(body.email || '').trim().toLowerCase();
    const ok = email === u.email.toLowerCase() && normPhone(body.phone) === normPhone(u.phone) && String(body.birth_date || '').trim() === u.birth_date;
    if (!ok) {
      selfResetLimiter.fail(key);
      throw new HttpError(400, 'Data tidak cocok dengan yang tercatat. Periksa email, No HP, dan tanggal lahir.');
    }
    const pw = newPassword();
    try {
      await sendMailFn(cfg, {
        to: u.email,
        subject: `Kata sandi baru ${storeName()}`,
        text: `Halo ${u.name},\n\nKata sandi akun "${u.username}" di ${storeName()} sudah direset atas permintaan Anda dari menu Pengaturan › Reset Password.\n\nKata sandi baru:\n\n    ${pw}\n\nGunakan saat masuk berikutnya. Perangkat yang sedang masuk tidak ikut keluar. Bila Anda tidak meminta reset ini, segera hubungi owner.\n`,
      });
    } catch (e) {
      console.error('Kirim sandi baru gagal:', e.message);
      throw new HttpError(502, 'Email gagal dikirim, kata sandi lama tetap berlaku. Owner perlu memeriksa Pengaturan › Reset Password.');
    }
    store.tx(() => {
      // sandi dibuat server (bukan pilihan pengguna): tetap bisa dilihat owner lewat tombol Lihat
      db.prepare('UPDATE users SET pass = ?, pw_view = ? WHERE id = ?').run(hashPassword(pw), sealPassword(store.secret, pw), u.id);
      q.delCode.run(u.id);
    });
    selfResetLimiter.reset(key);
    return { ok: true, to: maskEmail(u.email) };
  }

  // ---------- konfigurasi email (SMTP), disimpan di server saja, tidak ikut sinkron ----------
  function emailConfig() {
    try { return JSON.parse(store.kvGet('smtp') || 'null'); } catch { return null; }
  }
  function publicEmailConfig() {
    const c = emailConfig();
    return c ? { host: c.host, port: c.port, user: c.user, from: c.from, fromName: c.fromName, hasPassword: !!c.pass, passLen: String(c.pass || '').length, configured: !!(c.host && c.from) } : { configured: false };
  }
  const isGmail = (host) => /(^|\.)gmail\.com$|googlemail\.com$/i.test(String(host || '').trim());
  /** App password Gmail = 16 huruf. Spasi/karakter tak terlihat hasil salin dibuang; selain 16 huruf ditolak dengan pesan jelas. */
  function cleanPass(host, pass) {
    const raw = String(pass || '');
    if (!isGmail(host)) return raw.replace(/\s+/g, '');
    const letters = raw.replace(/[^A-Za-z]/g, '');
    if (letters.length !== 16) {
      throw new HttpError(400, `Pass Email Toko untuk Gmail harus App Password 16 huruf (yang terisi ${letters.length} huruf). Sandi login Gmail biasa selalu ditolak Google; buat App Password di myaccount.google.com/apppasswords dari akun Gmail toko yang sama.`);
    }
    return letters;
  }
  /** Terjemahkan penolakan login Gmail (535 5.7.8 / 534 5.7.9) menjadi langkah perbaikan. */
  function smtpHint(cfg, message) {
    const m = String(message || '');
    if (isGmail(cfg.host) && /\b53[45]\b/.test(m)) {
      return `Google menolak login ${cfg.user}. Periksa: (1) Pass Email Toko adalah App Password 16 huruf, bukan sandi Gmail biasa; (2) App Password dibuat saat login sebagai ${cfg.user}, bukan akun lain; (3) Verifikasi 2 Langkah akun itu aktif; (4) App Password lama otomatis dicabut bila sandi Gmail diganti, jadi buat yang baru lalu Simpan. Pesan Google: ${m.replace(/^SMTP login \(periksa email & app password\) ditolak: /, '')}`;
    }
    return m;
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

  const evsync = createEventSync({ store, smtpConfig: emailConfig, storeName, now: opts.now });
  const evReconcileAll = () => { try { evsync.reconcileAll(); } catch (e) { console.error('Sinkron kalender event:', e.message); } };

  /** Kalender event toko → Google Calendar owner (email akun owner + email tambahan). */
  function handleCalsync(user, method, parts, body) {
    if (user.role !== 'owner') throw new HttpError(403, 'Khusus owner');
    const view = () => {
      const c = evsync.config();
      const smtp = emailConfig();
      return {
        enabled: c.enabled, emails: c.emails, kinds: c.kinds, remind: c.remind, owners: evsync.owners(), recipients: evsync.recipients(c),
        smtp: { configured: !!smtp?.host, from: smtp?.from || null }, active: evsync.activeCount(), jobs: evsync.recent(30),
      };
    };
    if (method === 'GET') return view();
    if (method === 'POST') {
      const cur = evsync.config();
      const emails = [];
      for (const e of Array.isArray(body.emails) ? body.emails : cur.emails) {
        const v = normEmail(e);
        if (v && !emails.includes(v)) emails.push(v);
      }
      if (emails.length > 10) throw new HttpError(400, 'Maksimal 10 email tambahan');
      const kinds = Array.isArray(body.kinds) ? body.kinds.filter((k) => EV_KINDS.includes(k)) : cur.kinds;
      evsync.setConfig({ enabled: typeof body.enabled === 'boolean' ? body.enabled : cur.enabled, emails, kinds });
      evReconcileAll();
      return view();
    }
    throw new HttpError(405, 'Metode tidak didukung');
  }

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

  /** Owner mengelola perangkat: daftar + riwayat login, ganti nama, ganti kategori (jenis/fungsi → kode nomor struk baru). */
  function handleDevices(user, method, parts, body) {
    if (user.role !== 'owner') throw new HttpError(403, 'Kategori dan nama perangkat diatur owner di Pengaturan › Perangkat');
    if (method === 'GET') {
      return {
        devices: q.listDevices.all().map((d) => ({ ...d, current: d.id === user.deviceId })),
        logins: q.recentLogins.all(Math.min(200, Math.max(1, Number(body?.limit) || 50))),
      };
    }
    // POST /api/devices/code (klien lama) = perangkat sendiri; PATCH /api/devices/:id = perangkat mana pun
    const id = method === 'POST' && parts[2] === 'code' ? user.deviceId : parts[2];
    if (!(method === 'PATCH' || (method === 'POST' && parts[2] === 'code'))) throw new HttpError(405, 'Metode tidak didukung');
    const dev = q.deviceById.get(id);
    if (!dev) throw new HttpError(404, 'Perangkat tidak dikenal');
    const cur = String(dev.code || '').match(/^([KHT])([KRO])\d*$/);
    const kind = String(body.kind || cur?.[1] || '').toUpperCase(), fn = String(body.fn || cur?.[2] || '').toUpperCase();
    const name = body.name === undefined ? undefined : String(body.name).replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 40);
    let d;
    if (!DEVICE_KIND[kind] || !DEVICE_FN[fn]) {
      // kode versi lama (mis. "B") tanpa kategori: hanya ganti nama yang diperbolehkan sampai owner memilih jenis & fungsi
      if (body.kind || body.fn || name === undefined) throw new HttpError(400, 'Jenis atau fungsi perangkat tidak dikenal');
      store.tx(() => { q.setDeviceCode.run(dev.code, name || dev.name || dev.code, dev.id); d = q.deviceById.get(dev.id); writeRecord('devices', d.id, deviceRecord(d), user.id); });
    } else {
      store.tx(() => { d = applyDeviceCode(dev, kind + fn, `${DEVICE_KIND[kind]} ${DEVICE_FN[fn]}`, user.id, name); });
    }
    broadcast();
    return { device: { id: d.id, code: d.code, name: d.name, outlet_id: d.outlet_id } };
  }

  async function handleForgot(body, req) {
    const ident = String(body.username || '').trim().toLowerCase();
    if (!ident) throw new HttpError(400, 'Isi username atau email');
    const cfg = emailConfig();
    if (!cfg?.host) throw new HttpError(503, 'Reset lewat email belum diaktifkan. Minta owner mengatur Email Reset di Pengaturan › Reset Password, atau pakai skrip reset-password di komputer server.');
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
      throw new HttpError(502, 'Email gagal dikirim. Owner perlu memeriksa Pengaturan › Reset Password.');
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
      db.prepare('UPDATE users SET pass = ?, active = 1, pw_view = NULL WHERE id = ?').run(hashPassword(pw), u.id); // sandi pilihan pengguna sendiri: tidak bisa dilihat owner
      q.delCode.run(u.id);
    });
    return { ok: true, username: u.username };
  }

  async function handleEmailConfig(user, method, parts, body) {
    if (user.role !== 'owner') throw new HttpError(403, 'Khusus owner');
    if (method === 'GET') return publicEmailConfig();
    if (method === 'POST' && parts[2] === 'test') {
      // uji memakai isian formulir yang sedang tampil (belum perlu disimpan), sisanya dari pengaturan tersimpan
      const saved = emailConfig() || {};
      const host = String(body.host || saved.host || '').trim();
      const userName = String(body.user || saved.user || '').trim().toLowerCase();
      const cfg = {
        ...saved, host, port: Number(body.port || saved.port || 465), user: userName,
        pass: body.pass ? cleanPass(host, body.pass) : saved.pass || '',
        from: normEmail(body.user || saved.from || saved.user || '') || '', fromName: String(body.fromName || saved.fromName || storeName()).trim(),
      };
      if (!cfg.host || !cfg.from) throw new HttpError(400, 'Isi Akun GMAIL Toko dan Pass Email Toko dulu');
      if (!cfg.pass) throw new HttpError(400, 'Pass Email Toko belum diisi');
      // tujuan: isian "Kirim ke" → email owner yang sedang masuk → email owner lain → Akun GMAIL Toko sendiri
      const me = q.userById.get(user.id);
      const otherOwner = db.prepare("SELECT email FROM users WHERE role = 'owner' AND active = 1 AND email IS NOT NULL AND email != '' ORDER BY created_at").get();
      const manual = normEmail(body.to);
      const to = manual || me?.email || otherOwner?.email || cfg.from;
      const via = manual ? 'manual' : me?.email || otherOwner?.email ? 'owner' : 'toko';
      try {
        await sendMailFn(cfg, { to, subject: `Uji email ${storeName()}`, text: 'Pengaturan email Kasir Buket berhasil. Reset kata sandi lewat email sudah aktif.\n' });
      } catch (e) { throw new HttpError(502, `Gagal: ${smtpHint(cfg, e.message)}`); }
      return { ok: true, to, via };
    }
    if (method === 'POST' || method === 'PATCH') {
      const cur = emailConfig() || {};
      const host = String(body.host ?? cur.host ?? '').trim();
      const next = {
        host,
        port: Number(body.port ?? cur.port ?? 465),
        user: String(body.user ?? cur.user ?? '').trim(),
        pass: body.pass ? cleanPass(host, body.pass) : cur.pass || '',
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
      q.setPwView.run(sealPassword(store.secret, password), id);
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
    const ua = uaInfo(req.headers['user-agent']);
    store.tx(() => {
      const ts = now();
      if (!dev) {
        // perangkat baru dikenali otomatis; kategori & nama selanjutnya hanya diubah owner
        const { base, label } = deviceBase(body, u.role, req.headers['user-agent']);
        const code = allocCode(base, deviceId);
        q.insertDevice.run(deviceId, code, label, u.id, u.outlet_id, ts, ts, ua);
        q.reserveCode.run(code, deviceId, ts);
      } else {
        q.touchDevice.run(ts, u.id, ua || null, deviceId);
      }
      q.addLogin.run(deviceId, u.id, ts, ua);
      q.trimLogins.run();
      dev = q.deviceById.get(deviceId);
      writeRecord('devices', dev.id, deviceRecord(dev), u.id);
    });
    broadcast();
    const token = signToken(store.secret, { u: u.id, d: deviceId, r: u.role }, tokenDays);
    return {
      token,
      instanceId: store.instanceId,
      user: { id: u.id, name: u.name, username: u.username, role: u.role, roles: rolesOf(u), outlet_id: u.outlet_id },
      device: { id: dev.id, code: dev.code, name: dev.name, outlet_id: dev.outlet_id },
    };
  }

  function handlePull(url, user) {
    const since = Math.max(0, Number(url.searchParams.get('since') || 0));
    const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit') || 500)));
    const rows = q.pull.all(since, limit);
    const canRead = (c) => !RULES[c]?.read || RULES[c].read.includes(user.role);
    const changes = rows.filter((r) => canRead(r.c)).map((r) => ({ c: r.c, id: r.id, seq: r.seq, del: !!r.del, data: JSON.parse(r.data) }));
    const cursor = rows.length ? rows[rows.length - 1].seq : since; // kursor tetap maju walau baris disaring
    return { changes, cursor, more: rows.length === limit, head: store.state.seq, instanceId: store.instanceId, serverTime: now() };
  }

  /** Pesanan lunas: Σ pembayaran sah ≥ total dan belum dibatalkan. */
  function fullyPaid(orderId) {
    const r = q.getRec.get('orders', orderId);
    if (!r || r.del) return false;
    const o = JSON.parse(r.data);
    return !o.void && o.total > 0 && Number(q.paidSum.get(orderId).s) >= o.total;
  }
  /** Aturan pembatalan untuk selain owner. Mengembalikan pesan galat bila ditolak. */
  /**
   * v1.10: status antri ⇄ dirangkai ⇄ siap hanya boleh diubah perangkai yang ditunjuk (florist_id).
   * Pesanan lama tanpa florist_id tetapi bernama perangkai: akun berperan perangkai. Tanpa perangkai: tunjuk dulu.
   * Pesanan Ready (fulfillment 'sekarang') lama yang masih di antrean tidak wajib ditunjuk.
   */
  function guardRangkai(c, id, patch, user) {
    if (c !== 'orders' || !('production_status' in patch)) return null;
    const row = q.getRec.get('orders', id);
    if (!row) return null; // pesanan baru dari checkout
    const cur = JSON.parse(row.data);
    const to = patch.production_status;
    if (to === cur.production_status || !RANGKAI.includes(to) || !RANGKAI.includes(cur.production_status)) return null;
    const o = { ...cur, ...patch };
    const roles = rolesOf(user);
    if (o.florist_id) return o.florist_id === user.id ? null : `Hanya ${o.florist || 'perangkai yang ditunjuk'} yang bisa mengubah status pesanan ini`;
    if (o.florist) return roles.includes('perangkai') ? null : 'Status antri/dirangkai dikonfirmasi perangkai yang ditunjuk';
    if (o.fulfillment === 'sekarang') return roles.includes('perangkai') || roles.includes('owner') ? null : 'Status antri/dirangkai dikonfirmasi perangkai';
    return 'Perangkai belum ditunjuk. Kasir atau owner perlu menunjuk perangkai dulu.';
  }

  function guardCancel(c, id, patch, user) {
    if (c === 'orders') {
      if ((patch.void === true || patch.production_status === 'batal') && fullyPaid(id)) return 'Pesanan lunas hanya bisa dibatalkan owner. Ajukan pembatalan beserta alasan.';
      if ('cancel_request' in patch && patch.cancel_request) {
        const cr = patch.cancel_request;
        if (cr.status !== 'pending') return 'Hanya owner yang boleh menyetujui atau menolak pembatalan';
        if (!String(cr.reason || '').trim()) return 'Alasan pembatalan wajib diisi';
        patch.cancel_request = { status: 'pending', reason: String(cr.reason).trim().slice(0, 500), by: user.id, by_name: user.name, at: now() };
      }
    }
    if (c === 'payments' && patch.void === true) {
      const r = q.getRec.get('payments', id);
      const p = r ? JSON.parse(r.data) : null;
      if (p && fullyPaid(p.order_id)) return 'Pembayaran pesanan lunas hanya bisa dibatalkan owner';
    }
    return null;
  }
  /** Email ke owner (yang punya email) saat Admin mengajukan pembatalan pesanan lunas. */
  function mailOwnersCancel(orderId) {
    const cfg = emailConfig();
    const r = q.getRec.get('orders', orderId);
    if (!cfg?.host || !r) return;
    const o = JSON.parse(r.data);
    const cr = o.cancel_request;
    if (!cr || cr.status !== 'pending') return;
    const rp = (n) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
    for (const ow of q.owners.all()) {
      sendMailFn(cfg, {
        to: ow.email,
        subject: `Persetujuan pembatalan ${o.no} (${rp(o.total)})`,
        text: `Halo ${ow.name},\n\n${cr.by_name} mengajukan pembatalan pesanan ${o.no} yang sudah lunas.\n\nPelanggan: ${o.customer_name || 'Umum'}\nTotal: ${rp(o.total)}\nItem: ${(o.items || []).map((i) => `${i.qty}x ${i.name}`).join(', ')}\nAlasan: ${cr.reason}\n\nBuka aplikasi › Pesanan untuk menyetujui atau menolak.\n\n${storeName()}\n`,
      }).catch((e) => console.error('Email persetujuan pembatalan gagal:', e.message));
    }
  }

  function handlePush(user, body) {
    const changes = Array.isArray(body.changes) ? body.changes : null;
    if (!changes) throw new HttpError(400, 'Format push salah');
    if (changes.length > 1000) throw new HttpError(413, 'Maksimal 1000 perubahan per kiriman');
    const results = [];
    const askOwner = [];
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
        const rk = guardRangkai(c, id, patch, user);
        if (rk) { results.push({ c, id, error: rk }); continue; }
        if (user.role !== 'owner') {
          const why = guardCancel(c, id, patch, user);
          if (why) { results.push({ c, id, error: why }); continue; }
          if (c === 'orders' && patch.cancel_request?.status === 'pending') askOwner.push(id);
        }
        results.push({ c, id, seq: writeRecord(c, id, patch, user.id) });
      }
    });
    if (results.some((r) => r.seq)) broadcast();
    for (const r of results) {
      if (r.c !== 'orders' || !r.seq) continue;
      try { notifier.reconcileById(r.id); } catch (e) { console.error('Notifikasi perangkai:', e.message); }
    }
    for (const r of results) {
      if (r.c !== 'events' || !r.seq) continue;
      try { evsync.reconcileById(r.id); } catch (e) { console.error('Sinkron kalender event:', e.message); }
    }
    for (const id of askOwner) mailOwnersCancel(id);
    return { results, head: store.state.seq };
  }

  function handleUsers(user, method, parts, body) {
    if (user.role !== 'owner') throw new HttpError(403, 'Khusus owner');
    if (method === 'GET' && parts[2] && parts[3] === 'password') {
      const target = q.userById.get(parts[2]);
      if (!target) throw new HttpError(404, 'Pengguna tidak ditemukan');
      const pw = target.pw_view ? openPassword(store.secret, target.pw_view) : null;
      if (pw === null) throw new HttpError(404, target.pw_view ? 'Sandi tidak bisa dibuka (kunci server berganti). Atur ulang lewat tombol Sandi.' : 'Sandi dipilih sendiri oleh pengguna atau dibuat sebelum v1.6, jadi tidak tersimpan. Atur ulang lewat tombol Sandi agar bisa dilihat.');
      return { password: pw };
    }
    if (method === 'GET') return { users: q.listUsers.all().map((u) => ({ ...u, roles: rolesOf(u), can_view: !!u.can_view })) };
    if (method === 'POST') {
      const { name, outlet_id, email = '', phone = '', birth_date = '' } = body;
      // generate: akun pegawai dibuat dari daftar Staff; username dari nama, sandi acak dibuat server (bisa dilihat owner)
      const gen = body.generate === true;
      let { username, password } = body;
      if (!String(name || '').trim()) throw new HttpError(400, 'Nama wajib diisi');
      if (gen) {
        if (!username) { const base = usernameFrom(name); username = base; for (let i = 2; q.userByName.get(username); i++) username = `${base}${i}`; }
        password = newPassword();
      }
      if (!username || !password) throw new HttpError(400, 'Nama, username, dan kata sandi wajib diisi');
      const pr = parseRoles(body);
      if (pr.error) throw new HttpError(400, pr.error);
      const role = primaryRole(pr.roles);
      if (String(password).length < 6) throw new HttpError(400, 'Kata sandi minimal 6 karakter');
      const uname = String(username).trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,32}$/.test(uname)) throw new HttpError(400, 'Username 3–32 karakter: huruf kecil, angka, titik, garis');
      if (q.userByName.get(uname)) throw new HttpError(409, 'Username sudah dipakai');
      const id = newId();
      store.tx(() => {
        q.insertUser.run(id, uname, String(name).trim(), role, hashPassword(password), outlet_id || 'outlet-utama', now(), normEmail(email));
        q.setPwView.run(sealPassword(store.secret, password), id);
        q.setPersonal.run(cleanPhone(phone), cleanBirth(birth_date), id);
        db.prepare('UPDATE users SET roles = ? WHERE id = ?').run(pr.roles.join(','), id);
        mirrorUser(q.userById.get(id));
      });
      broadcast();
      if (role === 'owner') evReconcileAll();
      return { ok: true, id, username: uname, roles: pr.roles, ...(gen ? { password } : {}) };
    }
    if (method === 'PATCH' && parts[2]) {
      const target = q.userById.get(parts[2]);
      if (!target) throw new HttpError(404, 'Pengguna tidak ditemukan');
      const sets = [];
      const vals = [];
      if (body.name) { sets.push('name = ?'); vals.push(String(body.name)); }
      if (body.role || Array.isArray(body.roles)) {
        const pr = parseRoles(body);
        if (pr.error) throw new HttpError(400, pr.error);
        if (target.id === user.id && !pr.roles.includes('owner')) throw new HttpError(400, 'Owner tidak bisa menurunkan perannya sendiri');
        sets.push('role = ?', 'roles = ?'); vals.push(primaryRole(pr.roles), pr.roles.join(','));
      }
      if (typeof body.active === 'boolean') {
        if (target.id === user.id && !body.active) throw new HttpError(400, 'Owner tidak bisa menonaktifkan dirinya sendiri');
        sets.push('active = ?'); vals.push(body.active ? 1 : 0);
      }
      if (body.password) {
        if (String(body.password).length < 6) throw new HttpError(400, 'Kata sandi minimal 6 karakter');
        sets.push('pass = ?', 'pw_view = ?'); vals.push(hashPassword(body.password), sealPassword(store.secret, body.password));
      }
      if (body.outlet_id) { sets.push('outlet_id = ?'); vals.push(String(body.outlet_id)); }
      if (typeof body.email === 'string') { sets.push('email = ?'); vals.push(normEmail(body.email)); }
      if (typeof body.phone === 'string') { sets.push('phone = ?'); vals.push(cleanPhone(body.phone)); }
      if (typeof body.birth_date === 'string') { sets.push('birth_date = ?'); vals.push(cleanBirth(body.birth_date)); }
      if (!sets.length) return { ok: true };
      store.tx(() => {
        db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, target.id);
        mirrorUser(q.userById.get(target.id));
      });
      broadcast();
      if (target.role === 'owner' || body.role === 'owner' || body.roles?.includes?.('owner')) evReconcileAll(); // email owner = penerima kalender event
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
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, ngrok-skip-browser-warning');
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
      if (route === 'GET /api/auth/me') return send(res, 200, { user: { id: user.id, name: user.name, username: user.username, role: user.role, roles: rolesOf(user), outlet_id: user.outlet_id }, device: q.deviceById.get(user.deviceId) || null });
      if (route === 'POST /api/auth/self-reset') return send(res, 200, await handleSelfReset(user, await readJson(req)));
      if (route === 'GET /api/sync/pull') return send(res, 200, handlePull(url, user));
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
      if (parts[1] === 'calsync') return send(res, 200, handleCalsync(user, req.method, parts, req.method === 'GET' ? {} : await readJson(req)));
      if (parts[1] === 'devices') return send(res, 200, handleDevices(user, req.method, parts, req.method === 'GET' ? { limit: url.searchParams.get('limit') } : await readJson(req)));
      if (parts[1] === 'email-config') return send(res, 200, await handleEmailConfig(user, req.method, parts, req.method === 'GET' ? {} : await readJson(req)));
      if (parts[1] === 'users') return send(res, 200, handleUsers(user, req.method, parts, req.method === 'GET' ? {} : await readJson(req)));
      throw new HttpError(404, 'Endpoint tidak ditemukan');
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      return send(res, status, { error: status === 500 ? 'Kesalahan server' : e.message });
    }
  });

  // Denyut SSE tiap 25 detik membawa nomor urut terakhir: klien tahu salurannya hidup (cukup polling 5 menit sekali)
  // dan langsung menarik data bila ada perubahan yang terlewat. Klien lama mengabaikan seq yang tidak lebih besar dari kursornya.
  const heartbeat = setInterval(() => {
    const msg = `event: seq\ndata: ${JSON.stringify({ seq: store.state.seq, beat: true })}\n\n`;
    for (const r of sseClients) r.write(msg);
  }, Number(process.env.SSE_BEAT_MS || 25000));
  const notifyTimer = opts.noNotifyTimer ? null : setInterval(() => {
    try { evsync.remind(); } catch (e) { console.error('Pengingat kalender:', e.message); }
    notifier.tick().catch((e) => console.error('Notifikasi:', e.message));
  }, Number(process.env.NOTIFY_INTERVAL_MS || 5000));
  const runBackup = () => { try { backup(store, dataDir); } catch (e) { console.error('Backup gagal:', e.message); } };
  const backupTimer = opts.noBackup ? null : setInterval(runBackup, 24 * 3600 * 1000);
  if (!opts.noBackup) runBackup();
  server.on('close', () => { clearInterval(heartbeat); if (notifyTimer) clearInterval(notifyTimer); if (backupTimer) clearInterval(backupTimer); for (const r of sseClients) r.end(); });
  return { server, store, notifier, evsync };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || '0.0.0.0';
  const { server } = createServer();
  server.listen(port, host, () => console.log(`Kasir Buket server v${VERSION} berjalan di http://${host}:${port}`));
}
