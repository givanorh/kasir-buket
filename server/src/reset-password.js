// Pemulihan akun dari komputer server (tanpa perlu login).
//   node server/src/reset-password.js                      -> daftar pengguna
//   node server/src/reset-password.js <username> <sandi>   -> ganti kata sandi & aktifkan akun
// Folder data: env DATA_DIR, atau otomatis <proyek>/data (dipakai jalankan-lokal-windows.bat), atau server/data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPassword } from './auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [process.env.DATA_DIR, path.resolve(here, '../../data'), path.resolve(here, '../data')].filter(Boolean);
const dataDir = candidates.find((d) => fs.existsSync(path.join(d, 'kasir.db')));
if (!dataDir) {
  console.error('Basis data tidak ditemukan. Dicari di:\n  ' + candidates.join('\n  '));
  process.exit(1);
}

const { db } = openDb(dataDir);
const [, , username, password] = process.argv;
console.log(`Basis data: ${path.join(dataDir, 'kasir.db')}`);

if (!username) {
  const users = db.prepare('SELECT username, name, role, active FROM users ORDER BY created_at').all();
  const n = db.prepare("SELECT COUNT(*) AS n FROM records WHERE c = 'orders'").get().n;
  console.log(`Jumlah transaksi tersimpan: ${n}`);
  console.log('Pengguna:');
  for (const u of users) console.log(`  ${u.username}  (${u.name}, ${u.role}${u.active ? '' : ', NONAKTIF'})`);
  console.log('\nGanti kata sandi: node server/src/reset-password.js <username> <kata-sandi-baru>');
  process.exit(0);
}

if (!password || String(password).length < 6) {
  console.error('Kata sandi baru minimal 6 karakter.');
  process.exit(1);
}
const u = db.prepare('SELECT id FROM users WHERE username = ?').get(String(username).trim().toLowerCase());
if (!u) {
  console.error(`Username "${username}" tidak ada. Jalankan tanpa argumen untuk melihat daftar pengguna.`);
  process.exit(1);
}
db.prepare('UPDATE users SET pass = ?, active = 1 WHERE id = ?').run(hashPassword(password), u.id);
console.log(`Kata sandi "${username}" sudah diganti. Silakan login dengan kata sandi baru.`);
