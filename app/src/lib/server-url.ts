// Alamat server bawaan.
//  - Web: asal halaman (server yang menyajikan aplikasi).
//  - Android (APK): alamat yang ditanam saat build lewat variabel VITE_DEFAULT_SERVER (GitHub Actions: variabel
//    repositori KB_SERVER_URL, bawaan tunnel ngrok toko sampai server pindah ke VPS).
// Alamat yang diketik pengguna di layar masuk tetap dipakai. Pengecualian: bila alamat tersimpan sama dengan bawaan
// build sebelumnya dan APK baru membawa bawaan lain (mis. alamat VPS), perangkat ikut pindah otomatis.

export const BUILD_SERVER = cleanUrl(String(import.meta.env?.VITE_DEFAULT_SERVER || ''));

export function cleanUrl(u: string): string {
  return u.trim().replace(/\/+$/, '');
}

export interface ServerUrlInput {
  native: boolean;
  /** meta `serverUrl` (kosong = belum pernah diisi) */
  stored: string;
  /** meta `serverUrlDefault`: bawaan build yang terakhir dijalankan di perangkat ini */
  prevDefault: string;
  /** bawaan build yang sedang berjalan */
  buildDefault: string;
  origin: string;
}

/** Alamat server yang dipakai saat aplikasi dibuka. */
export function pickServerUrl(o: ServerUrlInput): string {
  if (!o.native) return o.stored || o.origin;
  if (!o.stored) return o.buildDefault;
  if (o.buildDefault && o.prevDefault && o.stored === o.prevDefault && o.prevDefault !== o.buildDefault) return o.buildDefault;
  return o.stored;
}
