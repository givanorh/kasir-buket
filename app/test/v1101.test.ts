// v1.10.1: alamat server bawaan APK (tunnel ngrok sementara) dan SSE lewat fetch dengan header ngrok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { cleanUrl, pickServerUrl } from '../src/lib/server-url.ts';
import { fetchEvents, sseParser, type SseEvent } from '../src/lib/sse.ts';

const NGROK = 'https://daydream-vowel-snaking.ngrok-free.dev';
const VPS = 'https://kasir.tokobuket.id';

test('pickServerUrl: web memakai asal halaman, APK memakai bawaan build dan ikut pindah bila bawaan berganti', () => {
  const base = { native: true, stored: '', prevDefault: '', buildDefault: NGROK, origin: 'https://localhost' };
  assert.equal(pickServerUrl({ ...base, native: false }), 'https://localhost');
  assert.equal(pickServerUrl({ ...base, native: false, stored: 'http://192.168.1.5:8080' }), 'http://192.168.1.5:8080');
  // APK baru dipasang: alamat terisi otomatis
  assert.equal(pickServerUrl(base), NGROK);
  // pengguna mengetik alamat lain: tetap dipakai
  assert.equal(pickServerUrl({ ...base, stored: 'http://192.168.1.5:8080', prevDefault: NGROK }), 'http://192.168.1.5:8080');
  // APK lama tanpa bawaan, alamat diketik manual: tidak diganti
  assert.equal(pickServerUrl({ ...base, stored: NGROK, prevDefault: '' }), NGROK);
  // pindah ke VPS: APK baru membawa bawaan VPS, alamat tersimpan = bawaan lama -> ikut pindah
  assert.equal(pickServerUrl({ ...base, stored: NGROK, prevDefault: NGROK, buildDefault: VPS }), VPS);
  // build tanpa bawaan tidak menghapus alamat tersimpan
  assert.equal(pickServerUrl({ ...base, stored: NGROK, prevDefault: NGROK, buildDefault: '' }), NGROK);
  assert.equal(cleanUrl(` ${NGROK}// `), NGROK);
});

test('sseParser: event bernama, data multibaris, komentar, CRLF, potongan terbelah', () => {
  const got: SseEvent[] = [];
  const feed = sseParser((e) => got.push(e));
  feed('retry: 3000\nevent: seq\ndata: {"seq"');
  assert.equal(got.length, 0);
  feed(':12}\n\n: komentar\r\nevent: seq\r\ndata: {"seq":13}\r\n\r\ndata: a\ndata: b\n\n');
  assert.deepEqual(got, [
    { event: 'seq', data: '{"seq":12}' },
    { event: 'seq', data: '{"seq":13}' },
    { event: 'message', data: 'a\nb' },
  ]);
});

function listen(handler: http.RequestListener) {
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => { srv.closeAllConnections(); srv.close(); } });
    });
  });
}

test('fetchEvents: mengirim header ngrok, menerima denyut, sambung ulang setelah balasan perantara', async () => {
  let hits = 0;
  const headers: string[] = [];
  const srv = await listen((req, res) => {
    hits++;
    headers.push(String(req.headers['ngrok-skip-browser-warning'] || ''));
    if (hits === 1) { // tiruan halaman peringatan ngrok (HTML, bukan SSE)
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html>ERR_NGROK_6024</html>');
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('retry: 3000\nevent: seq\ndata: {"seq":7}\n\n');
    setTimeout(() => res.write('event: seq\ndata: {"seq":8}\n\n'), 20);
  });
  const events: string[] = [];
  let opens = 0;
  let errors = 0;
  const done = new Promise<void>((resolve) => {
    const close = fetchEvents(`${srv.url}/api/events?token=t`, { 'ngrok-skip-browser-warning': '1' }, {
      onOpen: () => { opens++; },
      onError: () => { errors++; },
      onEvent: (e) => { events.push(`${e.event}:${e.data}`); if (events.length === 2) { close(); resolve(); } },
    }, { minRetry: 10, maxRetry: 20 });
  });
  await done;
  srv.close();
  assert.equal(errors, 1, 'balasan HTML dianggap gagal lalu disambung ulang');
  assert.equal(opens, 1);
  assert.deepEqual(events, ['seq:{"seq":7}', 'seq:{"seq":8}']);
  assert.deepEqual(headers, ['1', '1']);
});

test('fetchEvents: 401 menghentikan sambung ulang', async () => {
  let hits = 0;
  const srv = await listen((_req, res) => { hits++; res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":"Sesi berakhir"}'); });
  const fatal = await new Promise<boolean>((resolve) => {
    fetchEvents(`${srv.url}/api/events`, {}, { onOpen: () => {}, onEvent: () => {}, onError: (f) => resolve(f) }, { minRetry: 5, maxRetry: 5 });
  });
  await new Promise((r) => setTimeout(r, 40));
  srv.close();
  assert.equal(fatal, true);
  assert.equal(hits, 1);
});
