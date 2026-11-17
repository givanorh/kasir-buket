// Server-Sent Events (SSE) lewat fetch.
// EventSource bawaan peramban tidak bisa mengirim header. Lewat ngrok gratis, permintaan tanpa header
// `ngrok-skip-browser-warning` dari APK (asal https://localhost, tanpa cookie ngrok) dibelokkan ke halaman peringatan
// (ERR_NGROK_6024), sehingga SSE tidak pernah tersambung dan polling cadangan jatuh ke 30 detik
// (± 1.200 permintaan/hari per perangkat, melampaui kuota 20.000/bulan). fetch bisa mengirim header tersebut.

export interface SseEvent { event: string; data: string }

/** Pemilah aliran SSE bertahap: terima potongan teks, panggil `onEvent` untuk tiap event lengkap (baris kosong). */
export function sseParser(onEvent: (e: SseEvent) => void): (chunk: string) => void {
  let buf = '';
  let event = '';
  let data: string[] = [];
  return (chunk: string) => {
    buf += chunk;
    for (;;) {
      const i = buf.search(/\r\n|\n|\r/);
      if (i < 0) break;
      const line = buf.slice(0, i);
      buf = buf.slice(i + (buf.startsWith('\r\n', i) ? 2 : 1));
      if (line === '') {
        if (data.length) onEvent({ event: event || 'message', data: data.join('\n') });
        event = '';
        data = [];
        continue;
      }
      if (line.startsWith(':')) continue; // komentar
      const c = line.indexOf(':');
      const field = c < 0 ? line : line.slice(0, c);
      let value = c < 0 ? '' : line.slice(c + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
  };
}

export interface SseHandlers {
  onOpen: () => void;
  onEvent: (e: SseEvent) => void;
  /** sambungan gagal/putus; sambung ulang dijadwalkan otomatis kecuali `fatal` (401/403: token tidak berlaku) */
  onError: (fatal: boolean) => void;
}

/**
 * Buka aliran SSE dengan header tambahan. Sambung ulang otomatis dengan jeda bertingkat
 * `minRetry` × 2^n (maks. `maxRetry`), kembali ke `minRetry` setelah tersambung. Mengembalikan fungsi penutup.
 */
export function fetchEvents(url: string, headers: Record<string, string>, h: SseHandlers, opt: { minRetry?: number; maxRetry?: number } = {}): () => void {
  const minRetry = opt.minRetry ?? 3000;
  const maxRetry = opt.maxRetry ?? 60000;
  const ctl = new AbortController();
  let closed = false;
  let wait = minRetry;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const connect = async () => {
    let fatal = false;
    try {
      const r = await fetch(url, { headers: { Accept: 'text/event-stream', ...headers }, cache: 'no-store', signal: ctl.signal });
      fatal = r.status === 401 || r.status === 403;
      if (!r.ok || !r.body || !(r.headers.get('content-type') || '').includes('text/event-stream')) {
        await r.body?.cancel().catch(() => {});
        throw new Error('bukan aliran SSE');
      }
      wait = minRetry;
      h.onOpen();
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      const feed = sseParser(h.onEvent);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        feed(dec.decode(value, { stream: true }));
      }
    } catch { /* jaringan putus, ditutup, atau balasan perantara */ }
    if (closed) return;
    h.onError(fatal);
    if (fatal) return;
    timer = setTimeout(connect, wait);
    wait = Math.min(wait * 2, maxRetry);
  };
  connect();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    ctl.abort();
  };
}
