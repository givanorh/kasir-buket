import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, uaInfo } from '../src/index.js';

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

test('login, kode perangkat bermakna & unik, dan sandi salah ditolak', async () => {
  assert.equal((await json('POST', '/api/auth/login', { username: 'vano', password: 'salah' })).status, 401);
  const a = await json('POST', '/api/auth/login', { username: 'vano', password: 'rahasia1', deviceId: 'dev-kasir-1', deviceKind: 'K', deviceFn: 'K' });
  assert.equal(a.status, 200);
  owner = a.body.token;
  assert.equal(a.body.device.code, 'KK');
  assert.equal(a.body.device.name, 'Komputer Kasir');
  const b = await json('POST', '/api/auth/login', { username: 'vano', password: 'rahasia1', deviceId: 'dev-kasir-1' });
  assert.equal(b.body.device.code, 'KK', 'perangkat sama mempertahankan kodenya');
  const old = await json('POST', '/api/auth/login', { username: 'vano', password: 'rahasia1', deviceId: 'dev-lama-1', deviceName: 'Tablet Kasir' });
  assert.equal(old.body.device.code, 'TK', 'aplikasi versi lama: jenis ditebak dari nama perangkat');
  const twin = await json('POST', '/api/auth/login', { username: 'vano', password: 'rahasia1', deviceId: 'dev-kasir-3', deviceKind: 'K', deviceFn: 'K' });
  assert.equal(twin.body.device.code, 'KK2', 'komputer kasir kedua mendapat KK2');
});

test('ubah jenis/fungsi perangkat: kode baru, kode lama tidak diberikan ke perangkat lain', async () => {
  const t = (await json('POST', '/api/auth/login', { username: 'vano', password: 'rahasia1', deviceId: 'dev-kasir-3', deviceKind: 'K', deviceFn: 'K' })).body.token;
  assert.equal((await json('POST', '/api/devices/code', { kind: 'X', fn: 'K' }, t)).status, 400);
  const r = await json('POST', '/api/devices/code', { kind: 'T', fn: 'K' }, t);
  assert.equal(r.status, 200);
  assert.equal(r.body.device.code, 'TK2', 'TK sudah dipakai tablet lain');
  const n = await json('POST', '/api/auth/login', { username: 'vano', password: 'rahasia1', deviceId: 'dev-kasir-4', deviceKind: 'K', deviceFn: 'K' });
  assert.equal(n.body.device.code, 'KK3', 'KK2 dicadangkan untuk perangkat yang dulu memakainya');
  const back = await json('POST', '/api/devices/code', { kind: 'K', fn: 'K' }, t);
  assert.equal(back.body.device.code, 'KK2', 'perangkat boleh kembali ke kode lamanya sendiri');
});

