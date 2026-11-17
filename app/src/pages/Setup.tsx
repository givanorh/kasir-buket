import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { api, getSession, isNative, login, updateSession } from '../lib/session';
import { Field, toast } from '../components/ui';
import { Icon } from '../components/icons';
import { getDeviceConfig, setDeviceConfig } from '../lib/store';

/** Perangkat ikut cabang pengguna yang masuk (stok, transaksi, laporan dicatat ke cabang itu). */
async function followOutlet(outletId?: string) {
  if (!outletId) return;
  const cfg = await getDeviceConfig();
  if (cfg.outletId !== outletId) await setDeviceConfig({ ...cfg, outletId });
}

const confirmDiscard = (n: number) =>
  window.confirm(`Server ini berbeda dari server sebelumnya. ${n} perubahan di perangkat ini belum terkirim ke server lama dan akan dihapus. Lanjutkan?`);

/** Layar awal: alamat server (Android), penyiapan toko pertama kali, masuk, dan lupa kata sandi. */
export default function Setup() {
  const s = getSession();
  const [server, setServer] = useState(s.serverUrl);
  const [health, setHealth] = useState<{ needsSetup: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'login' | 'lupa' | 'kode'>('login');
  const [f, setF] = useState({
    storeName: '', address: '', phone: '', ownerName: '', email: '', username: '', password: '',
    code: '', newPassword: '', newPassword2: '',
  });
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

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

  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await fn(); } catch (err) { toast((err as Error).message, 'err'); } finally { setBusy(false); }
  };

  const doSetup = run(async () => {
    await api('/api/setup', { body: f });
    const r = await login(f.username, f.password, confirmDiscard);
    await followOutlet(r.user.outlet_id);
    toast('Toko siap digunakan');
  });
  const doLogin = run(async () => { const r = await login(f.username, f.password, confirmDiscard); await followOutlet(r.user.outlet_id); });
  const doForgot = run(async () => {
    const r = await api<{ message: string; to?: string }>('/api/auth/forgot', { body: { username: f.username } });
    toast(r.to ? `Kode dikirim ke ${r.to}` : r.message, 'info');
    setMode('kode');
  });
  const doReset = run(async () => {
    if (f.newPassword !== f.newPassword2) throw new Error('Konfirmasi kata sandi tidak sama');
    await api('/api/auth/reset', { body: { username: f.username, code: f.code, password: f.newPassword } });
    toast('Kata sandi diganti. Silakan masuk.');
    setF({ ...f, password: '', code: '', newPassword: '', newPassword2: '' });
    setMode('login');
  });

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-logo"><Icon name="flower" size={26} /></div>
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
            <Field label="Email pemilik" hint="Untuk menerima kode bila lupa kata sandi"><input type="email" value={f.email} onChange={set('email')} autoCapitalize="none" /></Field>
            <Field label="Username"><input required value={f.username} onChange={set('username')} autoCapitalize="none" autoComplete="off" /></Field>
            <Field label="Kata sandi (min. 6)"><input required type="password" minLength={6} value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
            <button className="btn primary big" disabled={busy}>{busy ? 'Menyiapkan…' : 'Siapkan toko'}</button>
          </form>
        )}
        {health && !health.needsSetup && mode === 'login' && (
          <form onSubmit={doLogin} className="stack">
            <Field label="Username"><input required value={f.username} onChange={set('username')} autoCapitalize="none" autoComplete="username" /></Field>
            <Field label="Kata sandi"><input required type="password" value={f.password} onChange={set('password')} autoComplete="current-password" /></Field>
            <button className="btn primary big" disabled={busy}>{busy ? 'Masuk…' : 'Masuk'}</button>
            <button type="button" className="linkish center" onClick={() => setMode('lupa')} data-testid="lupa-sandi">Lupa kata sandi?</button>
          </form>
        )}
        {health && !health.needsSetup && mode === 'lupa' && (
          <form onSubmit={doForgot} className="stack">
            <p className="muted">Masukkan username atau email akun. Kode 6 digit dikirim ke email yang terdaftar.</p>
            <Field label="Username atau email"><input required value={f.username} onChange={set('username')} autoCapitalize="none" /></Field>
            <button className="btn primary big" disabled={busy}>{busy ? 'Mengirim…' : 'Kirim kode'}</button>
            <button type="button" className="linkish center" onClick={() => setMode('kode')}>Sudah punya kode</button>
            <button type="button" className="linkish center" onClick={() => setMode('login')}>Kembali ke halaman masuk</button>
          </form>
        )}
        {health && !health.needsSetup && mode === 'kode' && (
          <form onSubmit={doReset} className="stack">
            <p className="muted">Periksa email (termasuk folder Spam). Kode berlaku 15 menit.</p>
            <Field label="Username atau email"><input required value={f.username} onChange={set('username')} autoCapitalize="none" /></Field>
            <Field label="Kode 6 digit"><input required inputMode="numeric" maxLength={6} value={f.code} onChange={set('code')} autoComplete="one-time-code" /></Field>
            <Field label="Kata sandi baru (min. 6)"><input required type="password" minLength={6} value={f.newPassword} onChange={set('newPassword')} autoComplete="new-password" /></Field>
            <Field label="Ulangi kata sandi baru"><input required type="password" minLength={6} value={f.newPassword2} onChange={set('newPassword2')} autoComplete="new-password" /></Field>
            <button className="btn primary big" disabled={busy}>{busy ? 'Menyimpan…' : 'Ganti kata sandi'}</button>
            <button type="button" className="linkish center" onClick={() => setMode('lupa')}>Kirim ulang kode</button>
          </form>
        )}
      </div>
    </div>
  );
}
