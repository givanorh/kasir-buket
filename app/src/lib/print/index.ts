// Pengiriman ke printer: Bluetooth/LAN (Android), dialog cetak (web), atau relay lewat sinkron ke perangkat lain.
import { registerPlugin } from '@capacitor/core';
import { liveQuery, type Subscription } from 'dexie';
import { db } from '../db';
import { getSession, isNative } from '../session';
import { getDeviceConfig, newId, save, type PrinterConfig } from '../store';
import type { Order, PrintJob, PrintTarget } from '../types';
import { encode, layout, toBase64, type Line } from './escpos';
import { buildStruk, buildTiket } from './receipts';

export interface ThermalPrinterPlugin {
  listPaired(): Promise<{ devices: { name: string; address: string }[] }>;
  printBluetooth(o: { address: string; data: string }): Promise<void>;
  printTcp(o: { host: string; port: number; data: string; timeout?: number }): Promise<void>;
}
export const ThermalPrinter = registerPlugin<ThermalPrinterPlugin>('ThermalPrinter');

/** Log cetak di memori (untuk pratinjau & pengujian). */
export const printLog: { target: string; mode: string; at: string; lines: string[] }[] = [];
(globalThis as any).__KB_PRINTLOG__ = printLog;

export function previewText(doc: Line[], width: 58 | 80): string[] {
  return layout(doc, width).map((r) => {
    const cols = width === 80 ? 48 : 32;
    const w = r.size === 2 ? Math.floor(cols / 2) : cols;
    const pad = r.align === 'center' ? Math.floor((w - r.text.length) / 2) : r.align === 'right' ? w - r.text.length : 0;
    const t = ' '.repeat(Math.max(0, pad)) + r.text;
    return r.size === 2 ? t.split('').join(' ') : t; // tampilan lebar ganda di pratinjau
  });
}

