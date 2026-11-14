// Sesi perangkat: alamat server, token, pengguna, dan kode perangkat. Disimpan di IndexedDB.
import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { getMeta, setMeta } from './db';
import type { Role } from './types';

export interface SessionUser { id: string; name: string; username: string; role: Role; outlet_id?: string }
export interface SessionDevice { id: string; code: string; name?: string; outlet_id?: string }
export interface Session { serverUrl: string; token: string | null; user: SessionUser | null; device: SessionDevice | null; deviceId: string }

let session: Session = { serverUrl: '', token: null, user: null, device: null, deviceId: '' };
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

export async function login(username: string, password: string, deviceName: string) {
  const r = await api<{ token: string; user: SessionUser; device: SessionDevice }>('/api/auth/login', {
    body: { username, password, deviceId: session.deviceId, deviceName },
  });
  await updateSession({ token: r.token, user: r.user, device: r.device });
  return r;
}

export async function logout() {
  await updateSession({ token: null, user: null });
}