test('owner membuat staf; staf tersalin ke koleksi staff', async () => {
  assert.equal((await json('POST', '/api/users', { name: 'Kasir 1', username: 'kasir1', password: 'kasir123', role: 'kasir' }, owner)).status, 200);
  assert.equal((await json('POST', '/api/users', { name: 'Perangkai 1', username: 'rangkai1', password: 'rangkai1', role: 'perangkai' }, owner)).status, 200);
  kasir = (await json('POST', '/api/auth/login', { username: 'kasir1', password: 'kasir123', deviceId: 'dev-kasir-2' })).body.token;
  const p = await json('POST', '/api/auth/login', { username: 'rangkai1', password: 'rangkai1', deviceId: 'dev-produksi', deviceKind: 'H', deviceFn: 'R' });
  perangkai = p.body.token;
  assert.equal(p.body.device.code, 'HR');
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

test('owner bisa melihat sandi yang diatur owner; sandi pilihan pengguna sendiri tidak tersimpan', async () => {
  const users = (await json('GET', '/api/users', null, owner)).body.users;
  const k1 = users.find((u) => u.username === 'kasir1');
  const me = users.find((u) => u.username === 'vano');
  assert.equal(k1.can_view, true);
  assert.equal((await json('GET', `/api/users/${k1.id}/password`, null, owner)).body.password, 'kasir123');
  assert.equal((await json('GET', `/api/users/${k1.id}/password`, null, kasir)).status, 403, 'selain owner ditolak');
  await json('PATCH', `/api/users/${k1.id}`, { password: 'kasirBaru9' }, owner);
  assert.equal((await json('GET', `/api/users/${k1.id}/password`, null, owner)).body.password, 'kasirBaru9', 'sandi baru dari tombol Sandi');
  // vano mengganti sandinya sendiri lewat "Lupa kata sandi?" (uji sebelumnya): salinan dihapus
  assert.equal(me.can_view, false);
  const r = await json('GET', `/api/users/${me.id}/password`, null, owner);
  assert.equal(r.status, 404);
  assert.match(r.body.error, /dipilih sendiri/);
  const raw = store.db.prepare('SELECT pw_view FROM users WHERE id = ?').get(k1.id).pw_view;
  assert.ok(raw.startsWith('gcm$') && !raw.includes('kasirBaru9'), 'tersimpan terenkripsi, bukan teks biasa');
});

test('gaji & biaya (koleksi costs): hanya owner yang menulis dan menarik; kursor pull tetap maju', async () => {
  const head0 = (await json('GET', '/api/sync/pull?since=0&limit=2000', null, owner)).body.head;
  const p = await json('POST', '/api/sync/push', { changes: [{ c: 'costs', id: 'cost-iin', patch: { kind: 'pegawai', name: 'Iin', salary: 1400000 } }] }, owner);
  assert.ok(p.body.results[0].seq > head0);
  const k = await json('POST', '/api/sync/push', { changes: [{ c: 'costs', id: 'cost-x', patch: { kind: 'pegawai', name: 'X', salary: 1 } }] }, kasir);
  assert.ok(k.body.results[0].error, 'Admin tidak boleh menulis gaji');
  const ko = await json('GET', `/api/sync/pull?since=${head0}`, null, kasir);
  assert.equal(ko.body.changes.filter((c) => c.c === 'costs').length, 0, 'Admin tidak menerima data gaji');
  assert.equal(ko.body.cursor, p.body.results[0].seq, 'kursor Admin tetap melewati baris gaji');
  const ow = await json('GET', `/api/sync/pull?since=${head0}`, null, owner);
  assert.equal(ow.body.changes.find((c) => c.c === 'costs').data.salary, 1400000);
});

test('Reset Password: App Password Gmail wajib 16 huruf; Tes Email memakai isian formulir; tanpa email owner dikirim ke Akun GMAIL Toko', async () => {
  const bad = await json('POST', '/api/email-config', { host: 'smtp.gmail.com', port: 465, user: 'toko@gmail.com', pass: 'sandiBiasa123', from: 'toko@gmail.com' }, owner);
  assert.equal(bad.status, 400, 'sandi Gmail biasa ditolak sebelum disimpan');
  assert.match(bad.body.error, /16 huruf \(yang terisi 10 huruf\)/);
  assert.equal((await json('GET', '/api/email-config', null, owner)).body.passLen, 7, 'pengaturan lama tetap utuh');
  const vano = (await json('GET', '/api/users', null, owner)).body.users.find((u) => u.username === 'vano');
  await json('PATCH', `/api/users/${vano.id}`, { email: '' }, owner); // owner belum punya email
  await startFakeSmtp();
  const salah = await json('POST', '/api/email-config/test', { host: '127.0.0.1', port: smtpPort, user: 'toko@gmail.com', pass: 'salah' }, owner);
  assert.equal(salah.status, 502, 'isian formulir yang salah ikut diuji walau belum disimpan');
  const ok = await json('POST', '/api/email-config/test', { host: '127.0.0.1', port: smtpPort, user: 'toko@gmail.com', pass: 'app pass' }, owner);
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.to, ok.body.via], ['toko@gmail.com', 'toko'], 'tujuan cadangan = Akun GMAIL Toko');
  const manual = await json('POST', '/api/email-config/test', { to: 'Givanorh@Gmail.com', host: '127.0.0.1', port: smtpPort, user: 'toko@gmail.com', pass: 'app pass' }, owner);
  assert.deepEqual([manual.body.to, manual.body.via], ['givanorh@gmail.com', 'manual']);
  smtp.close();
});

