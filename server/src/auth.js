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
