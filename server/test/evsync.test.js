// Kalender event toko → Google Calendar owner: undangan sepanjang hari, RRULE event rutin, pembatalan, dan email pengingat H-7/H-3.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/index.js';
import { buildMessage } from '../src/smtp.js';

let srv, store, notifier, evsync, base, dir, owner, kasir, ownerId;
let clock = Date.parse('2026-11-15T03:00:00Z'); // Minggu 15 Nov 2026, 10.00 WIB
const mails = [];

const json = async (method, p, body, token) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const push = (changes, token = owner) => json('POST', '/api/sync/push', { changes }, token);
const ics = (m) => m.calendar.ics.replace(/\r\n /g, '');
async function flush() { let n; do { n = await notifier.tick(); } while (n > 0); }
const take = () => mails.splice(0, mails.length);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-evsync-'));
  ({ server: srv, store, notifier, evsync } = createServer({
    dataDir: dir, staticDir: path.join(dir, 'none'), noBackup: true, noNotifyTimer: true, notifyDelayMs: 0,
    now: () => clock, sendMail: async (cfg, msg) => { mails.push({ cfg, ...msg }); },
  }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  await json('POST', '/api/setup', { storeName: 'Buket Stabat', ownerName: 'Yuni Yati', username: 'yuniyati1', password: 'rahasia1' });
  owner = (await json('POST', '/api/auth/login', { username: 'yuniyati1', password: 'rahasia1', deviceId: 'dev-owner', deviceKind: 'K', deviceFn: 'O' })).body.token;
  await json('POST', '/api/users', { name: 'Tiara', username: 'tiara', password: 'tiara123', role: 'kasir' }, owner);
  kasir = (await json('POST', '/api/auth/login', { username: 'tiara', password: 'tiara123', deviceId: 'dev-tiara', deviceKind: 'H', deviceFn: 'K' })).body.token;
  ownerId = (await json('GET', '/api/users', null, owner)).body.users.find((u) => u.username === 'yuniyati1').id;
  await json('POST', '/api/email-config', { host: 'smtp.gmail.com', port: 465, user: 'buketstabat@gmail.com', pass: 'abcd efgh ijkl mnop', from: 'buketstabat@gmail.com', fromName: 'Buket Stabat' }, owner);
});
after(() => {
  srv.closeAllConnections?.();
  srv.close();
  store.db.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* boleh tertinggal */ }
});

const ev = (id, patch) => ({ c: 'events', id, patch });

test('kalender event: khusus owner, bawaan nonaktif, penerima = email owner + email tambahan', async () => {
  assert.equal((await json('GET', '/api/calsync', null, kasir)).status, 403);
  const g = await json('GET', '/api/calsync', null, owner);
  assert.equal(g.body.enabled, false);
  assert.deepEqual(g.body.remind, [7, 3]);
  await push([ev('ev26-guru', { date: '2026-11-23', end: '2026-11-25', name: 'Hari Guru Nasional (25 Nov)', kind: 'momen', note: 'Siapkan buket boneka.' })]);
  await flush();
  assert.equal(mails.length, 0, 'belum aktif: tidak ada email');
  await json('PATCH', `/api/users/${ownerId}`, { email: 'Yuni@Gmail.com' }, owner);
  assert.equal((await json('POST', '/api/calsync', { emails: ['bukan-email'] }, owner)).status, 400);
  const r = await json('POST', '/api/calsync', { enabled: true, emails: ['vano@gmail.com', 'VANO@gmail.com'], kinds: ['libur', 'lokal', 'momen', 'data'] }, owner);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.emails, ['vano@gmail.com']);
  assert.deepEqual(r.body.recipients, ['yuni@gmail.com', 'vano@gmail.com']);
  const pull = await json('GET', '/api/sync/pull?since=0', null, kasir);
  assert.ok(!JSON.stringify(pull.body).includes('vano@gmail.com'), 'email penerima tidak ikut sinkron');
});

