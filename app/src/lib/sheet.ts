// Pembaca spreadsheet tanpa dependensi: CSV (koma/titik koma/tab) dan Excel .xlsx (zip + XML).
// Dipakai untuk unggah daftar belanja bahan. Hasil: baris berisi teks per sel.

/** CSV RFC 4180; pemisah ditebak dari baris pertama (Excel berbahasa Indonesia memakai titik koma). */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] || '';
  const count = (ch: string) => first.split(ch).length - 1;
  const delim = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** Baca berkas tertentu dari arsip zip (direktori pusat). */
export async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, string>> {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Berkas bukan .xlsx yang valid');
  const n = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10), csize = u32(b, p + 20), nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32), lho = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!want(name)) continue;
    const start = lho + 30 + u16(b, lho + 26) + u16(b, lho + 28);
    const raw = b.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
    if (!data) throw new Error(`Kompresi zip tidak didukung (${method})`);
    out.set(name, dec.decode(data));
  }
  return out;
}

const ent = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => ent(m[1])).join('');
const colIndex = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Lembar pertama .xlsx menjadi baris teks. Angka tetap teks angka (tanggal Excel = nomor seri). */
export async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf, (n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(n));
  const wb = files.get('xl/workbook.xml') || '';
  const rid = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const rels = files.get('xl/_rels/workbook.xml.rels') || '';
  const target = rid ? new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] || new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1] : undefined;
  const sheetPath = target ? 'xl/' + target.replace(/^\/?xl\//, '').replace(/^\//, '') : [...files.keys()].filter((k) => k.startsWith('xl/worksheets/')).sort()[0];
  const sheet = files.get(sheetPath || '');
  if (!sheet) throw new Error('Lembar kerja tidak ditemukan di berkas Excel');
  const shared = [...(files.get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] || '';
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = '';
      if (type === 's') val = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') val = texts(body);
      else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else val = v !== undefined ? ent(v) : '';
      const idx = ref ? colIndex(ref) : row.length;
      while (row.length < idx) row.push('');
      row[idx] = val;
    }
    if (row.some((x) => String(x).trim())) rows.push(row);
  }
  return rows;
}

/** Baca berkas unggahan (.csv/.txt/.xlsx) menjadi baris. */
export async function readSheetFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) return parseXlsx(await file.arrayBuffer());
  if (name.endsWith('.xls')) throw new Error('Format .xls lama belum didukung. Simpan ulang sebagai .xlsx atau CSV.');
  return parseCsv(await file.text());
}

// ---------- angka & tanggal ----------
/** Rupiah: "Rp 25.000", "25,000", "25000", "1,5jt" → bilangan bulat. */
export function parseMoney(s: string): number {
  const t = String(s ?? '').toLowerCase().replace(/rp|\s/g, '');
  if (!t) return 0;
  const m = t.match(/^(-?[\d.,]+)(rb|k|jt)?$/);
  if (!m) return NaN;
  const mult = m[2] === 'jt' ? 1e6 : m[2] ? 1e3 : 1;
  return Math.round(parseNum(m[1], true) * mult);
}

/**
 * Bilangan gaya Indonesia: koma = desimal, titik = ribuan ("1,5" = 1,5; "1.000" = 1000; "2.5" = 2,5).
 * `money` = koma diikuti tepat 3 digit juga dianggap ribuan ("25,000" = 25000).
 */
export function parseNum(s: string, money = false): number {
  const t = String(s ?? '').trim().replace(/\s/g, '');
  if (!t) return NaN;
  if (/^-?\d+$/.test(t)) return Number(t);
  const hasDot = t.includes('.'), hasCom = t.includes(',');
  if (hasDot && hasCom) {
    const dec = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
    return Number(t.split(dec === '.' ? ',' : '.').join('').replace(dec, '.'));
  }
  const sep = hasDot ? '.' : ',';
  const parts = t.split(sep);
  const groups3 = /^-?\d{1,3}$/.test(parts[0]) && parts.slice(1).every((x) => x.length === 3);
  if (parts.length > 2) return groups3 ? Number(parts.join('')) : NaN;
  if (groups3 && (sep === '.' || money)) return Number(parts.join(''));
  return Number(parts.join('.'));
}

const BULAN: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : '';
};

/** Tanggal: 2026-11-16, 16/11/2026, 16-11-26, 16 Nov 2026, atau nomor seri Excel (46342). Hasil YYYY-MM-DD atau ''. */
export function parseDateCell(s: string): string {
  const t = String(s ?? '').trim();
  if (!t) return '';
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return ymd(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = t.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})$/i);
  if (m && BULAN[m[2].toLowerCase()]) return ymd(+m[3], BULAN[m[2].toLowerCase()], +m[1]);
  if (/^\d{4,5}(\.\d+)?$/.test(t)) { // nomor seri Excel (hari sejak 30 Des 1899)
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400e3);
    return d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100 ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` : '';
  }
  return '';
}

/** Teks CSV (pemisah koma, BOM agar Excel membaca UTF-8). */
export function toCsv(rows: (string | number)[][]): string {
  return '﻿' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}
