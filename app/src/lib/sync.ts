// Mesin sinkron otomatis. Tidak ada tombol "Sinkronkan" yang wajib ditekan:
//  - saat aplikasi dibuka/login, saat kembali ke depan (resume), saat internet tersambung lagi
//  - 0,4 detik setelah setiap perubahan lokal (push)
//  - saat server memberi tahu ada data baru lewat SSE (pull, hampir seketika)
//  - cadangan: polling tiap 30 detik bila SSE terhalang
// Konsistensi: server memberi nomor urut (seq) global; perangkat menarik semua perubahan seq > kursor.
// Perubahan lokal yang belum terkirim (outbox) selalu diterapkan ulang di atas data server,
// sehingga edit offline tidak tertimpa. Penggabungan per kolom (patch), bukan per rekaman.
import { useSyncExternalStore } from 'react';
import { db, getMeta, setMeta } from './db';
import { api, ApiError, getSession, logout, updateSession } from './session';
import { COLLECTIONS } from './types';

export interface SyncStatus {
  online: boolean; syncing: boolean; pending: number; lastSync: number | null; error: string | null; authError: boolean; cursor: number;
}

const PUSH_BATCH = 200;
const PULL_LIMIT = 1000;
const POLL_MS = 30000;

class SyncEngine {
  status: SyncStatus = { online: true, syncing: false, pending: 0, lastSync: null, error: null, authError: false, cursor: 0 };
  private listeners = new Set<() => void>();
  private running = false;
  private again = false;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private backoff = 2000;
  private es: EventSource | null = null;
  private started = false;

  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(p: Partial<SyncStatus>) { this.status = { ...this.status, ...p }; this.listeners.forEach((l) => l()); }

  private onOnline = () => this.run();
  private onVisible = () => { if (document.visibilityState === 'visible') this.run(); };

  async start() {
    if (this.started) return;
    this.started = true;
    this.set({ cursor: await getMeta<number>('cursor', 0), pending: await db.outbox.count() });
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('focus', this.onOnline);
    this.pollTimer = setInterval(() => this.run(), POLL_MS);
    this.connectEvents();
    this.run();
  }

  stop() {
    this.started = false;
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('focus', this.onOnline);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.es?.close();
    this.es = null;
  }

  private connectEvents() {
    const s = getSession();
    if (!s.token || !s.serverUrl || typeof EventSource === 'undefined') return;
    this.es?.close();
    const es = new EventSource(`${s.serverUrl.replace(/\/+$/, '')}/api/events?token=${encodeURIComponent(s.token)}`);
    es.addEventListener('seq', (ev) => {
      try {
        const { seq } = JSON.parse((ev as MessageEvent).data);
        if (seq > this.status.cursor) this.run();
      } catch { /* abaikan */ }
    });
    es.onopen = () => { if (!this.status.online) this.run(); };
    this.es = es;
  }

  /** Dipanggil setelah setiap tulis lokal. */
  schedulePush() {
    db.outbox.count().then((pending) => this.set({ pending }));
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.run(), 400);
  }

  async run(): Promise<void> {
    if (!this.started || !getSession().token) return;
    if (this.running) { this.again = true; return; }
    this.running = true;
    this.set({ syncing: true });
    try {
      do {
        this.again = false;
        await this.push();
        await this.pull();
      } while (this.again);
      this.backoff = 2000;
      this.set({ online: true, error: null, lastSync: Date.now(), pending: await db.outbox.count() });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        this.set({ authError: true, error: err.message });
        this.stop();
        await logout();
      } else {
        this.set({ online: err.status !== 0 ? this.status.online : false, error: err.message, pending: await db.outbox.count() });
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.run(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 30000);
      }
    } finally {
      this.running = false;
      this.set({ syncing: false });
    }
  }

  private async push() {
    for (;;) {
      const batch = await db.outbox.orderBy('seq').limit(PUSH_BATCH).toArray();
      if (!batch.length) return;
      const res = await api<{ results: { c: string; id: string; seq?: number; error?: string }[] }>('/api/sync/push', {
        body: { changes: batch.map((b) => ({ c: b.c, id: b.id, patch: b.patch, del: b.del })) },
        timeout: 60000,
      });
      const rejected = res.results.filter((r) => r.error);
      if (rejected.length) {
        const log = await getMeta<any[]>('sync_errors', []);
        await setMeta('sync_errors', [...rejected.map((r) => ({ ...r, at: new Date().toISOString() })), ...log].slice(0, 50));
      }
      await db.outbox.bulkDelete(batch.map((b) => b.seq!));
      this.set({ pending: await db.outbox.count() });
    }
  }

  private async pull() {
    let cursor = await getMeta<number>('cursor', 0);
    for (;;) {
      const res = await api<{ changes: { c: string; id: string; seq: number; del: boolean; data: any }[]; cursor: number; more: boolean; head?: number; instanceId?: string }>(
        `/api/sync/pull?since=${cursor}&limit=${PULL_LIMIT}`, { timeout: 60000 },
      );
      // basis data server dipulihkan dari cadangan lama (nomor urut mundur): tarik ulang dari awal
      if (typeof res.head === 'number' && res.head < cursor) {
        cursor = 0;
        await setMeta('cursor', 0);
        continue;
      }
      // migrasi satu kali untuk perangkat versi lama (belum mengenal ID server): catat ID, lalu tarik ulang penuh
      if (res.instanceId && !getSession().serverInstance) {
        await updateSession({ serverInstance: res.instanceId });
        if (cursor > 0) { cursor = 0; await setMeta('cursor', 0); continue; }
      }
      if (res.changes.length) {
        const tables = [db.outbox, db.meta, ...COLLECTIONS.map((c) => db.table(c))];
        await db.transaction('rw', tables, async () => {
          for (const ch of res.changes) {
            if (!(COLLECTIONS as string[]).includes(ch.c)) continue;
            const table = db.table(ch.c);
            const pending = await db.outbox.where('[c+id]').equals([ch.c, ch.id]).sortBy('seq');
            if (ch.del && !pending.length) { await table.delete(ch.id); continue; }
            let data = ch.data;
            for (const p of pending) data = { ...data, ...p.patch };
            await table.put(data);
          }
          await setMeta('cursor', res.cursor);
        });
      }
      cursor = res.cursor;
      this.set({ cursor });
      if (!res.more) return;
    }
  }

  /** Tarik ulang seluruh data dari nol (perubahan lokal yang belum terkirim tetap dipertahankan). */
  async resync() {
    await setMeta('cursor', 0);
    this.set({ cursor: 0 });
    await this.run();
  }
}

export const sync = new SyncEngine();

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(sync.subscribe, () => sync.status);
}
