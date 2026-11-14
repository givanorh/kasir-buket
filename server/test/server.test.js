import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/index.js';

let srv, base, dir;
const json = async (method, p, body, token) => {
  const r = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-'));
  srv = createServer({ dataDir: dir, staticDir: path.join(dir, 'none') }).server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.closeAllConnections?.(); srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

let owner, kasir, perangkai;

test('setup awal hanya sekali', async () => {
  assert.equal((await json('GET', '/api/health')).body.needsSetup, true);
  const r = await json('POST', '/api/setup', { storeName: 'Buket Uji', ownerName: 'Vano', username: 'Vano', password: 'rahasia1' });
  assert.equal(r.status, 200);
  assert.equal((await json('POST', '/api/setup', { storeName: 'X', ownerName: 'Y', username: 'z', password: 'rahasia1' })).status, 409);
  assert.equal((await json('GET', '/api/health')).body.needsSetup, false);
});

test('login, kode perangkat unik, dan sandi salah ditolak', async () => {
  assert.equal((await json('POST', '/api/auth/login', { username: 'vano', password: 'salah' })).status, 401);
  const a = await json('POST', '/api/auth/login', { username: 'vano', password: 'rahasia1', deviceId: 'dev-kasir-1', deviceName: 'Tablet Kasir' });
  assert.equal(a.status, 200);
  owner = a.body.token;
  assert.equal(a.body.device.code, 'A');
  const b = await json('POST', '/api/auth/login', { username: 'vano', password: 'rahasia1', deviceId: 'dev-kasir-1' });
  assert.equal(b.body.device.code, 'A', 'perangkat sama mempertahankan kodenya');
});

test('owner membuat staf; staf tersalin ke koleksi staff', async () => {
  assert.equal((await json('POST', '/api/users', { name: 'Kasir 1', username: 'kasir1', password: 'kasir123', role: 'kasir' }, owner)).status, 200);
  assert.equal((await json('POST', '/api/users', { name: 'Perangkai 1', username: 'rangkai1', password: 'rangkai1', role: 'perangkai' }, owner)).status, 200);
  kasir = (await json('POST', '/api/auth/login', { username: 'kasir1', password: 'kasir123', deviceId: 'dev-kasir-2' })).body.token;
  const p = await json('POST', '/api/auth/login', { username: 'rangkai1', password: 'rangkai1', deviceId: 'dev-produksi' });
  perangkai = p.body.token;
  assert.equal(p.body.device.code, 'C');
  assert.equal((await json('POST', '/api/users', { name: 'X', username: 'xx1', password: 'xxxxxx' }, kasir)).status, 403);
  const pull = await json('GET', '/api/sync/pull?since=0', null, kasir);
  assert.equal(pull.body.changes.filter((c) => c.c === 'staff').length, 3);
});

test('push/pull: merge per kolom, nomor urut naik, izin per peran', async () => {
  const head0 = (await json('GET', '/api/sync/pull?since=0&limit=1', null, owner)).body.head;
  let r = await json('POST', '/api/sync/push', { changes: [{ c: 'products', id: 'p-001', patch: { name: 'Buket Mawar', price: 150000 } }] }, kasir);
  assert.match(r.body.results[0].error, /izin/);
  r = await json('POST', '/api/sync/push', { changes: [{ c: 'products', id: 'p-001', patch: { name: 'Buket Mawar', price: 150000, cost: 90000 } }] }, owner);
  assert.ok(r.body.results[0].seq > head0);
  r = await json('POST', '/api/sync/push', {
    changes: [{ c: 'orders', id: 'o-001', patch: { no: '251115-A001', total: 150000, production_status: 'antri', notes: 'pita merah' } }],
  }, kasir);
  assert.ok(r.body.results[0].seq);
  // perangkai hanya boleh mengubah kolom produksi; kolom lain dibuang
  r = await json('POST', '/api/sync/push', { changes: [{ c: 'orders', id: 'o-001', patch: { production_status: 'dirangkai', total: 1 } }] }, perangkai);
  assert.ok(r.body.results[0].seq);
  r = await json('POST', '/api/sync/push', { changes: [{ c: 'orders', id: 'o-baru', patch: { total: 5 } }] }, perangkai);
  assert.match(r.body.results[0].error, /izin/);
  const pull = await json('GET', `/api/sync/pull?since=${head0}`, null, kasir);
  const o = pull.body.changes.filter((c) => c.id === 'o-001').pop().data;
  assert.equal(o.production_status, 'dirangkai');
  assert.equal(o.total, 150000);
  assert.equal(o.notes, 'pita merah');
  const seqs = pull.body.changes.map((c) => c.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
});

test('SSE memberi tahu perubahan baru', async () => {
  const ac = new AbortController();
  const res = await fetch(`${base}/api/events?token=${encodeURIComponent(kasir)}`, { signal: ac.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = dec.decode((await reader.read()).value);
  assert.match(buf, /event: seq/);
  await json('POST', '/api/sync/push', { changes: [{ c: 'customers', id: 'cust-1', patch: { name: 'Bu Rina', phone: '0812' } }] }, kasir);
  buf = dec.decode((await reader.read()).value);
  assert.match(buf, /"seq":\d+/);
  ac.abort();
});

test('token palsu ditolak', async () => {
  assert.equal((await json('GET', '/api/sync/pull', null, owner.slice(0, -2) + 'xx')).status, 401);
});
