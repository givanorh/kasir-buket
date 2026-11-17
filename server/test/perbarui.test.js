import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listeningPids, safeNewFile } from '../../deploy/perbarui.mjs';

test('perbarui: PID server dibaca dari netstat tanpa bergantung bahasa Windows', () => {
  const out = [
    'Active Connections', '', '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1180',
    '  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       9412',
    '  TCP    [::]:8080              [::]:0                 MENDENGARKAN    9412',
    '  TCP    192.168.1.10:51234     104.18.2.3:8080        ESTABLISHED     7000', // koneksi keluar ke port 8080 milik orang lain
    '  TCP    127.0.0.1:8080         127.0.0.1:51300        ESTABLISHED     9412', // koneksi masuk, bukan soket dengar
    '  TCP    0.0.0.0:80800          0.0.0.0:0              LISTENING       5555',
  ].join('\r\n');
  assert.deepEqual(listeningPids(out, 8080), [9412]);
  assert.deepEqual(listeningPids(out, 9999), []);
});

test('perbarui: hanya berkas sumber baru yang ikut commit otomatis (repositori publik)', () => {
  for (const f of ['deploy/perbarui.mjs', 'deploy/perbarui.bat', 'app/src/lib/rules.ts', 'app/test/v18.test.ts', 'docs/PANDUAN.md', 'app/package.json', 'docs/gambar.png']) assert.equal(safeNewFile(f), true, f);
  for (const f of ['kasirpintar-ekspor.json', 'data/kasir.db', 'salinan.db', 'cadangan/kasir.db-wal', 'belanja-november.xlsx', 'pelanggan.csv', 'rahasia.env', 'kunci.pem', 'arsip.zip', 'app/ekspor-pelanggan.json', 'foto.png', 'catatan.txt', 'data/backups/x.js']) assert.equal(safeNewFile(f), false, f);
  assert.equal(safeNewFile('app/src/besar.ts', 3 * 1024 * 1024), false, 'berkas > 2 MB tidak ditambahkan otomatis');
  assert.equal(safeNewFile('deploy\\perbarui.mjs'), true, 'pemisah jalur Windows');
});
