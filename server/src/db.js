// Lapisan penyimpanan: SQLite bawaan Node (node:sqlite), tanpa dependensi eksternal.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'kasir.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS records (
      c TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      seq INTEGER NOT NULL,
      del INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      PRIMARY KEY (c, id)
    );
    CREATE INDEX IF NOT EXISTS records_seq ON records(seq);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      pass TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      outlet_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT,
      user_id TEXT,
      outlet_id TEXT,
      created_at TEXT NOT NULL,
      last_seen TEXT
    );
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS reset_codes (
      user_id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
    -- kode perangkat yang pernah dipakai (termasuk kode lama) agar nomor struk tidak pernah bentrok
    CREATE TABLE IF NOT EXISTS device_codes (
      code TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    -- undangan kalender yang pernah dikirim ke perangkai, satu baris per (pesanan, email)
    CREATE TABLE IF NOT EXISTS cal_events (
      order_id TEXT NOT NULL,
      email TEXT NOT NULL,
      florist TEXT,
      uid TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      hash TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      sent INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (order_id, email)
    );
    -- antrean email notifikasi (dikirim berurutan, dicoba ulang dengan jeda bertambah)
    CREATE TABLE IF NOT EXISTS notify_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      email TEXT NOT NULL,
      florist TEXT,
      label TEXT,
      kind TEXT NOT NULL,
      seq INTEGER NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_at INTEGER NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS notify_jobs_due ON notify_jobs(status, next_at);
  `);
  // migrasi: kolom email pengguna (untuk reset kata sandi lewat email)
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT');
  // migrasi: daftarkan kode perangkat yang sudah ada sebagai kode terpakai
  db.exec('INSERT OR IGNORE INTO device_codes (code, device_id, created_at) SELECT code, id, created_at FROM devices');

  const kvGet = db.prepare('SELECT v FROM kv WHERE k = ?');
  const kvSet = db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
  let secret = kvGet.get('secret')?.v;
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    kvSet.run('secret', secret);
  }

  // ID unik server: berubah hanya bila basis data baru dibuat. Klien memakainya untuk mendeteksi pergantian server.
  let instanceId = kvGet.get('instance_id')?.v;
  if (!instanceId) {
    instanceId = crypto.randomBytes(8).toString('hex');
    kvSet.run('instance_id', instanceId);
  }

  const maxSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM records').get().m;

  return {
    db,
    secret: process.env.SECRET || secret,
    instanceId,
    state: { seq: Number(maxSeq) },
    kvGet: (k) => kvGet.get(k)?.v ?? null,
    kvSet: (k, v) => kvSet.run(k, String(v)),
    tx(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/** Cadangan harian: VACUUM INTO menghasilkan salinan konsisten tanpa menghentikan server. */
export function backup(store, dataDir, keep = 14) {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13); // YYYYMMDDTHHmm
  const file = path.join(dir, `kasir-${stamp}.db`);
  if (fs.existsSync(file)) return file;
  store.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const files = fs.readdirSync(dir).filter((f) => /^kasir-.*\.db$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(dir, f));
  return file;
}
