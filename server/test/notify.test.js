// Notifikasi perangkai (undangan kalender), rute OpenRouteService, dan susunan MIME undangan.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/index.js';
import { buildMessage } from '../src/smtp.js';
import { buildIcs, fold } from '../src/ics.js';

let srv, store, notifier, base, dir, owner, kasir;
let clock = Date.parse('2026-11-15T03:00:00Z'); // 10.00 WIB
const mails = [];
let failNext = 0;
const fetchLog = [];
let orsMode = 'ok';

const resp = (status, json) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => json, text: async () => JSON.stringify(json) });
async function fakeFetch(url, init = {}) {
  fetchLog.push({ url, init });
  if (url.startsWith('http://ors.test/v2/directions/driving-car')) {
    if (orsMode === 'quota') return resp(403, { error: 'Quota exceeded' });
    if (orsMode === 'down') return resp(503, { error: { message: 'Service unavailable' } });
    const body = JSON.parse(init.body);
    assert.equal(init.headers.Authorization, 'kunci-ors-uji-1234567890abcdef');
    assert.deepEqual(body.coordinates[0], [98.4497, 3.7536], 'urutan koordinat ORS = [lng, lat]');
    return resp(200, { routes: [{ summary: { distance: 7380, duration: 840 } }] });
  }
  if (url.startsWith('http://osrm.test/route/v1/driving/')) {
    if (orsMode === 'down') return resp(503, {});
    return resp(200, { code: 'Ok', routes: [{ distance: 9120 }] });
  }
  throw new Error('URL tak terduga ' + url);
}

const json = async (method, p, body, token) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const push = (changes, token = owner) => json('POST', '/api/sync/push', { changes }, token);
const ics = (m) => m.calendar.ics.replace(/\r\n /g, '');
const field = (m, k) => (ics(m).match(new RegExp(`^${k}[;:](.*)$`, 'm')) || [])[1];

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-notif-'));
  ({ server: srv, store, notifier } = createServer({
    dataDir: dir, staticDir: path.join(dir, 'none'), noBackup: true, noNotifyTimer: true, notifyDelayMs: 0,
    now: () => clock, fetch: fakeFetch, orsUrl: 'http://ors.test', osrmUrl: 'http://osrm.test',
    sendMail: async (cfg, msg) => { if (failNext > 0) { failNext--; throw new Error('SMTP sementara gagal'); } mails.push({ cfg, ...msg }); },
  }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  await json('POST', '/api/setup', { storeName: 'Buket Stabat', address: 'Jl. Proklamasi 1, Stabat', ownerName: 'Vano', username: 'vano', password: 'rahasia1' });
  owner = (await json('POST', '/api/auth/login', { username: 'vano', password: 'rahasia1', deviceId: 'dev-owner', deviceKind: 'K', deviceFn: 'K' })).body.token;
  await json('POST', '/api/users', { name: 'Tiara', username: 'tiara', password: 'tiara123', role: 'kasir' }, owner);
  kasir = (await json('POST', '/api/auth/login', { username: 'tiara', password: 'tiara123', deviceId: 'dev-tiara', deviceKind: 'H', deviceFn: 'K' })).body.token;
  await json('POST', '/api/email-config', { host: 'smtp.gmail.com', port: 465, user: 'buketstabat@gmail.com', pass: 'abcd efgh ijkl mnop', from: 'buketstabat@gmail.com', fromName: 'Buket Stabat' }, owner);
});
after(() => {
  srv.closeAllConnections?.();
  srv.close();
  store.db.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* boleh tertinggal */ }
});

