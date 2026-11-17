import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assigneeOf, canSetStatus, floristList, matchFlorist, needsFlorist, rolesOf } from '../src/lib/rules';
import { rolesLabel } from '../src/lib/labels';
import type { Order, Staff } from '../src/lib/types';

const staff = [
  { id: 'u-iin', name: 'Iin Ruslinda', role: 'kasir', roles: ['kasir', 'perangkai'], active: true },
  { id: 'u-nazra', name: 'Nazra', role: 'perangkai', active: true },
  { id: 'u-tiara', name: 'Tiara', role: 'kasir', roles: ['kasir'], active: true },
  { id: 'u-mirna', name: 'Mirna', role: 'perangkai', active: false },
  { id: 'u-yuni', name: 'yuni yati', role: 'owner', active: true },
] as Staff[];

test('peran ganda: Admin + Perangkai; owner tunggal; akun lama tanpa roles', () => {
  assert.deepEqual(rolesOf(staff[0]), ['kasir', 'perangkai']);
  assert.deepEqual(rolesOf(staff[1]), ['perangkai']);
  assert.deepEqual(rolesOf({ role: 'owner', roles: ['kasir'] }), ['owner']);
  assert.equal(rolesLabel(staff[0]), 'Admin + Perangkai');
  assert.equal(rolesLabel({ role: 'perangkai' }), 'Perangkai');
});

test('daftar perangkai dari akun berperan Perangkai (aktif); nama lama dipakai hanya bila belum ada akun', () => {
  assert.deepEqual(floristList(staff, ['Iin Ruslinda', 'Fira']), [{ id: 'u-iin', name: 'Iin Ruslinda' }, { id: 'u-nazra', name: 'Nazra' }]);
  assert.deepEqual(floristList([staff[2]], ['Iin Ruslinda', 'Fira']), [{ name: 'Iin Ruslinda' }, { name: 'Fira' }]);
  const list = floristList(staff, []);
  assert.equal(matchFlorist('iin', list)?.id, 'u-iin', 'nama depan cocok');
  assert.equal(matchFlorist('Fira', list), undefined);
});

test('penunjukan: id akun, belum ditunjuk (null), atau nama lama tanpa akun (undefined)', () => {
  const list = floristList(staff, []);
  assert.equal(assigneeOf({ florist: 'Nazra', florist_id: 'u-nazra' }, list), 'u-nazra');
  assert.equal(assigneeOf({ florist: 'Iin' }, list), 'u-iin', 'pesanan lama bernama "Iin" dicocokkan ke akun Iin Ruslinda');
  assert.equal(assigneeOf({ florist: '' }, list), null);
  assert.equal(assigneeOf({ florist: 'Fira' }, list), undefined);
  assert.equal(needsFlorist({ fulfillment: 'ambil', production_status: 'antri' } as Order), true);
  assert.equal(needsFlorist({ fulfillment: 'sekarang', production_status: 'antri' } as Order), false, 'Ready tidak perlu perangkai');
  assert.equal(needsFlorist({ fulfillment: 'antar', production_status: 'siap' } as Order), false);
});

test('hanya perangkai yang ditunjuk yang bisa Mulai rangkai / Selesai dirangkai', () => {
  const ord = (st: Order['production_status'], fulfillment: Order['fulfillment'] = 'ambil') => ({ void: false, production_status: st, fulfillment }) as Order;
  const nazra = { id: 'u-nazra', role: 'perangkai' as const }, iin = { id: 'u-iin', role: 'kasir' as const, roles: ['kasir', 'perangkai'] as const };
  assert.equal(canSetStatus(nazra, ord('antri'), 'dirangkai', 0, 'u-nazra'), true);
  assert.equal(canSetStatus(iin as never, ord('antri'), 'dirangkai', 0, 'u-nazra'), false, 'perangkai lain tidak bisa');
  assert.equal(canSetStatus(iin as never, ord('antri'), 'dirangkai', 0, 'u-iin'), true, 'Admin + Perangkai yang ditunjuk bisa');
  assert.equal(canSetStatus(nazra, ord('antri'), 'dirangkai', 0, null), false, 'belum ditunjuk: tunjuk dulu');
  assert.equal(canSetStatus(nazra, ord('antri'), 'dirangkai', 0, undefined), true, 'nama lama tanpa akun: akun perangkai mana pun');
  assert.equal(canSetStatus({ id: 'u-tiara', role: 'kasir' }, ord('antri'), 'dirangkai', 0, undefined), false);
  assert.equal(canSetStatus(nazra, ord('antri', 'sekarang'), 'dirangkai', 0, null), true, 'pesanan Ready lama yang masih di antrean');
});
