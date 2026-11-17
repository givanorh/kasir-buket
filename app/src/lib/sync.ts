// Mesin sinkron otomatis. Tidak ada tombol "Sinkronkan" yang wajib ditekan:
//  - saat aplikasi dibuka/login, saat kembali ke depan (resume), saat internet tersambung lagi
//  - 0,4 detik setelah setiap perubahan lokal (push)
//  - saat server memberi tahu ada data baru lewat SSE (pull, hampir seketika)
//  - cadangan: polling tiap 30 detik bila SSE terhalang; selama SSE hidup (denyut server tiap 25 detik) cukup 5 menit sekali
// Konsistensi: server memberi nomor urut (seq) global; perangkat menarik semua perubahan seq > kursor.
// Perubahan lokal yang belum terkirim (outbox) selalu diterapkan ulang di atas data server,
// sehingga edit offline tidak tertimpa. Penggabungan per kolom (patch), bukan per rekaman.
import { useSyncExternalStore } from 'react';
import { db, getMeta, setMeta } from './db';
import { api, ApiError, applyDeviceRecord, applyStaffRecord, getSession, logout, updateSession } from './session';
import { COLLECTIONS } from './types';
import { fetchEvents } from './sse';

export interface SyncStatus {
  online: boolean; syncing: boolean; pending: number; lastSync: number | null; error: string | null; authError: boolean; cursor: number;
}

const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const PUSH_BATCH = 200;
const PULL_LIMIT = 1000;
const POLL_MS = 30000;
const SSE_ALIVE_MS = 70000; // dua denyut server terlewat = saluran SSE dianggap putus
const IDLE_POLL_MS = 5 * 60 * 1000;

class SyncEngine {
  status: SyncStatus = { online: true, syncing: false, pending: 0, lastSync: null, error: null, authError: false, cursor: 0 };
  private listeners = new Set<() => void>();
  private running = false;
  private again = false;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private backoff = 2000;
  private closeEvents: (() => void) | null = null;
  private started = false;
  private sseAt = 0; // denyut SSE terakhir
  private pullAt = 0; // sinkron berhasil terakhir

  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(p: Partial<SyncStatus>) { this.status = { ...this.status, ...p }; this.listeners.forEach((l) => l()); }

