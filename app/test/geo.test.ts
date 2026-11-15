import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordsFromText, deliveryFee, haversineKm, olcDecode, olcEncode, olcRecover, parseLocalInput, plusCodeIn } from '../src/lib/geo';

const near = (a: number, b: number, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('Plus Code: encode/decode sesuai contoh resmi Open Location Code', () => {
  assert.equal(olcEncode(47.365562, 8.524875), '8FVC9G8F+6X');
  const d = olcDecode('8FVC9G8F+6X');
  near(d.lat, 47.365562, 1e-4); near(d.lng, 8.524875, 1e-4);
  const r = olcRecover('9G8F+6X', { lat: 47.4, lng: 8.6 });
  near(r.lat, d.lat); near(r.lng, d.lng);
});

test('Plus Code pendek dipulihkan dekat toko (Stabat) dan dikenali di teks alamat', () => {
  const toko = { lat: 3.7536, lng: 98.4497 };
  const full = olcEncode(3.76921, 98.46012);
  const short = full.slice(4); // buang 4 karakter awal seperti di Google Maps
  assert.equal(plusCodeIn(`${short} Stabat, Kabupaten Langkat`), short);
  const p = parseLocalInput(`${short} Stabat, Kabupaten Langkat, Sumatera Utara`, toko)!;
  near(p.lat, 3.76921, 1e-3); near(p.lng, 98.46012, 1e-3);
  assert.equal(p.source, 'plus code');
});

test('link Google Maps: titik tempat diutamakan dari tengah peta', () => {
  const url = 'https://www.google.com/maps/place/Toko/@3.7500,98.4400,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d3.7612!4d98.4555?entry=ttu';
  assert.deepEqual(coordsFromText(url), { lat: 3.7612, lng: 98.4555 });
  assert.deepEqual(coordsFromText('https://maps.google.com/?q=3.761,98.455'), { lat: 3.761, lng: 98.455 });
  assert.deepEqual(coordsFromText('https://www.google.com/maps/search/?api=1&query=3.7612%2C98.4555'), { lat: 3.7612, lng: 98.4555 });
  assert.deepEqual(coordsFromText('3.761234, 98.455678'), { lat: 3.761234, lng: 98.455678 });
  assert.equal(coordsFromText('Jl. Proklamasi No. 212'), null);
  assert.deepEqual(coordsFromText(' 3.80, 98.50 '), { lat: 3.8, lng: 98.5 });
});

test('jarak & ongkir: km × Rp 3.000, minimum Rp 15.000, dibulatkan ke atas Rp 1.000', () => {
  near(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }), 111.195, 1e-2);
  const r = { rate: 3000, min: 15000, round: 1000 };
  assert.deepEqual(deliveryFee(3.2, r), { kmBilled: 3.2, raw: 9600, fee: 15000, usedMin: true });
  assert.deepEqual(deliveryFee(7.41, r), { kmBilled: 7.5, raw: 22500, fee: 23000, usedMin: false });
  assert.deepEqual(deliveryFee(5, r), { kmBilled: 5, raw: 15000, fee: 15000, usedMin: false });
});
