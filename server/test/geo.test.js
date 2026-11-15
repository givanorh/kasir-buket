import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordsFromText, expandMapsUrl, roadDistanceKm } from '../src/geo.js';

const resp = (status, { location, body = '', json } = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => (k.toLowerCase() === 'location' ? location || null : null) },
  text: async () => body, json: async () => json,
});

test('link pendek Google Maps diikuti sampai titik tempat', async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    if (url.startsWith('https://maps.app.goo.gl/')) return resp(302, { location: 'https://www.google.com/maps/place/Rumah/data=!4m2!3m1!1s0x30:0x9?utm_source=mstt_1' });
    return resp(200, { body: '<html>... ;window.APP_INITIALIZATION_STATE=[[[2345.6,98.4561,3.7623],[0,0,0]]' });
  };
  const r = await expandMapsUrl('https://maps.app.goo.gl/AbCdEf123', fake);
  assert.deepEqual([r.lat, r.lng], [3.7623, 98.4561]);
  assert.equal(calls.length, 2);
});

test('link non-Google ditolak (mencegah server dipakai ke alamat lain)', async () => {
  await assert.rejects(expandMapsUrl('http://192.168.1.1/admin', async () => resp(200)), /Hanya link Google Maps/);
  await assert.rejects(expandMapsUrl('https://maps.app.goo.gl/x', async () => resp(302, { location: 'http://evil.example/' })), /Hanya link Google Maps/);
  await assert.rejects(expandMapsUrl('https://google.com.evil.example/maps', async () => resp(200)), /Hanya link Google Maps/);
  await assert.doesNotReject(expandMapsUrl('https://www.google.co.id/maps/@3.7,98.4,15z', async () => resp(200)));
});

test('koordinat langsung dari URL panjang tanpa permintaan jaringan', async () => {
  const r = await expandMapsUrl('https://www.google.com/maps/@3.75,98.44,15z', async () => { throw new Error('tidak boleh dipanggil'); });
  assert.deepEqual([r.lat, r.lng], [3.75, 98.44]);
  assert.deepEqual(coordsFromText('https://maps.google.com/?q=loc:3.7,98.4'), { lat: 3.7, lng: 98.4 });
});

test('jarak jalan OSRM dalam km; galat layanan diteruskan', async () => {
  let asked = '';
  const km = await roadDistanceKm({ lat: 3.75, lng: 98.44 }, { lat: 3.76, lng: 98.46 }, { fetchFn: async (u) => { asked = u; return resp(200, { json: { code: 'Ok', routes: [{ distance: 7412.6 }] } }); } });
  assert.equal(km, 7.41);
  assert.match(asked, /driving\/98\.44,3\.75;98\.46,3\.76/);
  await assert.rejects(roadDistanceKm({ lat: 3.75, lng: 98.44 }, { lat: 3.76, lng: 98.46 }, { fetchFn: async () => resp(503) }), /503/);
});
