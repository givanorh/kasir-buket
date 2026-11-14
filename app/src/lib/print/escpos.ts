// Dokumen cetak sederhana → perintah ESC/POS (printer thermal 58 mm = 32 kolom, 80 mm = 48 kolom).
export type Align = 'left' | 'center' | 'right';
export type Line =
  | { t: 'text'; text: string; align?: Align; bold?: boolean; size?: 1 | 2 }
  | { t: 'lr'; left: string; right: string; bold?: boolean; size?: 1 | 2 }
  | { t: 'hr'; char?: string }
  | { t: 'feed'; n?: number }
  | { t: 'cut' };

export const colsFor = (width: 58 | 80) => (width === 80 ? 48 : 32);

/** Hanya ASCII yang aman untuk semua printer murah (tanpa pengaturan code page). */
export function toAscii(s: string): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[•·]/g, '*').replace(/…/g, '...')
    .replace(/\t/g, ' ')
    .replace(/[^\x20-\x7e\n]/g, '');
}

/** Bungkus teks per kata agar muat `cols` kolom. */
export function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const para of toAscii(text).split('\n')) {
    let line = '';
    for (const word of para.split(/ +/)) {
      if (!word) continue;
      let w = word;
      while (w.length > cols) { // kata lebih panjang dari baris
        if (line) { out.push(line); line = ''; }
        out.push(w.slice(0, cols));
        w = w.slice(cols);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= cols) line += ' ' + w;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

/** Dua kolom: kiri dibungkus, kanan rata kanan di baris terakhir. */
export function leftRight(left: string, right: string, cols: number): string[] {
  const r = toAscii(right);
  const lines = wrap(left, cols);
  const last = lines[lines.length - 1];
  if (last.length + 1 + r.length <= cols) {
    lines[lines.length - 1] = last + ' '.repeat(cols - last.length - r.length) + r;
  } else {
    lines.push(' '.repeat(Math.max(0, cols - r.length)) + r);
  }
  return lines;
}

/** Baris teks final (untuk pratinjau & cetak via browser). */
export interface RenderedLine { text: string; align: Align; bold: boolean; size: 1 | 2 }

export function layout(doc: Line[], width: 58 | 80): RenderedLine[] {
  const cols = colsFor(width);
  const out: RenderedLine[] = [];
  for (const l of doc) {
    if (l.t === 'text') {
      const size = l.size || 1;
      for (const s of wrap(l.text, Math.floor(cols / size))) out.push({ text: s, align: l.align || 'left', bold: !!l.bold, size });
    } else if (l.t === 'lr') {
      const size = l.size || 1;
      for (const s of leftRight(l.left, l.right, Math.floor(cols / size))) out.push({ text: s, align: 'left', bold: !!l.bold, size });
    } else if (l.t === 'hr') {
      out.push({ text: (l.char || '-').repeat(cols), align: 'left', bold: false, size: 1 });
    } else if (l.t === 'feed') {
      for (let i = 0; i < (l.n ?? 1); i++) out.push({ text: '', align: 'left', bold: false, size: 1 });
    }
  }
  return out;
}

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

export function encode(doc: Line[], width: 58 | 80): Uint8Array {
  const bytes: number[] = [ESC, 0x40]; // ESC @ = inisialisasi printer
  const push = (...b: number[]) => { for (const x of b) bytes.push(x); };
  const alignCode = { left: 0, center: 1, right: 2 } as const;
  for (const l of doc) {
    if (l.t === 'feed') { push(ESC, 0x64, Math.min(255, l.n ?? 1)); continue; } // ESC d n
    if (l.t === 'cut') { push(ESC, 0x64, 4, GS, 0x56, 0x42, 0x00); continue; } // maju 4 baris + GS V 66 0 (potong)
    for (const r of layout([l], width)) {
      push(ESC, 0x61, alignCode[r.align]); // ESC a n = perataan
      push(ESC, 0x45, r.bold ? 1 : 0); // ESC E n = tebal
      push(GS, 0x21, r.size === 2 ? 0x11 : 0x00); // GS ! n = ukuran (0x11 = 2× lebar & tinggi)
      for (let i = 0; i < r.text.length; i++) bytes.push(r.text.charCodeAt(i) & 0x7f);
      push(LF);
    }
  }
  push(GS, 0x21, 0x00, ESC, 0x45, 0, ESC, 0x61, 0);
  if (doc[doc.length - 1]?.t !== 'cut') push(ESC, 0x64, 4);
  return Uint8Array.from(bytes);
}

export function toBase64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
