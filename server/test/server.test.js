import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/index.js';

let srv, store, base, dir;
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
  ({ server: srv, store } = createServer({ dataDir: dir, staticDir: path.join(dir, 'none'), noBackup: true }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => {
  smtp?.close();
  srv.closeAllConnections?.();
  srv.close();
  store.db.close(); // Windows tidak bisa menghapus berkas yang masih terbuka
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* folder sementara, boleh tertinggal */ }
});

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

// ---------- reset kata sandi lewat email (SMTP palsu di localhost) ----------
import net from 'node:net';
const mails = [];
let smtp, smtpPort;
function startFakeSmtp() {
  return new Promise((resolve) => {
    smtp = net.createServer((sock) => {
      let data = false, buf = '', msg = '', auth = [];
      const w = (s) => sock.write(s + '\r\n');
      w('220 fake ESMTP');
      sock.on('data', (d) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (data) {
            if (line === '.') { data = false; mails.push({ raw: msg, auth }); w('250 OK queued'); } else msg += line + '\n';
            continue;
          }
          if (/^EHLO/.test(line)) { sock.write('250-fake\r\n250 AUTH LOGIN\r\n'); }
          else if (line === 'AUTH LOGIN') w('334 VXNlcm5hbWU6');
          else if (auth.length < 2 && /^[A-Za-z0-9+/=]+$/.test(line) && !/^(MAIL|RCPT|DATA|QUIT)/.test(line)) { auth.push(Buffer.from(line, 'base64').toString()); w(auth.length === 1 ? '334 UGFzc3dvcmQ6' : (auth[1] === 'apppass' ? '235 ok' : '535 bad')); }
          else if (/^MAIL FROM/.test(line) || /^RCPT TO/.test(line)) w('250 OK');
          else if (line === 'DATA') { data = true; msg = ''; w('354 go'); }
          else if (line === 'QUIT') { w('221 bye'); sock.end(); }
        }
      });
    }).listen(0, '127.0.0.1', () => { smtpPort = smtp.address().port; resolve(); });
  });
}
const lastCode = () => {
  const raw = mails[mails.length - 1].raw;
  const body = Buffer.from(raw.split('\n\n').slice(1).join('').replace(/\s/g, ''), 'base64').toString();
  return body.match(/\b(\d{6})\b/)[1];
};

test('health & login membawa instanceId yang konsisten', async () => {
  const h = (await json('GET', '/api/health')).body;
  assert.match(h.instanceId, /^[0-9a-f]{16}$/);
  const l = await json('POST', '/api/auth/login', { username: 'kasir1', password: 'kasir123', deviceId: 'dev-kasir-2' });
  assert.equal(l.body.instanceId, h.instanceId);
});

test('lupa sandi: belum diatur → 503; konfigurasi email khusus owner', async () => {
  assert.equal((await json('POST', '/api/auth/forgot', { username: 'vano' })).status, 503);
  assert.equal((await json('GET', '/api/email-config', null, kasir)).status, 403);
  await startFakeSmtp();
  const r = await json('POST', '/api/email-config', { host: '127.0.0.1', port: smtpPort, user: 'toko@gmail.com', pass: 'app pass', from: 'toko@gmail.com', fromName: 'Buket Uji' }, owner);
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, true);
  assert.equal(r.body.hasPassword, true);
  assert.equal(r.body.pass, undefined, 'kata sandi SMTP tidak pernah dikirim balik');
  assert.equal((await json('PATCH', `/api/users/${(await json('GET', '/api/users', null, owner)).body.users.find((u) => u.username === 'vano').id}`, { email: 'Vano@Example.com' }, owner)).status, 200);
  const t = await json('POST', '/api/email-config/test', {}, owner);
  assert.equal(t.status, 200);
  assert.equal(t.body.to, 'vano@example.com');
  assert.deepEqual(mails[0].auth, ['toko@gmail.com', 'apppass'], 'spasi app password Gmail dibuang');
});

test('lupa sandi: kode 6 digit via email, salah ditolak, benar mengganti sandi sekali pakai', async () => {
  const unknown = await json('POST', '/api/auth/forgot', { username: 'tidakada' });
  assert.equal(unknown.status, 200, 'respons generik untuk akun tak dikenal');
  assert.equal(unknown.body.to, undefined);
  const before = mails.length;
  const f = await json('POST', '/api/auth/forgot', { username: 'vano' });
  assert.equal(f.status, 200);
  assert.equal(f.body.to, 'va***@example.com');
  assert.equal(mails.length, before + 1);
  assert.match(mails.at(-1).raw, /Subject: =\?UTF-8\?B\?|Subject: Kode reset/);
  const code = lastCode();
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
  assert.equal((await json('POST', '/api/auth/reset', { username: 'vano', code: wrong, password: 'sandiBaru1' })).status, 400);
  assert.equal((await json('POST', '/api/auth/reset', { username: 'vano', code, password: '123' })).status, 400, 'sandi terlalu pendek');
  const ok = await json('POST', '/api/auth/reset', { username: 'vano', code, password: 'sandiBaru1' });
  assert.equal(ok.status, 200);
  assert.equal((await json('POST', '/api/auth/reset', { username: 'vano', code, password: 'lainlagi1' })).status, 400, 'kode tidak bisa dipakai ulang');
  assert.equal((await json('POST', '/api/auth/login', { username: 'vano', password: 'rahasia1' })).status, 401);
  assert.equal((await json('POST', '/api/auth/login', { username: 'vano', password: 'sandiBaru1', deviceId: 'dev-kasir-1' })).status, 200);
  // lewat email juga bisa
  assert.equal((await json('POST', '/api/auth/forgot', { username: 'vano@example.com' })).body.to, 'va***@example.com');
  smtp.close();
});
