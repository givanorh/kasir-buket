// Lokasi & ongkir: baca titik dari link Google Maps / koordinat / Plus Code, hitung jarak, dan ongkir.
export interface LatLng { lat: number; lng: number }

const okLat = (v: number) => Number.isFinite(v) && v >= -90 && v <= 90;
const okLng = (v: number) => Number.isFinite(v) && v >= -180 && v <= 180;
const pair = (a: string, b: string): LatLng | null => {
  const lat = Number(a), lng = Number(b);
  return okLat(lat) && okLng(lng) ? { lat, lng } : null;
};

/** Koordinat di dalam URL/teks Google Maps. Urutan prioritas: titik tempat (!3d!4d) > parameter q/query/ll > @tengah peta > teks "lat, lng". */
export function coordsFromText(text: string): LatLng | null {
  const s = decodeURIComponent(String(text || '')).replace(/\s+/g, ' ');
  const pats = [
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|ll|sll|center|destination|daddr)=(?:loc:)?(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
    /^geo:(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
    /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/,
    /(?:^|[^\d.])(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})(?:[^\d]|$)/,
  ];
  for (const p of pats) {
    const m = s.match(p);
    if (m) { const r = pair(m[1], m[2]); if (r) return r; }
  }
  return null;
}

// ---------- Open Location Code (Plus Code) ----------
const OLC = '23456789CFGHJMPQRVWX';
const PAIR_RES = [20, 1, 0.05, 0.0025, 0.000125];

export function plusCodeIn(text: string): string | null {
  const m = String(text || '').toUpperCase().match(/(?:^|[^23456789CFGHJMPQRVWX])([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,7})(?![23456789CFGHJMPQRVWX])/);
  return m ? m[1] : null;
}

export function olcEncode(lat: number, lng: number): string {
  let la = Math.min(Math.max(lat, -90), 90 - 1e-10) + 90;
  let lo = ((((lng + 180) % 360) + 360) % 360);
  let code = '';
  for (const res of PAIR_RES) {
    const dLa = Math.floor(la / res + 1e-9), dLo = Math.floor(lo / res + 1e-9);
    la -= dLa * res; lo -= dLo * res;
    code += OLC[dLa] + OLC[dLo];
  }
  return code.slice(0, 8) + '+' + code.slice(8);
}

/** Pusat area kode lengkap (8 digit sebelum '+'). */
export function olcDecode(full: string): LatLng {
  const c = full.toUpperCase().replace('+', '').replace(/0+$/, '');
  let lat = -90, lng = -180, latRes = 0, lngRes = 0;
  for (let i = 0; i < Math.min(10, c.length); i += 2) {
    const res = PAIR_RES[i / 2];
    lat += OLC.indexOf(c[i]) * res;
    if (i + 1 < c.length) lng += OLC.indexOf(c[i + 1]) * res;
    latRes = lngRes = res;
  }
  for (let i = 10; i < c.length; i++) {
    const v = OLC.indexOf(c[i]);
    latRes /= 5; lngRes /= 4;
    lat += Math.floor(v / 4) * latRes;
    lng += (v % 4) * lngRes;
  }
  return { lat: lat + latRes / 2, lng: lng + lngRes / 2 };
}

/** Kode pendek ("VP3+PR Stabat") dipulihkan memakai titik acuan terdekat (lokasi toko). */
export function olcRecover(code: string, ref: LatLng): LatLng {
  const c = code.toUpperCase();
  const sep = c.indexOf('+');
  if (sep >= 8) return olcDecode(c);
  const pad = 8 - sep;
  const resolution = Math.pow(20, 2 - pad / 2);
  const half = resolution / 2;
  const prefix = olcEncode(ref.lat, ref.lng).replace('+', '').slice(0, pad);
  const p = olcDecode(prefix + c.replace('+', '').slice(0, sep) + '+' + c.slice(sep + 1));
  let { lat, lng } = p;
  if (ref.lat + half < lat && lat - resolution >= -90) lat -= resolution;
  else if (ref.lat - half > lat && lat + resolution <= 90) lat += resolution;
  if (ref.lng + half < lng) lng -= resolution;
  else if (ref.lng - half > lng) lng += resolution;
  return { lat, lng };
}

/** Jarak garis lurus (haversine), km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371.0088, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface FeeRule { rate: number; min: number; round: number }
export interface FeeResult { kmBilled: number; raw: number; fee: number; usedMin: boolean }

/** ongkir = maks(minimum, bulatkan_ke_atas(km × tarif, kelipatan)); km dibulatkan ke atas 1 desimal. */
export function deliveryFee(km: number, r: FeeRule): FeeResult {
  const kmBilled = Math.ceil(Math.max(0, km) * 10 - 1e-9) / 10;
  const raw = Math.round(kmBilled * r.rate);
  const rounded = r.round > 1 ? Math.ceil(raw / r.round) * r.round : raw;
  const fee = Math.max(r.min, rounded);
  return { kmBilled, raw, fee, usedMin: fee === r.min && rounded < r.min };
}

/** Titik dari masukan kasir tanpa jaringan (koordinat, link panjang, Plus Code). Null bila perlu bantuan server (link pendek). */
export function parseLocalInput(input: string, ref?: LatLng | null): (LatLng & { source: string }) | null {
  const t = String(input || '').trim();
  if (!t) return null;
  const c = coordsFromText(t);
  if (c) return { ...c, source: 'koordinat' };
  const pc = plusCodeIn(t);
  if (pc) {
    const sep = pc.indexOf('+');
    if (sep >= 8) return { ...olcDecode(pc), source: 'plus code' };
    if (ref) return { ...olcRecover(pc, ref), source: 'plus code' };
  }
  return null;
}

export const isShortMapsLink = (t: string) => /https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i.test(t);