function printViaBrowser(doc: Line[], width: 58 | 80): Promise<void> {
  return new Promise((resolve) => {
    const lines = layout(doc, width);
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const body = lines.map((r) => `<div class="${r.bold ? 'b ' : ''}${r.size === 2 ? 's2 ' : ''}${r.align}">${esc(r.text) || '&nbsp;'}</div>`).join('');
    // ukuran huruf dihitung agar tepat `cols` karakter per baris (lebar karakter Courier = 0,6 em)
    const cols = width === 80 ? 48 : 32;
    const paper = width - 6;
    const fs = (paper / cols / 0.6).toFixed(3);
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: ${width}mm auto; margin: 0 }
      body { margin: 0; padding: 2mm 3mm; width: ${paper}mm; font-family: 'Courier New', Courier, monospace; font-size: ${fs}mm; line-height: 1.22; color: #000 }
      div { white-space: pre; overflow: hidden }
      .b { font-weight: bold } .s2 { font-size: ${(Number(fs) * 2).toFixed(3)}mm; line-height: 1.1 }
      .center { text-align: center } .right { text-align: right }
    </style></head><body>${body}</body></html>`;
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(f);
    const w = f.contentWindow!;
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(() => {
      try { w.focus(); w.print(); } catch { /* abaikan */ }
      setTimeout(() => { f.remove(); resolve(); }, 1000);
    }, 150);
  });
}

/** Kirim satu dokumen ke printer sesuai konfigurasi perangkat. */
export async function sendToPrinter(target: string, cfg: PrinterConfig, doc: Line[]): Promise<void> {
  const copies = Math.max(1, Math.min(5, cfg.copies || 1));
  printLog.unshift({ target, mode: cfg.mode, at: new Date().toISOString(), lines: previewText(doc, cfg.width) });
  printLog.length = Math.min(printLog.length, 20);
  for (let i = 0; i < copies; i++) {
    if (cfg.mode === 'bluetooth' || cfg.mode === 'lan') {
      if (!isNative()) throw new Error('Printer Bluetooth/LAN hanya bisa dari aplikasi Android');
      const data = toBase64(encode(doc, cfg.width));
      if (cfg.mode === 'bluetooth') {
        if (!cfg.address) throw new Error('Printer Bluetooth belum dipilih');
        await ThermalPrinter.printBluetooth({ address: cfg.address, data });
      } else {
        if (!cfg.host) throw new Error('Alamat IP printer belum diisi');
        await ThermalPrinter.printTcp({ host: cfg.host, port: cfg.port || 9100, data, timeout: 5000 });
      }
    } else if (cfg.mode === 'system') {
      if ((window as any).__KB_TEST__) continue; // mode uji otomatis: tanpa dialog cetak
      await printViaBrowser(doc, cfg.width);
    }
  }
}

async function docFor(order: Order, kind: 'struk' | 'tiket', copyLabel?: string) {
  const st = await db.settings.get('toko');
  if (kind === 'tiket') return buildTiket(order, st);
  const pays = await db.payments.where('order_id').equals(order.id).toArray();
  let pointsBalance: number | undefined;
  if (order.customer_id) {
    const mine = (await db.orders.where('customer_id').equals(order.customer_id).toArray()).filter((o) => !o.void);
    pointsBalance = mine.reduce((s, o) => s + (o.points_earned || 0) - (o.points_redeemed || 0), 0);
    if (!mine.some((o) => o.points_earned || o.points_redeemed)) pointsBalance = undefined;
  }
  return buildStruk(order, pays, st, { copyLabel, pointsBalance });
}

export interface PrintResult { target: PrintTarget; ok: boolean; mode: string; error?: string }

/**
 * Cetak transaksi ke target yang diminta. Target bermode relay dikirim sebagai print_job
 * (kecuali `skipRelay`, mis. saat checkout yang sudah membuat job di transaksi yang sama).
 */
export async function printOrder(order: Order, targets: PrintTarget[] = ['kasir', 'produksi'], opts: { skipRelay?: boolean; copyLabel?: string } = {}): Promise<PrintResult[]> {
  const cfg = await getDeviceConfig();
  const results: PrintResult[] = [];
  for (const target of targets) {
    const pc = cfg.printers[target];
    const kind = target === 'kasir' ? 'struk' : 'tiket';
    if (pc.mode === 'none') { results.push({ target, ok: true, mode: 'none' }); continue; }
    if (pc.mode === 'relay') {
      if (!opts.skipRelay) {
        await save<PrintJob>('print_jobs', newId('j'), { target, order_id: order.id, kind, status: 'pending', from_device: getSession().deviceId });
      }
      results.push({ target, ok: true, mode: 'relay' });
      continue;
    }
    try {
      await sendToPrinter(target, pc, await docFor(order, kind, opts.copyLabel));
      results.push({ target, ok: true, mode: pc.mode });
    } catch (e) {
      results.push({ target, ok: false, mode: pc.mode, error: (e as Error).message || String(e) });
    }
  }
  return results;
}

// ---------------- stasiun cetak (mis. HP/tablet di ruang perangkai) ----------------
let stationSub: Subscription | null = null;
const inFlight = new Set<string>();

export async function startPrintStation() {
  stopPrintStation();
  const cfg = await getDeviceConfig();
  const targets = cfg.stationTargets.filter((t) => cfg.printers[t].mode !== 'relay' && cfg.printers[t].mode !== 'none');
  if (!targets.length) return;
  const since = Date.now() - 24 * 3600 * 1000; // job lebih tua dari 24 jam tidak dicetak otomatis
  stationSub = liveQuery(() => db.print_jobs.where('status').equals('pending').toArray()).subscribe(async (jobs) => {
    for (const job of jobs) {
      if (!targets.includes(job.target) || inFlight.has(job.id)) continue;
      if (new Date(job.created_at || 0).getTime() < since) continue;
      inFlight.add(job.id);
      try {
        const me = getSession().deviceId;
        await save<PrintJob>('print_jobs', job.id, { status: 'printing', printed_by: me });
        const order = await db.orders.get(job.order_id);
        if (!order) throw new Error('Transaksi belum tersinkron');
        await sendToPrinter(job.target, cfg.printers[job.target], await docFor(order, job.kind));
        await save<PrintJob>('print_jobs', job.id, { status: 'done', printed_at: new Date().toISOString(), error: '' });
      } catch (e) {
        await save<PrintJob>('print_jobs', job.id, { status: 'error', error: (e as Error).message });
      } finally {
        inFlight.delete(job.id);
      }
    }
  });
}

export function stopPrintStation() {
  stationSub?.unsubscribe();
  stationSub = null;
}

export async function retryJob(job: PrintJob) {
  await save<PrintJob>('print_jobs', job.id, { status: 'pending', error: '' });
}
