import { useEffect, useState } from 'react';
import { api, getSession, isNative, login, updateSession } from '../lib/session';
import { Field, toast } from '../components/ui';

/** Layar awal: alamat server (Android), penyiapan toko pertama kali, lalu masuk. */
export default function Setup() {
  const s = getSession();
  const [server, setServer] = useState(s.serverUrl);
  const [health, setHealth] = useState<{ needsSetup: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ storeName: '', address: '', phone: '', ownerName: '', username: '', password: '', deviceName: isNative() ? 'HP Kasir' : 'Komputer Kasir' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function check(url = server) {
    setChecking(true);
    try {
      const clean = url.trim().replace(/\/+$/, '');
      await updateSession({ serverUrl: clean });
      setHealth(await api('/api/health', { timeout: 8000 }));
    } catch (e) {
      setHealth(null);
      toast((e as Error).message, 'err');
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => { if (server) check(server); }, []); // eslint-disable-line

  async function doSetup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/setup', { body: f });
      await login(f.username, f.password, f.deviceName);
      toast('Toko siap digunakan');
    } catch (err) { toast((err as Error).message, 'err'); } finally { setBusy(false); }
  }
  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await login(f.username, f.password, f.deviceName); } catch (err) { toast((err as Error).message, 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-logo">💐</div>
        <h1>Kasir Buket</h1>
        {(isNative() || !health) && (
          <form onSubmit={(e) => { e.preventDefault(); check(); }} className="stack">
            <Field label="Alamat server" hint="Contoh: https://kasir.tokoanda.com atau http://192.168.1.10:8080">
              <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://" inputMode="url" autoCapitalize="none" />
            </Field>
            <button className="btn" disabled={checking || !server}>{checking ? 'Memeriksa…' : health ? 'Server tersambung ✓' : 'Sambungkan'}</button>
          </form>
        )}
        {health?.needsSetup && (
          <form onSubmit={doSetup} className="stack">
            <p className="muted">Server baru. Isi data toko dan akun pemilik (owner).</p>
            <Field label="Nama toko"><input required value={f.storeName} onChange={set('storeName')} /></Field>
            <Field label="Alamat toko"><input value={f.address} onChange={set('address')} /></Field>
            <Field label="No. telepon/WA toko"><input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
            <Field label="Nama pemilik"><input required value={f.ownerName} onChange={set('ownerName')} /></Field>
            <Field label="Username"><input required value={f.username} onChange={set('username')} autoCapitalize="none" /></Field>
            <Field label="Kata sandi (min. 6)"><input required type="password" minLength={6} value={f.password} onChange={set('password')} /></Field>
            <Field label="Nama perangkat ini"><input value={f.deviceName} onChange={set('deviceName')} /></Field>
            <button className="btn primary big" disabled={busy}>{busy ? 'Menyiapkan…' : 'Siapkan toko'}</button>
          </form>
        )}
        {health && !health.needsSetup && (
          <form onSubmit={doLogin} className="stack">
            <Field label="Username"><input required value={f.username} onChange={set('username')} autoCapitalize="none" autoComplete="username" /></Field>
            <Field label="Kata sandi"><input required type="password" value={f.password} onChange={set('password')} autoComplete="current-password" /></Field>
            <Field label="Nama perangkat ini" hint="Mis. HP Kasir, Tablet Ruang Rangkai"><input value={f.deviceName} onChange={set('deviceName')} /></Field>
            <button className="btn primary big" disabled={busy}>{busy ? 'Masuk…' : 'Masuk'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
