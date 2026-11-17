// Sesi perangkat: alamat server, token, pengguna, dan kode perangkat. Disimpan di IndexedDB.
import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { db, getMeta, resetLocalData, setMeta } from './db';
import type { Role } from './types';
import { proxyMessage } from './rules';
import { guessKind } from './device';
import { BUILD_SERVER, pickServerUrl } from './server-url';

export interface SessionUser { id: string; name: string; username: string; role: Role; roles?: Role[]; outlet_id?: string }
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
  const native = isNative();
  const stored = await getMeta<string>('serverUrl', '');
  const prevDefault = await getMeta<string>('serverUrlDefault', '');
  const serverUrl = pickServerUrl({ native, stored, prevDefault, buildDefault: BUILD_SERVER, origin: window.location.origin });
  if (native) {
    if (serverUrl !== stored && stored) await setMeta('serverUrl', serverUrl);
    if (prevDefault !== BUILD_SERVER) await setMeta('serverUrlDefault', BUILD_SERVER);
  }
  session = {
    serverUrl,
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
  /** `proxy`: balasan bukan dari server Kasir Buket (mis. ngrok/Cloudflare saat tunnel mati), diperlakukan seperti offline. */
  constructor(public status: number, message: string, public proxy = false) { super(message); }
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
      // hanya bila alamat server adalah domain ngrok: lewati halaman peringatan tunnel gratis.
      // Setelah server pindah ke VPS (alamat bukan ngrok) header ini otomatis tidak dikirim lagi.
      headers: { 'Content-Type': 'application/json', ...(/ngrok/i.test(base) ? { 'ngrok-skip-browser-warning': '1' } : {}), ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, 'Server tidak terjangkau. Periksa koneksi internet.');
  } finally {
    clearTimeout(t);
  }
  const text = await res.text().catch(() => '');
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* bukan JSON: balasan perantara */ }
  if (!res.ok) {
    if (data?.error) throw new ApiError(res.status, data.error);
    throw new ApiError(res.status, proxyMessage(res.status, res.headers.get('ngrok-error-code'), text.slice(0, 4000)), true);
  }
  if (data === null && text) throw new ApiError(res.status, proxyMessage(res.status, res.headers.get('ngrok-error-code'), text.slice(0, 4000)), true);
  return data as T;
}

/**
 * Masuk ke server. Bila server ternyata basis data lain (instanceId berbeda dari yang terakhir dipakai),
 * data lokal dikosongkan agar tidak tercampur; perubahan yang belum terkirim butuh konfirmasi.
 */
export async function login(username: string, password: string, confirmDiscard?: (pending: number) => boolean) {
  // Perangkat dikenali otomatis: ID perangkat tersimpan di sini, jenis dari layar sentuh + ukuran layar.
  // Fungsi awal mengikuti peran akun (ditentukan server); nama dan kategori selanjutnya diatur owner.
  const r = await api<{ token: string; user: SessionUser; device: SessionDevice; instanceId?: string }>('/api/auth/login', {
    body: { username, password, deviceId: session.deviceId, deviceKind: guessKind() },
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

/** Owner mengubah peran/nama akun ini (tab Staff): sesi ikut diperbarui saat sinkron, tanpa masuk ulang. */
export async function applyStaffRecord(rec: { id: string; name?: string; role?: Role; roles?: Role[] } | undefined) {
  const u = session.user;
  if (!rec || !u || rec.id !== u.id || !rec.role) return false;
  const roles = rec.roles?.length ? rec.roles : [rec.role];
  if (rec.role === u.role && (rec.name || u.name) === u.name && roles.join() === (u.roles || [u.role]).join()) return false;
  await updateSession({ user: { ...u, name: rec.name || u.name, role: rec.role, roles } });
  return true;
}

/**
 * Owner mengganti nama/kategori perangkat lain; perangkat itu menerima kodenya lewat rekaman `devices` saat sinkron.
 * Mengembalikan true bila kode atau nama perangkat ini berubah.
 */
export async function applyDeviceRecord(rec: { id: string; code?: string; name?: string; outlet_id?: string } | undefined) {
  if (!rec || rec.id !== session.deviceId || !rec.code || !session.device) return false;
  if (rec.code === session.device.code && (rec.name || '') === (session.device.name || '')) return false;
  await updateSession({ device: { ...session.device, id: rec.id, code: rec.code, name: rec.name } });
  return true;
}

export async function logout() {
  await updateSession({ token: null, user: null });
}