const due = new Date(clock + 26 * 3600e3).toISOString(); // besok 12.00 WIB
const order = (id, extra = {}) => ({
  c: 'orders', id, patch: {
    no: `261115-KK${id.slice(-3)}`, outlet_id: 'outlet-utama', items: [{ name: 'Buket Mawar Merah', qty: 2, price: 150000, cost: 90000, discount: 0, note: 'mawar 20 tangkai' }],
    subtotal: 300000, item_discount: 0, order_discount: 0, extra_fee: 0, total: 300000, cost_total: 180000,
    fulfillment: 'ambil', due_at: due, customer_name: 'Rina', notes: 'Wrapping pink', card_message: 'Happy graduation, Rina!',
    production_status: 'antri', created_at: new Date(clock).toISOString(), florist: 'Nazra', ...extra,
  },
});

test('pengaturan notifikasi khusus owner; email perangkai tersimpan di server', async () => {
  assert.equal((await json('GET', '/api/notify', null, kasir)).status, 403);
  const r = await json('POST', '/api/notify', { leadMinutes: 90, contacts: [{ name: 'Nazra', email: 'Nazra@Gmail.com' }, { name: 'Fira', email: 'fira@gmail.com' }, { name: 'Mirna', email: '' }] }, owner);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.contacts, [{ name: 'Nazra', email: 'nazra@gmail.com' }, { name: 'Fira', email: 'fira@gmail.com' }]);
  assert.equal(r.body.leadMinutes, 90);
  assert.equal(r.body.smtp.configured, true);
  assert.equal((await json('POST', '/api/notify', { contacts: [{ name: 'X', email: 'bukan-email' }] }, owner)).status, 400);
  const pull = await json('GET', '/api/sync/pull?since=0', null, kasir);
  assert.ok(!JSON.stringify(pull.body).includes('nazra@gmail.com'), 'email perangkai tidak ikut sinkron ke perangkat');
});