test('undangan sepanjang hari, RRULE untuk event rutin, VALARM H-7/H-3; event lampau & kategori nonaktif dilewati', async () => {
  await flush();
  let m = take();
  assert.deepEqual(m.map((x) => x.to).sort(), ['vano@gmail.com', 'yuni@gmail.com'], 'event yang sudah ada ikut terkirim saat sinkron diaktifkan');
  const t = ics(m[0]);
  assert.match(t, /^DTSTART;VALUE=DATE:20261123$/m);
  assert.match(t, /^DTEND;VALUE=DATE:20261126$/m, 'DTEND eksklusif = hari sesudah 25 Nov');
  assert.match(t, /^TRIGGER:-P6DT16H$/m);
  assert.match(t, /^TRIGGER:-P2DT16H$/m);
  assert.match(t, /^TRANSP:TRANSPARENT$/m);
  assert.doesNotMatch(t, /RRULE/);
  assert.match(m[0].subject, /Kalender toko: Hari Guru Nasional/);
  assert.match(buildMessage({ from: 'buketstabat@gmail.com' }, m[0]), /filename="kalender-toko.ics"/);

  await push([
    ev('ev-gf', { date: '2026-07-31', end: '2026-08-02', name: 'National Girlfriend Day (1 Agu)', kind: 'momen', recurring: true }),
    ev('ev26-valentine', { date: '2026-02-12', end: '2026-02-15', name: 'Valentine', kind: 'momen' }),
    ev('ev-toko', { date: '2026-12-01', name: 'Stok opname', kind: 'toko' }),
  ]);
  await flush();
  m = take();
  assert.equal(m.length, 2, 'hanya Girlfriend Day (rutin); Valentine 2026 sudah lewat; kategori Toko tidak dipilih');
  assert.match(ics(m[0]), /^RRULE:FREQ=YEARLY$/m);
  assert.match(ics(m[0]), /^SUMMARY:National Girlfriend Day \(1 Agu\)$/m);
});

test('ubah event → pembaruan (SEQUENCE naik); tanpa perubahan isi → tidak ada email; hapus → CANCEL', async () => {
  await push([ev('ev26-guru', { note: 'Siapkan buket boneka & edelweiss.' })]);
  await flush();
  let m = take();
  assert.equal(m.length, 2);
  assert.match(ics(m[0]), /^SEQUENCE:1$/m);
  assert.match(m[0].subject, /^Diperbarui:/);
  await push([ev('ev26-guru', { updated_hint: 1 })]);
  await flush();
  assert.equal(take().length, 0, 'kolom yang tidak memengaruhi isi kalender tidak mengirim email');
  await push([ev('ev-gf', { deleted: true })]);
  await flush();
  m = take();
  assert.equal(m.length, 2);
  assert.equal(m[0].calendar.method, 'CANCEL');
  assert.match(m[0].subject, /^Dihapus dari kalender toko/);
});

test('email pengingat H-7 dan H-3 pukul 08.00 WIB, sekali saja per penerima', async () => {
  clock = Date.parse('2026-11-16T00:30:00Z'); // 07.30 WIB: belum waktunya
  assert.equal(evsync.remind(), 0);
  clock = Date.parse('2026-11-16T01:05:00Z'); // 08.05 WIB, H-7 dari 23 Nov
  assert.equal(evsync.remind(), 2);
  assert.equal(evsync.remind(), 0, 'tidak ganda');
  await flush();
  let m = take();
  assert.match(m[0].subject, /^Pengingat H-7: Hari Guru Nasional \(25 Nov\) \(Sen, 23 Nov 2026\)$/);
  assert.equal(m[0].calendar, undefined, 'pengingat = email biasa');
  assert.match(m[0].text, /edelweiss/);
  clock = Date.parse('2026-11-20T05:00:00Z'); // H-3, 12.00 WIB
  assert.equal(evsync.remind(), 2);
  await flush();
  m = take();
  assert.match(m[0].subject, /^Pengingat H-3:/);
  clock = Date.parse('2026-11-22T03:00:00Z');
  assert.equal(evsync.remind(), 0);
});

test('sinkron dimatikan → semua event aktif dihapus dari kalender penerima', async () => {
  const r = await json('POST', '/api/calsync', { enabled: false }, owner);
  assert.equal(r.body.active, 0);
  await flush();
  const m = take();
  assert.ok(m.length >= 2 && m.every((x) => x.calendar.method === 'CANCEL'));
  assert.ok(r.body.jobs.length > 0, 'riwayat pengiriman tampil');
});
