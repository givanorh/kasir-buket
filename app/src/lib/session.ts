// Sesi perangkat: alamat server, token, pengguna, dan kode perangkat. Disimpan di IndexedDB.
import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { db, getMeta, resetLocalData, setMeta } from './db';
import type { Role } from './types';

export interface SessionUser { id: string; name: string; username: string; role: Role; outlet_id?: string }
export interface SessionDevice { id: string; code: string; name?: string; outlet_id?: string }
export interface Session { serverUrl: string; token: string | null; user: SessionUser | null; device: SessionDevice | null; deviceId: string; serverInstance: string | null }

let session: Session = { serverUrl: '', token: null, user: null, device: null, deviceId: '', serverInstance: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const isNative = () => Capacitor.isNativePlatform();

export async function loadSession(): Promise<Session> {
  let deviceId = await getMeta<string>('deviceId', '');
  if (!deviceId) {
    deviceId = 'dev-' + randomId(12);
    await setMeta('deviceId', deviceId);
  }
  const defaultUrl = isNative() ? '' : window.location.origin;
  session = {
    serverUrl: await getMeta<string>('serverUrl', defaultUrl),
    token: await getMeta<string | null>('token', null),
    user: await getMeta<SessionUser | null>('user', null),
    device: await getMeta<SessionDevice | null>('device', null),
    deviceId,
    serverInstance: await getMeta<string | null>('serverInstance', null),
  };
  emit();
  return session;
}

export const getSession = () => session;

export async function updateSession(p: Partial<Session>) {
  session = { ...session, ...p };
  for (const [k, v] of Object.entries(p)) await setMeta(k, v);
  emit();
}

export function useSession(): Session {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => session);
}

export function randomId(len = 10) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Panggil API server. Melempar ApiError (status 0 = jaringan/server tidak terjangkau). */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; timeout?: number } = {}): Promise<T> {
  const base = session.serverUrl.replace(/\/+$/, '');
  if (!base) throw new ApiError(0, 'Alamat server belum diisi');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout ?? 20000);
  let res: Response;
  try {
    res = await fetch(base + path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, 'Server tidak terjangkau. Periksa koneksi internet.');
  } finally {
    clearTimeout(t);
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* bukan JSON */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || `Galat ${res.status}`);
  return data as T;
}

/**
 * Masuk ke server. Bila server ternyata basis data lain (instanceId berbeda dari yang terakhir dipakai),
 * data lokal dikosongkan agar tidak tercampur; perubahan yang belum terkirim butuh konfirmasi.
 */
export async function login(username: string, password: string, deviceName: string, confirmDiscard?: (pending: number) => boolean) {
  const r = await api<{ token: string; user: SessionUser; device: SessionDevice; instanceId?: string }>('/api/auth/login', {
    body: { username, password, deviceId: session.deviceId, deviceName },
  });
  if (r.instanceId && session.serverInstance && r.instanceId !== session.serverInstance) {
    const pending = await db.outbox.count();
    if (pending && confirmDiscard && !confirmDiscard(pending)) throw new ApiError(0, 'Login dibatalkan');
    await resetLocalData();
  } else if (r.instanceId && !session.serverInstance) {
    // perangkat versi lama: belum tahu ID server, jadi tarik ulang penuh sekali agar tidak ada data terlewat
    await setMeta('cursor', 0);
  }
  await updateSession({ token: r.token, user: r.user, device: r.device, serverInstance: r.instanceId || session.serverInstance });
  return r;
}

export async function logout() {
  await updateSession({ token: null, user: null });
}