  private onOnline = () => this.run();
  private onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    // HP sering memutus sambungan saat aplikasi di latar belakang: sambung ulang SSE bila denyutnya sudah hilang
    if (this.started && Date.now() - this.sseAt > SSE_ALIVE_MS) this.connectEvents();
    this.run();
  };

  async start() {
    if (this.started) return;
    this.started = true;
    await this.cleanLegacyRejects().catch(() => {});
    this.set({ cursor: await getMeta<number>('cursor', 0), pending: await db.outbox.count() });
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('focus', this.onOnline);
    this.pollTimer = setInterval(() => this.poll(), POLL_MS);
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
    this.closeEvents?.();
    this.closeEvents = null;
  }

  private connectEvents() {
    const s = getSession();
    this.closeEvents?.();
    this.closeEvents = null;
    if (!s.token || !s.serverUrl) return;
    const base = s.serverUrl.replace(/\/+$/, '');
    const url = `${base}/api/events?token=${encodeURIComponent(s.token)}`;
    const onSeq = (data: string) => {
      this.sseAt = Date.now();
      try {
        const { seq } = JSON.parse(data);
        if (seq > this.status.cursor) this.run();
      } catch { /* abaikan */ }
    };
    const onOpen = () => { this.sseAt = Date.now(); if (!this.status.online) this.run(); };
    const ngrok = /ngrok/i.test(base);
    if (ngrok || typeof EventSource === 'undefined') {
      // Lewat ngrok: EventSource tidak bisa mengirim header ngrok-skip-browser-warning sehingga dibelokkan ke halaman
      // peringatan (ERR_NGROK_6024). fetch bisa mengirimnya (lihat sse.ts). Setelah pindah ke VPS kembali ke EventSource.
      this.closeEvents = fetchEvents(url, ngrok ? { 'ngrok-skip-browser-warning': '1' } : {}, {
        onOpen,
        onEvent: (e) => { if (e.event === 'seq') onSeq(e.data); },
        onError: () => { this.sseAt = 0; },
      });
      return;
    }
    const es = new EventSource(url);
    es.addEventListener('seq', (ev) => onSeq((ev as MessageEvent).data));
    es.onopen = onOpen;
    es.onerror = () => { this.sseAt = 0; };
    this.closeEvents = () => es.close();
  }

  /**
   * Polling cadangan. Selama SSE hidup, perubahan sudah datang seketika lewat SSE, jadi cukup satu pull per 5 menit:
   * 12 permintaan/jam per perangkat, bukan 120. Penting bila server diakses lewat tunnel berkuota (ngrok gratis:
   * 20.000 permintaan/bulan) dan menghemat baterai serta data di HP.
   */
  private poll() {
    const now = Date.now();
    const sseAlive = now - this.sseAt < SSE_ALIVE_MS;
    if (sseAlive && this.status.online && !this.status.pending && now - this.pullAt < IDLE_POLL_MS) return;
    this.run();
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
      this.pullAt = Date.now();
      this.set({ online: true, error: null, lastSync: Date.now(), pending: await db.outbox.count() });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        this.set({ authError: true, error: err.message });
        this.stop();
        await logout();
      } else {
        // tunnel/perantara mati (mis. ngrok ERR_NGROK_3200) = server tidak terjangkau, tampilkan sebagai offline
        this.set({ online: err.status !== 0 && !err.proxy ? this.status.online : false, error: err.message, pending: await db.outbox.count() });
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
      await db.outbox.bulkDelete(batch.map((b) => b.seq!));
      if (rejected.length) {
        // catatan diagnostik (tidak ditampilkan), lalu samakan lagi data perangkat ini dengan server
        const log = await getMeta<any[]>('sync_errors', []);
        await setMeta('sync_errors', [...rejected.map((r) => ({ ...r, at: new Date().toISOString() })), ...log].slice(0, 50));
        await this.rollback(rejected);
      }
      this.set({ pending: await db.outbox.count() });
    }
  }

  private async pull() {
    let cursor = await getMeta<number>('cursor', 0);
    // server menyaring koleksi khusus peran tertentu (mis. gaji = owner). Bila peran akun di perangkat ini berubah,
    // tarik ulang dari awal agar data yang dulu disaring ikut masuk.
    const role = getSession().user?.role || '';
    if ((await getMeta<string>('pull_role', role)) !== role && cursor > 0) cursor = 0;
    await setMeta('pull_role', role);
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
        // owner mengganti nama/kategori perangkat ini: kode nomor struk langsung ikut berubah
        const mine = res.changes.filter((ch) => ch.c === 'devices' && !ch.del && ch.id === getSession().deviceId).pop();
        if (mine) await applyDeviceRecord(mine.data);
        // owner mengubah peran akun ini (mis. Perangkai → Admin + Perangkai): menu ikut berubah tanpa masuk ulang
        const meRec = res.changes.filter((ch) => ch.c === 'staff' && !ch.del && ch.id === getSession().user?.id).pop();
        if (meRec) await applyStaffRecord(meRec.data);
      }
      cursor = res.cursor;
      this.set({ cursor });
      if (!res.more) return;
    }
  }

  /**
   * Perubahan yang ditolak server tidak boleh tertinggal di perangkat ini sebagai data "hantu".
   * ID tidak sah (mustahil diterima server): rekaman lokalnya dihapus. Penolakan lain (izin, aturan):
   * kursor dikembalikan ke 0 sehingga pull berikutnya menimpa rekaman itu dengan versi server.
   */
  private async rollback(rejected: { c: string; id: string; error?: string }[]) {
    let repull = false;
    for (const r of rejected) {
      if (!(COLLECTIONS as string[]).includes(r.c)) continue;
      if (r.error === 'ID tidak valid' || !ID_RE.test(String(r.id ?? ''))) await db.table(r.c).delete(r.id);
      else repull = true;
    }
    // tarik ulang penuh paling sering 10 menit sekali; pull pada putaran yang sama langsung memakai kursor 0
    if (repull && Date.now() - (await getMeta<number>('repull_at', 0)) > 10 * 60 * 1000) {
      await setMeta('repull_at', Date.now());
      await setMeta('cursor', 0);
    }
  }

  /** Sekali per perangkat: bersihkan sisa penolakan "ID tidak valid" dari versi sebelum v1.8 (mis. produk impor ber-ID "kp-"). */
  private async cleanLegacyRejects() {
    if (await getMeta<boolean>('rejects_cleaned', false)) return;
    const log = await getMeta<{ c: string; id: string; error?: string }[]>('sync_errors', []);
    for (const r of log) {
      if ((COLLECTIONS as string[]).includes(r.c) && r.error === 'ID tidak valid') await db.table(r.c).delete(r.id);
    }
    await setMeta('rejects_cleaned', true);
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