test('CORS: preflight mengizinkan header ngrok-skip-browser-warning; galat API selalu JSON', async () => {
  const r = await fetch(base + '/api/sync/pull', { method: 'OPTIONS', headers: { Origin: 'https://contoh.app', 'Access-Control-Request-Headers': 'authorization, content-type, ngrok-skip-browser-warning' } });
  assert.equal(r.status, 204);
  assert.match(r.headers.get('access-control-allow-headers'), /ngrok-skip-browser-warning/);
  const g = await fetch(base + '/api/tidak-ada', { headers: { Authorization: `Bearer ${owner}`, 'ngrok-skip-browser-warning': '1' } });
  assert.equal(g.status, 404);
  assert.ok((await g.json()).error, 'rute API tak dikenal tetap menjawab JSON {error}, bukan halaman HTML');
});

const UA_HP = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const loginUa = async (body, ua) => {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

test('v1.8 ringkasan User-Agent untuk daftar perangkat', () => {
  assert.equal(uaInfo(UA_PC), 'Chrome · Windows');
  assert.equal(uaInfo(UA_HP), 'Chrome · Android SM-A546E');
  assert.equal(uaInfo('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'), 'Chrome · Android');
  assert.equal(uaInfo('Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36'), 'Aplikasi Android · Pixel 7');
  assert.equal(uaInfo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'), 'Safari · iPhone');
  assert.equal(uaInfo(UA_PC + ' Edg/130.0.0.0'), 'Edge · Windows');
  assert.equal(uaInfo(''), '');
});

test('v1.8 login tanpa pilihan perangkat: jenis dikenali otomatis, fungsi mengikuti peran akun', async () => {
  // HP perangkai: jenis dari User-Agent (H), fungsi dari peran perangkai (R). HR sudah dipakai dev-produksi → HR2.
  const hp = await loginUa({ username: 'rangkai1', password: 'rangkai1', deviceId: 'dev-auto-hp' }, UA_HP);
  assert.equal(hp.status, 200);
  assert.equal(hp.body.device.code, 'HR2');
  assert.equal(hp.body.device.name, 'HP Ruang Rangkai');
  // hasil deteksi klien (layar sentuh besar = tablet) didahulukan dari User-Agent; fungsi dari peran kasir (K)
  const tab = await loginUa({ username: 'kasir1', password: 'kasirBaru9', deviceId: 'dev-auto-tab', deviceKind: 'T' }, UA_PC);
  assert.match(tab.body.device.code, /^TK\d+$/);
  // owner di komputer: KO (Komputer Owner)
  const pc = await loginUa({ username: 'vano', password: 'sandiBaru1', deviceId: 'dev-auto-pc' }, UA_PC);
  assert.equal(pc.body.device.code, 'KO');
  // perangkat yang sudah terdaftar: pilihan dari klien versi lama tidak lagi mengubah kode
  const again = await loginUa({ username: 'kasir1', password: 'kasirBaru9', deviceId: 'dev-auto-hp', deviceKind: 'K', deviceFn: 'K' }, UA_HP);
  assert.equal(again.body.device.code, 'HR2', 'kategori hanya diubah owner');
});

test('v1.8 owner mengelola perangkat: daftar + riwayat login, ganti nama & kategori; perangkat menerima kode barunya lewat sinkron', async () => {
  // selain owner ditolak (juga endpoint lama)
  assert.equal((await json('PATCH', '/api/devices/dev-auto-hp', { name: 'X' }, kasir)).status, 403);
  assert.equal((await json('POST', '/api/devices/code', { kind: 'T', fn: 'K' }, kasir)).status, 403);
  assert.equal((await json('GET', '/api/devices', null, perangkai)).status, 403);

  const list = await json('GET', '/api/devices', null, owner);
  assert.equal(list.status, 200);
  const hp = list.body.devices.find((d) => d.id === 'dev-auto-hp');
  assert.equal(hp.ua, 'Chrome · Android SM-A546E');
  assert.equal(hp.logins, 2);
  assert.equal(hp.user_name, 'Kasir 1', 'pengguna terakhir yang masuk');
  assert.equal(list.body.devices.filter((d) => d.current).length, 1);
  assert.equal(list.body.devices.find((d) => d.current).id, 'dev-kasir-1');
  const log = list.body.logins.filter((l) => l.device_id === 'dev-auto-hp');
  assert.deepEqual(log.map((l) => l.user_name), ['Kasir 1', 'Perangkai 1'], 'riwayat login terbaru di atas');

  // ganti nama saja: kode tetap
  const ren = await json('PATCH', '/api/devices/dev-auto-hp', { name: '  HP Nazra <b> ' }, owner);
  assert.equal(ren.body.device.name, 'HP Nazra b');
  assert.equal(ren.body.device.code, 'HR2');
  // ganti kategori: kode baru, nama buatan owner dipertahankan, kode lama tetap dicadangkan
  const cat = await json('PATCH', '/api/devices/dev-auto-hp', { kind: 'T', fn: 'R' }, owner);
  assert.equal(cat.body.device.code, 'TR');
  assert.equal(cat.body.device.name, 'HP Nazra b');
  assert.equal((await json('PATCH', '/api/devices/dev-auto-hp', { kind: 'Z' }, owner)).status, 400);
  assert.equal((await json('PATCH', '/api/devices/tidak-ada', { name: 'X' }, owner)).status, 404);
  // nama dikosongkan: kembali ke nama bawaan kategori
  const auto = await json('PATCH', '/api/devices/dev-auto-hp', { name: '' }, owner);
  assert.equal(auto.body.device.name, 'Tablet Ruang Rangkai');
  // perangkat lain tidak bisa mengambil kode yang pernah dipakai dev-auto-hp
  const other = await loginUa({ username: 'rangkai1', password: 'rangkai1', deviceId: 'dev-auto-hp2' }, UA_HP);
  assert.equal(other.body.device.code, 'HR3', 'HR2 tetap dicadangkan');
  // perangkat menerima kode & nama barunya lewat koleksi devices saat sinkron
  const pull = await json('GET', '/api/sync/pull?since=0', null, perangkai);
  const rec = pull.body.changes.find((c) => c.c === 'devices' && c.id === 'dev-auto-hp');
  assert.equal(rec.data.code, 'TR');
  assert.equal(rec.data.name, 'Tablet Ruang Rangkai');
  assert.equal(rec.data.ua, 'Chrome · Android SM-A546E');
});

const lastBody = () => {
  const raw = mails[mails.length - 1].raw;
  return Buffer.from(raw.split('\n\n').slice(1).join('').replace(/\s/g, ''), 'base64').toString();
};

test('v1.9 reset sandi mandiri kasir/perangkai: verifikasi email + No HP + tanggal lahir, sandi baru dikirim ke email', async () => {
  await startFakeSmtp();
  assert.equal((await json('POST', '/api/email-config', { host: '127.0.0.1', port: smtpPort, user: 'toko@gmail.com', pass: 'app pass', from: 'toko@gmail.com' }, owner)).status, 200);
  const users = (await json('GET', '/api/users', null, owner)).body.users;
  const k1 = users.find((u) => u.username === 'kasir1');
  const p1 = users.find((u) => u.username === 'rangkai1');
  // data verifikasi belum lengkap → 409, owner tidak memakai menu ini → 403
  await json('PATCH', `/api/users/${k1.id}`, { email: '' }, owner);
  assert.equal((await json('POST', '/api/auth/self-reset', { email: 'x@y.co', phone: '0812', birth_date: '2000-01-01' }, kasir)).status, 409);
  assert.equal((await json('POST', '/api/auth/self-reset', {}, owner)).status, 403);
  // owner mengisi data: format dicek, No HP dinormalkan ke 08…
  assert.equal((await json('PATCH', `/api/users/${k1.id}`, { birth_date: '1999-02-30' }, owner)).status, 400, '30 Februari ditolak');
  assert.equal((await json('PATCH', `/api/users/${k1.id}`, { phone: '12345' }, owner)).status, 400);
  assert.equal((await json('PATCH', `/api/users/${k1.id}`, { email: 'Kasir1@Example.com', phone: '+62 812-3456-7890', birth_date: '1999-04-12' }, owner)).status, 200);
  const k1b = (await json('GET', '/api/users', null, owner)).body.users.find((u) => u.id === k1.id);
  assert.deepEqual([k1b.email, k1b.phone, k1b.birth_date], ['kasir1@example.com', '081234567890', '1999-04-12']);
  const pull = await json('GET', '/api/sync/pull?since=0', null, kasir);
  assert.ok(!JSON.stringify(pull.body.changes.filter((c) => c.c === 'staff')).match(/081234567890|1999-04-12/), 'No HP & tanggal lahir tidak ikut sinkron');

  // data salah → 400, sandi lama tetap
  const before = mails.length;
  const bad = await json('POST', '/api/auth/self-reset', { email: 'kasir1@example.com', phone: '081234567890', birth_date: '1999-04-13' }, kasir);
  assert.equal(bad.status, 400);
  assert.equal(mails.length, before, 'tidak ada email bila data salah');
  // benar (huruf besar/kecil email & format HP berbeda tetap cocok) → sandi baru dikirim ke email pribadi
  const ok = await json('POST', '/api/auth/self-reset', { email: ' KASIR1@example.com ', phone: '62 812 3456 7890', birth_date: '1999-04-12' }, kasir);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.to, 'ka***@example.com');
  assert.equal(mails.length, before + 1);
  assert.match(mails.at(-1).raw, /To: <kasir1@example\.com>/);
  const pw = lastBody().match(/\n {4}([A-Za-z0-9]{10})\n/)[1];
  assert.match(pw, /[a-z]/); assert.match(pw, /[A-Z]/); assert.match(pw, /\d/);
  assert.equal((await json('POST', '/api/auth/login', { username: 'kasir1', password: 'kasirBaru9' })).status, 401, 'sandi lama tidak berlaku');
  assert.equal((await json('POST', '/api/auth/login', { username: 'kasir1', password: pw, deviceId: 'dev-kasir-2' })).status, 200, 'masuk dengan sandi dari email');
  assert.equal((await json('GET', `/api/users/${k1.id}/password`, null, owner)).body.password, pw, 'sandi buatan server tetap bisa dilihat owner');
  assert.equal((await json('GET', '/api/auth/me', null, kasir)).status, 200, 'perangkat yang sedang masuk tidak ikut keluar');

  // perangkai: 5 kali salah → dikunci 15 menit walau data berikutnya benar
  await json('PATCH', `/api/users/${p1.id}`, { email: 'sari@example.com', phone: '0813 1111 2222', birth_date: '2001-08-17' }, owner);
  for (let i = 0; i < 5; i++) assert.equal((await json('POST', '/api/auth/self-reset', { email: 'sari@example.com', phone: '081311112222', birth_date: '2001-08-18' }, perangkai)).status, 400);
  assert.equal((await json('POST', '/api/auth/self-reset', { email: 'sari@example.com', phone: '081311112222', birth_date: '2001-08-17' }, perangkai)).status, 429);
  smtp.close();
});
