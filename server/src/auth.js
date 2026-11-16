// Autentikasi: kata sandi scrypt, token bertanda tangan HMAC-SHA256 (tanpa cookie, aman untuk CORS).
import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${b64u(salt)}$${b64u(hash)}`;
}

export function verifyPassword(pw, stored) {
  const [alg, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const got = crypto.scryptSync(String(pw), Buffer.from(saltB64, 'base64url'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, got);
}

/**
 * Salinan sandi yang bisa dibuka owner (fitur "Lihat sandi"). Hanya untuk sandi yang diatur owner sendiri
 * (buat pengguna / tombol Sandi); sandi yang diganti pengguna lewat "Lupa kata sandi?" tidak pernah disimpan.
 * AES-256-GCM, kunci = SHA-256(secret server + label), sehingga basis data saja tidak cukup untuk membukanya.
 */
const viewKey = (secret) => crypto.createHash('sha256').update(`${secret}:lihat-sandi-v1`).digest();
export function sealPassword(secret, pw) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', viewKey(secret), iv);
  const enc = Buffer.concat([c.update(String(pw), 'utf8'), c.final()]);
  return `gcm$${b64u(iv)}$${b64u(enc)}$${b64u(c.getAuthTag())}`;
}
export function openPassword(secret, sealed) {
  try {
    const [alg, iv, enc, tag] = String(sealed || '').split('$');
    if (alg !== 'gcm') return null;
    const d = crypto.createDecipheriv('aes-256-gcm', viewKey(secret), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null; // secret server berganti atau data rusak
  }
}

export function signToken(secret, payload, days) {
  const body = b64u(JSON.stringify({ ...payload, exp: Date.now() + days * 86400000 }));
  const sig = b64u(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(secret, token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = b64u(crypto.createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

/** Pembatas percobaan login: maksimal `max` gagal per `windowMs` per kunci (IP + username). */
export function createLimiter(max = 10, windowMs = 10 * 60 * 1000) {
  const hits = new Map();
  return {
    blocked(key) {
      const h = hits.get(key);
      if (!h) return false;
      if (Date.now() - h.start > windowMs) {
        hits.delete(key);
        return false;
      }
      return h.n >= max;
    },
    fail(key) {
      const h = hits.get(key);
      if (!h || Date.now() - h.start > windowMs) hits.set(key, { n: 1, start: Date.now() });
      else h.n++;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
