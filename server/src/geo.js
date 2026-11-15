// Bantuan lokasi di sisi server: membuka link pendek Google Maps & menghitung jarak jalan (OSRM).
// Dijalankan di server karena browser/HP tidak bisa mengikuti redirect lintas domain (CORS).
const ALLOWED = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|((maps|www)\.)?google\.(com|co\.id|com\.[a-z]{2}|co\.[a-z]{2}|[a-z]{2}))$/i;

const okLat = (v) => Number.isFinite(v) && v >= -90 && v <= 90;
const okLng = (v) => Number.isFinite(v) && v >= -180 && v <= 180;

export function coordsFromText(text) {
  let s = String(text || '');
  try { s = decodeURIComponent(s); } catch { /* biarkan */ }
  const pats = [
    [/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/, false],
    [/[?&](?:q|query|ll|sll|center|destination|daddr)=(?:loc:)?(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/, false],
    [/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/, false],
    [/APP_INITIALIZATION_STATE=\[\[\[[\d.]+,(-?\d{1,3}\.\d+),(-?\d{1,2}\.\d+)\]/, true], // urutan lng, lat
  ];
  for (const [re, swapped] of pats) {
    const m = s.match(re);
    if (!m) continue;
    const lat = Number(swapped ? m[2] : m[1]), lng = Number(swapped ? m[1] : m[2]);
    if (okLat(lat) && okLng(lng)) return { lat, lng };
  }
  return null;
}

/** Ikuti redirect link Google Maps (maks. 6 langkah), hanya ke domain Google. */
export async function expandMapsUrl(input, fetchFn = fetch) {
  let url;
  try { url = new URL(String(input).trim()); } catch { throw Object.assign(new Error('Link tidak valid'), { status: 400 }); }
  for (let hop = 0; hop < 6; hop++) {
    if (!['http:', 'https:'].includes(url.protocol) || !ALLOWED.test(url.hostname)) {
      throw Object.assign(new Error('Hanya link Google Maps yang didukung'), { status: 400 });
    }
    const direct = coordsFromText(url.href);
    if (direct) return { url: url.href, ...direct };
    const res = await fetchFn(url.href, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (KasirBuket)', 'Accept-Language': 'id' }, signal: AbortSignal.timeout(8000) });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url); continue; }
    const body = (await res.text()).slice(0, 2_000_000);
    const found = coordsFromText(body);
    if (found) return { url: url.href, ...found };
    break;
  }
  throw Object.assign(new Error('Titik tidak ditemukan di link ini. Minta pelanggan mengirim "titik" (pin) atau Plus Code.'), { status: 422 });
}

/** Jarak jalan mobil/motor lewat OSRM (layanan rute gratis berbasis OpenStreetMap). */
export async function roadDistanceKm(from, to, { fetchFn = fetch, base = 'https://router.project-osrm.org' } = {}) {
  for (const p of [from, to]) if (!p || !okLat(Number(p.lat)) || !okLng(Number(p.lng))) throw Object.assign(new Error('Koordinat tidak valid'), { status: 400 });
  const u = `${base}/route/v1/driving/${Number(from.lng)},${Number(from.lat)};${Number(to.lng)},${Number(to.lat)}?overview=false&alternatives=false`;
  const res = await fetchFn(u, { headers: { 'User-Agent': 'KasirBuket/1.2' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw Object.assign(new Error(`Layanan rute membalas ${res.status}`), { status: 502 });
  const j = await res.json();
  const m = j?.routes?.[0]?.distance;
  if (j?.code !== 'Ok' || !Number.isFinite(m)) throw Object.assign(new Error('Rute tidak ditemukan'), { status: 502 });
  return Math.round((m / 1000) * 100) / 100;
}