test('ditunjuk → undangan REQUEST ke Gmail perangkai, jadwal = tenggat − 90 menit s.d. tenggat', async () => {
  await push([order('ord-001')]);
  assert.equal(await notifier.tick(), 1);
  const m = mails.at(-1);
  assert.equal(m.to, 'nazra@gmail.com');
  assert.match(m.subject, /^Tugas rangkai #KK001 · Diambil Sen, 16 Nov 2026 12:00 WIB$/);
  assert.equal(m.calendar.method, 'REQUEST');
  assert.equal(field(m, 'METHOD'), 'REQUEST');
  assert.equal(field(m, 'SEQUENCE'), '0');
  assert.equal(field(m, 'DTEND'), '20261116T050000Z', '12.00 WIB = 05.00 UTC');
  assert.equal(field(m, 'DTSTART'), '20261116T033000Z', '05.00 − 90 menit = 03.30 UTC');
  assert.match(field(m, 'UID'), /^kb-ord-001-[0-9a-f]{10}@kasir-buket$/);
  assert.match(ics(m), /ATTENDEE;CN="Nazra";.*:mailto:nazra@gmail\.com/);
  assert.match(ics(m), /ORGANIZER;CN="Buket Stabat":mailto:buketstabat@gmail\.com/);
  assert.match(m.text, /2× Buket Mawar Merah \(mawar 20 tangkai\)/);
  assert.ok(!/150\.000|300\.000|Rp/.test(m.text + ics(m)), 'tugas perangkai tanpa harga');
  assert.equal(await notifier.tick(), 0, 'tidak terkirim dua kali');
});

test('perubahan status produksi / pembayaran tidak mengirim email; ubah jadwal → undangan diperbarui (SEQUENCE naik)', async () => {
  const n = mails.length;
  await push([{ c: 'orders', id: 'ord-001', patch: { production_status: 'dirangkai' } }, { c: 'payments', id: 'pay-001', patch: { order_id: 'ord-001', amount: 300000, method: 'Tunai', kind: 'lunas', outlet_id: 'outlet-utama' } }]);
  assert.equal(await notifier.tick(), 0);
  assert.equal(mails.length, n);
  await push([{ c: 'orders', id: 'ord-001', patch: { due_at: new Date(clock + 28 * 3600e3).toISOString() } }]);
  await notifier.tick();
  const m = mails.at(-1);
  assert.equal(field(m, 'SEQUENCE'), '1');
  assert.equal(field(m, 'DTEND'), '20261116T070000Z');
  assert.match(m.subject, /^Diperbarui #KK001/);
});

test('pindah perangkai → CANCEL ke perangkai lama + REQUEST ke perangkai baru; batal → CANCEL', async () => {
  const n = mails.length;
  await push([{ c: 'orders', id: 'ord-001', patch: { florist: 'Fira' } }]);
  await notifier.tick();
  const [a, b] = mails.slice(n);
  assert.equal(a.to, 'nazra@gmail.com');
  assert.equal(a.calendar.method, 'CANCEL');
  assert.equal(field(a, 'STATUS'), 'CANCELLED');
  assert.equal(field(a, 'SEQUENCE'), '2');
  assert.match(a.subject, /^Dibatalkan: tugas rangkai #KK001/);
  assert.equal(b.to, 'fira@gmail.com');
  assert.equal(b.calendar.method, 'REQUEST');
  const uidNazra = field(a, 'UID'), uidFira = field(b, 'UID');
  assert.notEqual(uidNazra, uidFira);
  await push([{ c: 'orders', id: 'ord-001', patch: { void: true, void_reason: 'pelanggan batal', production_status: 'batal' } }]);
  await notifier.tick();
  const c = mails.at(-1);
  assert.equal(c.to, 'fira@gmail.com');
  assert.equal(c.calendar.method, 'CANCEL');
  assert.equal(field(c, 'UID'), uidFira, 'UID sama dengan undangan yang dibatalkan');
  assert.equal(field(c, 'SEQUENCE'), '1');
});

test('ganti perangkai sebelum email terkirim: perangkai pertama tidak menerima apa pun', async () => {
  const n = mails.length;
  await push([order('ord-002')]);
  await push([{ c: 'orders', id: 'ord-002', patch: { florist: 'Fira' } }]);
  await notifier.tick();
  const out = mails.slice(n);
  assert.deepEqual(out.map((m) => [m.to, m.calendar.method]), [['fira@gmail.com', 'REQUEST']]);
});

test('tanpa email (Mirna), pesanan lama, dan pesanan selesai tidak diberi undangan', async () => {
  const n = mails.length;
  await push([order('ord-003', { florist: 'Mirna' })]);
  await push([order('ord-004', { due_at: new Date(clock - 2 * 86400e3).toISOString(), created_at: new Date(clock - 3 * 86400e3).toISOString() })]);
  await push([order('ord-005', { production_status: 'selesai' })]);
  await notifier.tick();
  assert.equal(mails.length, n);
});

test('gagal kirim dicoba ulang dengan jeda; menambah email perangkai mengirim tugas yang sudah ada', async () => {
  failNext = 1;
  await json('POST', '/api/notify', { leadMinutes: 90, contacts: [{ name: 'Nazra', email: 'nazra@gmail.com' }, { name: 'Fira', email: 'fira@gmail.com' }, { name: 'Mirna', email: 'mirna@gmail.com' }] }, owner);
  assert.equal(await notifier.tick(), 0, 'percobaan pertama gagal');
  let jobs = (await json('GET', '/api/notify', null, owner)).body.jobs;
  const j = jobs.find((x) => x.email === 'mirna@gmail.com');
  assert.equal(j.status, 'pending');
  assert.equal(j.attempts, 1);
  assert.match(j.last_error, /sementara gagal/);
  clock += 31e3;
  assert.equal(await notifier.tick(), 1, 'terkirim setelah jeda 30 detik');
  assert.equal(mails.at(-1).to, 'mirna@gmail.com');
  jobs = (await json('GET', '/api/notify', null, owner)).body.jobs;
  assert.equal(jobs.find((x) => x.email === 'mirna@gmail.com').status, 'sent');
});

test('undangan uji & pembatalan uji', async () => {
  assert.equal((await json('POST', '/api/notify/test', { name: 'Tidak Ada' }, owner)).status, 400);
  assert.equal((await json('POST', '/api/notify/test', { name: 'Nazra' }, owner)).status, 200);
  assert.match(mails.at(-1).subject, /^\[UJI\]/);
  assert.equal(field(mails.at(-1), 'DTSTART'), '20261116T020000Z', 'besok 09.00 WIB');
  assert.equal((await json('POST', '/api/notify/test', { name: 'Nazra', cancel: true }, owner)).status, 200);
  assert.equal(mails.at(-1).calendar.method, 'CANCEL');
});

test('rute: tanpa kunci → OSRM; dengan kunci → OpenRouteService; kuota habis → OSRM; semua gagal → 502 (tanpa garis lurus)', async () => {
  const from = { lat: 3.7536, lng: 98.4497 }, to = { lat: 3.80, lng: 98.50 };
  let r = await json('POST', '/api/geo/route', { from, to }, kasir);
  assert.deepEqual([r.body.source, r.body.km], ['osrm', 9.12]);
  assert.equal((await json('POST', '/api/geo-config', { orsKey: 'x' }, owner)).status, 400);
  assert.equal((await json('POST', '/api/geo-config', { orsKey: 'kunci' }, kasir)).status, 403);
  const g = await json('POST', '/api/geo-config', { orsKey: 'kunci-ors-uji-1234567890abcdef' }, owner);
  assert.deepEqual(g.body, { hasOrsKey: true, keyHint: '…cdef' }, 'kunci tidak pernah dikirim balik utuh');
  r = await json('POST', '/api/geo/route', { from, to }, kasir);
  assert.deepEqual([r.body.source, r.body.km, r.body.minutes], ['ors', 7.38, 14]);
  orsMode = 'quota';
  r = await json('POST', '/api/geo/route', { from, to }, kasir);
  assert.equal(r.body.source, 'osrm');
  orsMode = 'down';
  r = await json('POST', '/api/geo/route', { from, to }, kasir);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /manual/);
  orsMode = 'ok';
  assert.equal((await json('POST', '/api/geo/route', { from: { lat: 99, lng: 0 }, to }, kasir)).status, 400);
});

test('MIME undangan: text/plain + text/calendar;method + lampiran .ics; baris ICS ≤ 75 oktet', () => {
  const ics = buildIcs({ method: 'REQUEST', uid: 'u1@x', sequence: 0, start: new Date(0), end: new Date(3600e3), summary: 'Rangkai, #KK001; uji', description: 'Baris 1\nKartu: "Selamat ulang tahun, sayang" '.repeat(4), organizer: { email: 'a@b.c', name: 'Toko' }, attendee: { email: 'd@e.f', name: 'Nazra' } });
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `baris terlalu panjang: ${line.length}`);
  assert.match(ics.replace(/\r\n /g, ''), /SUMMARY:Rangkai\\, #KK001\\; uji/);
  assert.equal(fold('é'.repeat(60)).split('\r\n ').every((l) => Buffer.byteLength(l) <= 75), true, 'UTF-8 tidak terpotong');
  const raw = buildMessage({ from: 'a@b.c', fromName: 'Toko' }, { to: 'd@e.f', subject: 'Tugas', text: 'halo', calendar: { method: 'REQUEST', ics } });
  assert.match(raw, /Content-Type: multipart\/mixed; boundary="mix-/);
  assert.match(raw, /Content-Type: multipart\/alternative; boundary="alt-/);
  assert.match(raw, /Content-Type: text\/calendar; charset=utf-8; method=REQUEST/);
  assert.match(raw, /Content-Disposition: attachment; filename="undangan.ics"/);
  assert.ok(!/^\./m.test(raw), 'tidak ada baris diawali titik (aman untuk DATA SMTP)');
});

test('pesanan lunas: Admin tidak bisa membatalkan langsung; pengajuan beralasan + email ke owner; owner memutus', async () => {
  const users = (await json('GET', '/api/users', null, owner)).body.users;
  await json('PATCH', `/api/users/${users.find((u) => u.username === 'vano').id}`, { email: 'vano@example.com' }, owner);
  await push([order('ord-020', { florist: '' }), { c: 'payments', id: 'pay-020', patch: { order_id: 'ord-020', amount: 300000, method: 'QRIS', kind: 'lunas', outlet_id: 'outlet-utama' } }]);
  let r = await push([{ c: 'orders', id: 'ord-020', patch: { void: true, production_status: 'batal' } }, { c: 'payments', id: 'pay-020', patch: { void: true } }], kasir);
  assert.match(r.body.results[0].error, /hanya bisa dibatalkan owner/);
  assert.match(r.body.results[1].error, /hanya bisa dibatalkan owner/);
  r = await push([{ c: 'orders', id: 'ord-020', patch: { cancel_request: { status: 'approved', reason: 'x' } } }], kasir);
  assert.match(r.body.results[0].error, /Hanya owner/);
  r = await push([{ c: 'orders', id: 'ord-020', patch: { cancel_request: { status: 'pending', reason: '  ' } } }], kasir);
  assert.match(r.body.results[0].error, /Alasan/);
  const n = mails.length;
  r = await push([{ c: 'orders', id: 'ord-020', patch: { cancel_request: { status: 'pending', reason: 'Pelanggan salah pilih warna', by: 'palsu', by_name: 'Palsu' } } }], kasir);
  assert.ok(r.body.results[0].seq);
  await new Promise((res) => setTimeout(res, 30));
  const m = mails.slice(n).find((x) => x.to === 'vano@example.com');
  assert.match(m.subject, /^Persetujuan pembatalan 261115-KK020 \(Rp 300\.000\)$/);
  assert.match(m.text, /Tiara mengajukan pembatalan/);
  assert.match(m.text, /Alasan: Pelanggan salah pilih warna/);
  const rec = (await json('GET', '/api/sync/pull?since=0&limit=2000', null, owner)).body.changes.filter((x) => x.id === 'ord-020').at(-1).data;
  assert.equal(rec.cancel_request.by_name, 'Tiara', 'pengaju diisi server, bukan dari klien');
  r = await push([{ c: 'orders', id: 'ord-020', patch: { void: true, production_status: 'batal', cancel_request: { ...rec.cancel_request, status: 'approved', decided_by_name: 'Vano' } } }, { c: 'payments', id: 'pay-020', patch: { void: true } }], owner);
  assert.ok(r.body.results.every((x) => x.seq), 'owner menyetujui: pesanan & pembayaran batal');
  // pesanan DP (belum lunas) tetap bisa dibatalkan Admin langsung
  await push([order('ord-021', { florist: '' }), { c: 'payments', id: 'pay-021', patch: { order_id: 'ord-021', amount: 100000, method: 'Tunai', kind: 'dp', outlet_id: 'outlet-utama' } }]);
  r = await push([{ c: 'orders', id: 'ord-021', patch: { void: true, production_status: 'batal', void_reason: 'batal' } }, { c: 'payments', id: 'pay-021', patch: { void: true } }], kasir);
  assert.ok(r.body.results.every((x) => x.seq));
});

test('belanja bahan & kalender event: hanya owner yang boleh menulis', async () => {
  assert.match((await push([{ c: 'purchases', id: 'bl-test1', patch: { date: '2026-11-16', item: 'Mawar', qty: 10, price: 5000, total: 50000 } }], kasir)).body.results[0].error, /izin/);
  assert.ok((await push([{ c: 'purchases', id: 'bl-test1', patch: { date: '2026-11-16', item: 'Mawar', qty: 10, price: 5000, total: 50000 } }])).body.results[0].seq);
  assert.ok((await push([{ c: 'events', id: 'ev-test', patch: { date: '2026-11-25', name: 'Hari Guru', kind: 'momen' } }])).body.results[0].seq);
  assert.match((await push([{ c: 'events', id: 'ev-test', patch: { name: 'x' } }], kasir)).body.results[0].error, /izin/);
});
